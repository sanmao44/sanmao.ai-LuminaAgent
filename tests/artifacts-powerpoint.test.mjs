import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifactsModule } from './artifacts-build.mjs';

const artifacts = await buildArtifactsModule();

async function withStore(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-artifacts-ppt-'));
  const store = artifacts.createArtifactStore({ root, cleanup: false });
  try {
    return await run(store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('生成结构完整的 16:9 pptx，中文可写入幻灯片', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generatePresentationArtifact({
      filename: '产品介绍.pptx',
      title: 'SANMAO.AI 产品介绍',
      theme: 'sanmao-dark',
      slides: [
        { layout: 'title', title: 'SANMAO.AI', subtitle: 'AI 创作工作台' },
        { layout: 'bullets', title: '核心能力', bullets: ['图片生成', '视频生成', 'Agent', 'Skills'] },
      ],
    }, store);

    assert.equal(result.artifact.name, '产品介绍.pptx');
    assert.match(result.artifact.mimeType, /presentationml\.presentation/);

    const buffer = await readFile((await store.read(result.artifact.id)).filePath);
    const entries = artifacts.readArchiveEntries(buffer);
    assert.ok(entries['ppt/presentation.xml']);
    assert.ok(entries['ppt/slides/slide1.xml']);
    assert.ok(entries['ppt/slides/slide2.xml']);
    assert.ok(!entries['ppt/slides/slide3.xml'], '只应有两页');
    const slide1 = artifacts.readArchiveText(buffer, 'ppt/slides/slide1.xml');
    assert.ok(slide1.includes('SANMAO.AI'));
    const slide2 = artifacts.readArchiveText(buffer, 'ppt/slides/slide2.xml');
    assert.ok(slide2.includes('图片生成'));
  });
});

test('要点过多时自动续页，而不是把文字挤出页面', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generatePresentationArtifact({
      filename: '续页.pptx',
      slides: [{ layout: 'bullets', title: '清单', bullets: Array.from({ length: 14 }, (_, index) => `要点 ${index + 1}`) }],
    }, store);
    const buffer = await readFile((await store.read(result.artifact.id)).filePath);
    const entries = artifacts.readArchiveEntries(buffer);
    const slides = Object.keys(entries).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    assert.equal(slides.length, 3, '14 条要点按每页 6 条拆成 3 页');
    const second = artifacts.readArchiveText(buffer, 'ppt/slides/slide2.xml');
    assert.ok(second.includes('续'));
  });
});

test('markdown 简写与 table / two-column 版面都可用', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generatePresentationArtifact({
      filename: '版面.pptx',
      markdown: '# 标题页\n\n副标题内容\n\n## 要点页\n\n- 甲\n- 乙\n',
      slides: [
        { layout: 'two-column', title: '对比', leftTitle: '现状', leftBullets: ['手工导出'], rightTitle: '升级后', rightBullets: ['一键生成'] },
        { layout: 'table', title: '指标', columns: ['项目', '数值'], rows: [['交付', 3]] },
      ],
    }, store);
    const buffer = await readFile((await store.read(result.artifact.id)).filePath);
    const entries = artifacts.readArchiveEntries(buffer);
    const slides = Object.keys(entries).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    assert.equal(slides.length, 4, 'markdown 2 页 + slides 2 页');
    const all = slides.map((name) => artifacts.readArchiveText(buffer, name)).join('');
    assert.ok(all.includes('副标题内容'));
    assert.ok(all.includes('一键生成'));
    assert.ok(all.includes('交付'));
  });
});

test('pptx 扩展名由服务端强制，空内容直接报错', async () => {
  assert.equal(artifacts.resolvePresentationFileName('汇报.pdf'), '汇报.pptx');
  await assert.rejects(() => artifacts.buildPresentation({}), /内容为空/);
});

test('markdown 的 # 标题页与 ## 内容页会被识别', () => {
  const slides = artifacts.markdownToSlides('# 封面\n\n## 第一章\n\n- 一\n- 二');
  assert.equal(slides[0].layout, 'title');
  assert.equal(slides[1].layout, 'bullets');
  assert.deepEqual(slides[1].bullets, ['一', '二']);
});

test('chart 版面生成原生图表部件，数据与主题配色一起写入', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generatePresentationArtifact({
      filename: '季度汇报.pptx',
      slides: [{
        layout: 'chart',
        title: '季度销售',
        chart: {
          type: 'bar',
          categories: ['Q1', 'Q2', 'Q3'],
          series: [{ name: '销售额', values: [120, 98, 143] }],
        },
      }],
    }, store);
    const buffer = await readFile((await store.read(result.artifact.id)).filePath);
    const entries = artifacts.readArchiveEntries(buffer);

    const charts = Object.keys(entries).filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name));
    assert.equal(charts.length, 1, '应生成一个图表部件');
    const chartXml = artifacts.readArchiveText(buffer, charts[0]);
    assert.ok(chartXml.includes('销售额'), '系列名应写入图表');
    assert.match(chartXml, /<c:v>\s*120\s*<\/c:v>/, '数值应写入图表');
    assert.ok(chartXml.includes('3B82F6'), '应使用主题配色');

    const rels = artifacts.readArchiveText(buffer, 'ppt/slides/_rels/slide1.xml.rels');
    assert.ok(rels.includes('charts/chart1.xml'), '幻灯片应引用图表部件');
    assert.ok(!result.warnings.some((warning) => warning.includes('图表缺少有效数据')));
  });
});

test('图表数据不合法时降级提示而不是整份失败，饼图只用第一组', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generatePresentationArtifact({
      filename: '异常图表.pptx',
      slides: [
        { layout: 'chart', title: '空图表', chart: { type: 'pie', series: [] } },
        {
          layout: 'chart',
          title: '饼图',
          chart: {
            type: 'pie',
            categories: ['甲', '乙'],
            series: [{ name: '第一组', values: [1, 2] }, { name: '第二组', values: [3, 4] }],
          },
        },
      ],
    }, store);
    const buffer = await readFile((await store.read(result.artifact.id)).filePath);
    const entries = artifacts.readArchiveEntries(buffer);

    assert.ok(result.warnings.some((warning) => warning.includes('图表缺少有效数据')), '空数据应给出提示');
    assert.ok(result.warnings.some((warning) => warning.includes('饼图')), '多系列饼图应收敛为第一组');

    const charts = Object.keys(entries).filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name));
    assert.equal(charts.length, 1, '空图表不应产出图表部件');
    const chartXml = artifacts.readArchiveText(buffer, charts[0]);
    assert.ok(chartXml.includes('第一组'));
    assert.ok(!chartXml.includes('第二组'));
    const emptySlide = artifacts.readArchiveText(buffer, 'ppt/slides/slide1.xml');
    assert.ok(emptySlide.includes('图表数据为空'));
  });
});
