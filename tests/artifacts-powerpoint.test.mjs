import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { buildArtifactsModule } from './artifacts-build.mjs';
import { createTsRequire } from './ts-require.mjs';

const artifacts = await buildArtifactsModule();
const { presentationGenerateTool } = createTsRequire(process.cwd())('./lib/tools/artifacts');

async function withStore(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-artifacts-ppt-'));
  const store = artifacts.createArtifactStore({ root, cleanup: false });
  try {
    return await run(store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** 造一个真实的本地图片目录，模拟应用已保存的图片存储位置。 */
async function withImageRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-artifacts-ppt-images-'));
  await writeFile(path.join(root, 'photo.png'), await sharp({
    create: { width: 480, height: 300, channels: 3, background: { r: 15, g: 23, b: 42 } },
  }).png().toBuffer());
  try {
    return await run({ root, ref: `/api/storage/file?name=${encodeURIComponent('photo.png')}` });
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

test('layout=image 把本地图片放进幻灯片，subtitle 作为图注', async () => {
  await withImageRoot(async (images) => {
    await withStore(async (store) => {
      const result = await artifacts.generatePresentationArtifact({
        filename: '配图',
        slides: [
          { layout: 'image', title: '效果图', subtitle: 'AI 生成效果', image: { ref: images.ref } },
          { layout: 'bullets', title: '说明', bullets: ['要点一'] },
        ],
      }, store, { imageRoots: [images.root] });

      const buffer = await readFile((await store.read(result.artifact.id)).filePath);
      const entries = artifacts.readArchiveEntries(buffer);
      const media = Object.keys(entries).filter((name) => /^ppt\/media\/.+\.(png|jpe?g)$/.test(name));
      assert.equal(media.length, 1, '应嵌入一张图片');

      const slide = artifacts.readArchiveText(buffer, 'ppt/slides/slide1.xml');
      assert.match(slide, /<p:pic>/, '应生成图片节点');
      assert.ok(slide.includes('AI 生成效果'), '图注应写入幻灯片');
      assert.deepEqual(result.warnings, []);
    });
  });
});

test('插图 ref 无效时降级提示，不阻断整份 PPT', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generatePresentationArtifact({
      filename: '缺图',
      slides: [{ layout: 'image', title: '缺图页', image: { ref: 'https://example.com/a.png' } }],
    }, store);
    const buffer = await readFile((await store.read(result.artifact.id)).filePath);
    const entries = artifacts.readArchiveEntries(buffer);
    assert.equal(Object.keys(entries).filter((name) => /^ppt\/media\/.+\.(png|jpe?g)$/.test(name)).length, 0);
    assert.ok(result.warnings.some((warning) => warning.includes('引用无效')));
    assert.ok(result.warnings.some((warning) => warning.includes('没有可用的插图')));
    const slide = artifacts.readArchiveText(buffer, 'ppt/slides/slide1.xml');
    assert.ok(slide.includes('图片不可用'));
  });
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

test('PPT 指标卡把明确数值排成可读的原生卡片，工具 schema 会将它提供给模型', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generatePresentationArtifact({
      filename: '经营指标.pptx',
      theme: 'sanmao-light',
      slides: [{
        layout: 'metrics',
        title: '经营指标',
        metrics: [
          { label: '全年收入增长', value: '28%', context: '目标 22%' },
          { label: '客户续费率', value: '91%', context: '目标 93%' },
          { label: '获客成本', value: '-14%', context: '同比变化' },
        ],
      }],
    }, store);
    const buffer = await readFile((await store.read(result.artifact.id)).filePath);
    const slide = artifacts.readArchiveText(buffer, 'ppt/slides/slide1.xml');
    assert.ok(slide.includes('全年收入增长') && slide.includes('28%') && slide.includes('目标 22%'));
    assert.ok((slide.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []).length >= 8, '指标页应含标签、数值、说明和卡片形状');
    assert.deepEqual(result.warnings, []);
    const preview = await artifacts.buildArtifactPreviewHtml({
      kind: 'presentation', name: '经营指标.pptx', data: buffer,
    });
    assert.ok(preview.includes('<div class="slide-title">经营指标</div>'), '预览必须保留真正的页面标题');
    assert.ok(!preview.includes('<div class="slide-title">28%</div>'), '较大的指标值不能成为页面标题');

    const schema = presentationGenerateTool.schema;
    const slides = schema.properties.slides;
    assert.ok(slides.items.properties.layout.enum.includes('metrics'), '指标版式应暴露给模型工具调用');
    assert.equal(slides.items.properties.metrics.items.required.includes('label'), true);
    assert.equal(slides.items.properties.metrics.items.required.includes('value'), true);
  });
});

test('PPT 四指标卡的长金额和中文名称保持完整，并放得进文本框', async () => {
  const metricInputs = [
    { label: '季度回款金额', value: '1,234,567,890.00 元', context: '本季度累计' },
    { label: '海外业务收入', value: 'USD 123,456,789.00', context: '按美元计价' },
    { label: '关键业务指标'.repeat(5).slice(0, 32), value: '12345678901234567890123456789012' },
    { label: '计量口径', value: '全角指标'.repeat(8), context: '这是完整保留在指标数据中的长说明文字'.repeat(3) },
  ];
  for (const theme of ['sanmao-light', 'sanmao-dark']) {
    const result = await artifacts.buildPresentation({
      theme, slides: [{ layout: 'metrics', title: '经营指标', metrics: metricInputs }],
    });
    const xml = artifacts.readArchiveText(result.buffer, 'ppt/slides/slide1.xml');
    const shapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((match) => match[0]);
    const textShapes = shapes.filter((shape) => shape.includes('<a:t>'));
    const texts = textShapes.map((shape) => [...shape.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]).join('').replace(/\s/g, ''));
    for (const metric of metricInputs) {
      assert.ok(texts.includes(metric.label.replace(/\s/g, '')), theme + ' 指标名称必须完整');
      assert.ok(texts.includes(metric.value.replace(/\s/g, '')), theme + ' 指标值必须完整');
    }
    for (const shape of textShapes) {
      const width = Number(shape.match(/<a:ext cx="(\d+)"/)?.[1]) / 914400;
      const height = Number(shape.match(/<a:ext[^>]*cy="(\d+)"/)?.[1]) / 914400;
      const lines = [...shape.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].filter((match) => match[0].includes('<a:t>'));
      let neededHeight = 0;
      for (const [paragraph] of lines) {
        const text = [...paragraph.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]).join('');
        const size = Number(paragraph.match(/<a:rPr[^>]*sz="(\d+)"/)?.[1]) / 100;
        const lineSpacing = Number(paragraph.match(/<a:lnSpc><a:spcPts val="(\d+)"/)?.[1] || size * 134) / 100;
        assert.ok(artifacts.textWidthEm(text) * size / 72 <= width + 0.001, theme + ' 文字不得横向溢出');
        neededHeight += lineSpacing / 72;
      }
      assert.ok(neededHeight <= height + 0.001, theme + ' 文字高度不得超出文本框');
    }
    assert.ok(result.warnings.some((warning) => warning.includes('说明超出卡片容量')));
    assert.ok(xml.includes('…'), '说明过长时必须显示省略标记');
  }
});

test('PPT 输出修复孤立母版声明、notes 顺序和图表子元素顺序', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generatePresentationArtifact({
      filename: 'OOXML-结构.pptx',
      slides: [{
        layout: 'chart',
        title: '季度收入',
        notes: '按季度统计',
        chart: { type: 'bar', categories: ['Q1', 'Q2', 'Q3'], series: [{ name: '收入', values: [12, 15, 19] }] },
      }],
    }, store);
    const entries = artifacts.readArchiveEntries(await readFile((await store.read(result.artifact.id)).filePath));
    const contentTypes = Buffer.from(entries['[Content_Types].xml']).toString('utf8');
    for (const [, masterNumber] of contentTypes.matchAll(/PartName="\/ppt\/slideMasters\/slideMaster(\d+)\.xml"/g)) {
      assert.ok(entries[`ppt/slideMasters/slideMaster${masterNumber}.xml`], `声明的 slideMaster${masterNumber} 必须存在`);
    }

    const presentation = Buffer.from(entries['ppt/presentation.xml']).toString('utf8');
    assert.ok(presentation.indexOf('<p:notesMasterIdLst') < presentation.indexOf('<p:sldIdLst'), 'notesMasterIdLst 必须在 sldIdLst 前');
    const chartPart = Object.keys(entries).find((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name));
    assert.ok(chartPart, `应生成图表部件：${Object.keys(entries).filter((name) => name.includes('chart')).join(', ')}`);
    const chartXml = Buffer.from(entries[chartPart]).toString('utf8');
    const series = chartXml.match(/<c:ser>[\s\S]*?<\/c:ser>/)?.[0] || '';
    assert.ok(series.indexOf('<c:dPt') < series.indexOf('<c:dLbls'), '数据点格式必须排在数据标签前');
    const barChart = chartXml.match(/<c:barChart>[\s\S]*?<\/c:barChart>/)?.[0] || '';
    const chartAxisIds = [...barChart.matchAll(/<c:axId\b[^>]*val="(\d+)"/g)].map((match) => match[1]);
    assert.equal(chartAxisIds.length, 2, '柱状图应引用两个坐标轴');
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
