import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifactsModule } from './artifacts-build.mjs';

const artifacts = await buildArtifactsModule();

const EMU_PER_INCH = 914400;
const SLIDE_WIDTH_EMU = 12192000;
const SLIDE_HEIGHT_EMU = 6858000;
const A4_CONTENT_WIDTH_DXA = 9026;
const MIN_COLUMN_WIDTH = 9;
const MAX_COLUMN_WIDTH = 60;

const LONG_CJK = 'SANMAO.AI 把对话理解、提示词优化、多模型调度与文件交付收进同一个工作台，用一句话描述目标就能拿到可直接使用的成品文件。';
const LONG_TOKEN = 'A'.repeat(120);

async function withStore(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-artifacts-layout-'));
  const store = artifacts.createArtifactStore({ root, cleanup: false });
  try {
    return await run(store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function shapesOf(xml) {
  return [...xml.matchAll(/<p:(?:sp|graphicFrame)>[\s\S]*?<\/p:(?:sp|graphicFrame)>/g)].map((match) => match[0]);
}

function boxOf(shape) {
  const offset = shape.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
  const extent = shape.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  assert.ok(offset && extent, '形状必须带 xfrm 才能判断是否出框');
  return {
    x: Number(offset[1]), y: Number(offset[2]),
    cx: Number(extent[1]), cy: Number(extent[2]),
  };
}

/** 形状里的每一段文字（pptxgenjs 用独立段落表示我们预排好的硬换行）。 */
function linesOf(shape) {
  return [...shape.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((match) => {
    const paragraph = match[0];
    const size = Number(paragraph.match(/<a:rPr[^>]*sz="(\d+)"/)?.[1] || 1800) / 100;
    const text = [...paragraph.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((item) => item[1]).join('');
    return { text, size };
  }).filter((line) => line.text.trim());
}

function widthInches(text, size) {
  return (artifacts.textWidthEm(text) * size) / 72;
}

test('PPT：所有形状都在页面内，且每段文字都放得进自己的文本框', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generatePresentationArtifact({
      filename: '排版.pptx',
      slides: [
        { layout: 'title', title: 'SANMAO.AI 智能创作工作台产品介绍', subtitle: '从对话到交付：Word / Excel / PPT / ZIP 一键生成' },
        { layout: 'section', title: '第一章 产品定位', subtitle: '为什么需要一个交付型 AI 工作台' },
        { layout: 'bullets', title: '产品定位与核心价值', bullets: Array.from({ length: 7 }, (_, index) => `${index + 1}. ${LONG_CJK}`) },
        { layout: 'two-column', title: '传统流程 vs SANMAO.AI', leftTitle: '传统流程', leftBullets: [LONG_CJK, LONG_TOKEN], rightTitle: 'SANMAO.AI', rightBullets: ['统一交付 Word / Excel / PPT / ZIP', LONG_CJK] },
        { layout: 'table', title: '关键指标', columns: ['指标', '现状', '目标'], rows: [[LONG_CJK, LONG_TOKEN, 'Word / Excel / PPT / ZIP']] },
        { layout: 'bullets', title: '下一步', bullets: [LONG_CJK] },
      ],
    }, store);

    const buffer = await readFile((await store.read(result.artifact.id)).filePath);
    const entries = artifacts.readArchiveEntries(buffer);
    const slides = Object.keys(entries).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    assert.ok(slides.length >= 6, '每个版面都要生成一页');

    for (const name of slides) {
      const xml = artifacts.readArchiveText(buffer, name);
      const shapes = shapesOf(xml);
      assert.ok(shapes.length, `${name} 应该有形状`);
      for (const shape of shapes) {
        const box = boxOf(shape);
        assert.ok(box.x >= 0 && box.y >= 0, `${name} 形状起点不能是负坐标`);
        assert.ok(box.x + box.cx <= SLIDE_WIDTH_EMU, `${name} 形状右边超出页面：${box.x + box.cx}`);
        assert.ok(box.y + box.cy <= SLIDE_HEIGHT_EMU, `${name} 形状下边超出页面：${box.y + box.cy}`);
        for (const line of linesOf(shape)) {
          const available = box.cx / EMU_PER_INCH;
          assert.ok(
            widthInches(line.text, line.size) <= available + 0.0001,
            `${name} 文字「${line.text.slice(0, 12)}…」宽 ${widthInches(line.text, line.size).toFixed(2)}in，超过文本框 ${available.toFixed(2)}in`,
          );
        }
      }
      if (xml.includes('<a:tbl>')) {
        const table = xml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/)[0];
        const columns = [...table.matchAll(/<a:gridCol w="(\d+)"/g)].map((match) => Number(match[1]));
        assert.ok(Math.abs(columns.reduce((sum, value) => sum + value, 0) - SLIDE_WIDTH_EMU + 2 * Math.round(0.6 * EMU_PER_INCH)) <= EMU_PER_INCH / 100, '表格宽度应与正文同宽');
        for (const row of table.matchAll(/<a:tr[\s\S]*?<\/a:tr>/g)) {
          [...row[0].matchAll(/<a:tc>[\s\S]*?<\/a:tc>/g)].forEach((cell, index) => {
            const line = linesOf(cell[0])[0];
            if (!line) return;
            assert.ok(
              widthInches(line.text, line.size) <= columns[index] / EMU_PER_INCH + 0.0001,
              `${name} 表格单元格文字宽度超过列宽：${line.text.slice(0, 12)}…`,
            );
          });
        }
      }
    }
  });
});

test('PPT：一页要点超过上限时拆成续页，绝不压缩到出框', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generatePresentationArtifact({
      filename: '续页.pptx',
      slides: [{ layout: 'bullets', title: '清单', bullets: Array.from({ length: 20 }, (_, index) => `${index + 1}. ${LONG_CJK}`) }],
    }, store);
    const buffer = await readFile((await store.read(result.artifact.id)).filePath);
    const entries = artifacts.readArchiveEntries(buffer);
    const slides = Object.keys(entries).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    assert.ok(slides.length >= 4, '20 条长要点必须拆成多页');
    for (const name of slides) {
      const xml = artifacts.readArchiveText(buffer, name);
      for (const shape of shapesOf(xml)) {
        const box = boxOf(shape);
        assert.ok(box.y + box.cy <= SLIDE_HEIGHT_EMU, `${name} 形状下边超出页面`);
      }
    }
  });
});

test('Word：表格列宽总和等于正文宽度，长文本靠换行而不是溢出', () => {
  const widths = artifacts.distributeTableWidths([
    ['指标', '现状', '目标', '备注'],
    ['单份报告整理耗时', '约 45 分钟', '5 分钟以内', '含排版与命名'],
    ['交付格式覆盖', '仅文本', 'Word / Excel / PPT / ZIP', LONG_TOKEN],
  ], 4);
  assert.equal(widths.reduce((sum, value) => sum + value, 0), A4_CONTENT_WIDTH_DXA, '列宽总和必须等于正文宽度');
  assert.ok(widths.every((value) => value >= 700), `没有一列会被压到放不下一个字：${widths}`);
  const narrow = artifacts.distributeTableWidths([['a', 'b', 'c', 'd', 'e', 'f'], [LONG_CJK, LONG_CJK, LONG_CJK, LONG_CJK, LONG_CJK, LONG_CJK]], 6);
  assert.equal(narrow.reduce((sum, value) => sum + value, 0), A4_CONTENT_WIDTH_DXA);
  assert.ok(narrow.every((value) => value >= 700), '内容放不下时也只压到下限');
});

test('Word：生成的表格宽度与页边距一致，空章节直接报错', async () => {
  const doc = await artifacts.buildWordDocument({
    title: '周报',
    sections: [{
      heading: '一、进度', level: 1,
      paragraphs: [LONG_CJK],
      bullets: [LONG_TOKEN],
      tables: [{ columns: ['指标', '现状', '目标'], rows: [['耗时', '45 分钟', '5 分钟']] }],
    }],
  });
  const xml = artifacts.readArchiveText(doc.buffer, 'word/document.xml');
  const grid = [...xml.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((match) => Number(match[1]));
  assert.equal(grid.reduce((sum, value) => sum + value, 0), A4_CONTENT_WIDTH_DXA);
  assert.ok(xml.includes('<w:tblW w:type="dxa" w:w="9026"/>'), '表格宽度必须显式等于正文宽度');
  assert.ok(xml.includes('w:pgSz w:w="11906"'), '纸张尺寸必须显式声明');
  const footer = artifacts.readArchiveText(doc.buffer, 'word/footer1.xml');
  assert.ok(footer.includes('PAGE'), '页脚要有页码域');
  assert.ok(footer.includes('NUMPAGES'), '页脚要有总页数域');

  await assert.rejects(
    () => artifacts.buildWordDocument({ title: '空文档', sections: [{ note: '没有可识别字段' }] }),
    /内容为空/,
    '章节字段全都不认识时必须报错，而不是交付空文档',
  );
});

test('Word：Markdown 块形状的章节也能被识别', () => {
  const sections = artifacts.normalizeSections([
    { type: 'heading', text: '标题', level: 2 },
    { type: 'paragraph', text: '一段话' },
    { type: 'bullets', items: ['甲', '乙'] },
    { type: 'table', columns: ['A'], rows: [['1']] },
    { text: '只有 text 时按正文处理' },
  ]);
  assert.equal(sections.length, 5);
  assert.equal(sections[0].heading, '标题');
  assert.equal(sections[0].level, 2);
  assert.deepEqual(sections[1].paragraphs, ['一段话']);
  assert.deepEqual(sections[2].bullets, ['甲', '乙']);
  assert.deepEqual(sections[3].tables, [{ columns: ['A'], rows: [['1']] }]);
  assert.deepEqual(sections[4].paragraphs, ['只有 text 时按正文处理']);
  assert.deepEqual(artifacts.normalizeSections(undefined), []);
});

test('Excel：列宽按显示后的内容测量，数字格式不留尾点，长文本换行并被行高容纳', async () => {
  await withStore(async (store) => {
    const longNote = `${LONG_CJK}${LONG_CJK}`;
    const result = await artifacts.generateSpreadsheetArtifact({
      filename: '报表.xlsx',
      sheets: [{
        name: '销售数据',
        columns: [
          { key: 'city', header: '城市' },
          { key: 'sales', header: '销售额' },
          { key: 'rate', header: '完成率' },
          { key: 'note', header: '备注' },
        ],
        rows: [
          { city: '上海', sales: 1286000, rate: 1.0717, note: '超额完成' },
          { city: '北京', sales: 986400, rate: 0.8967, note: longNote },
        ],
        freezeHeader: true,
      }],
    }, store);

    const buffer = await readFile((await store.read(result.artifact.id)).filePath);
    const sheet = artifacts.readArchiveText(buffer, 'xl/worksheets/sheet1.xml');
    const styles = artifacts.readArchiveText(buffer, 'xl/styles.xml');

    const columns = [...sheet.matchAll(/<col min="(\d+)" max="(\d+)" width="([\d.]+)"/g)].map((match) => ({
      min: Number(match[1]), max: Number(match[2]), width: Number(match[3]),
    }));
    assert.ok(columns.length, '必须写出列宽');
    for (const column of columns) {
      assert.ok(column.width >= MIN_COLUMN_WIDTH && column.width <= MAX_COLUMN_WIDTH, `列宽越界：${column.width}`);
    }
    const widthOf = (index) => columns.find((column) => column.min <= index && index <= column.max)?.width;
    assert.ok(widthOf(1) >= artifacts.spreadsheetWidth('销售额'), '列宽至少要放得下表头');
    assert.ok(widthOf(2) >= artifacts.spreadsheetWidth('完成率'), '列宽至少要放得下百分比');

    const builtin = { 0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 49: '@' };
    const custom = new Map([...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]+)"/g)].map((match) => [Number(match[1]), match[2]]));
    const xfs = [...(styles.match(/<cellXfs[\s\S]*?<\/cellXfs>/)?.[0] || '').matchAll(/<xf numFmtId="(\d+)"[\s\S]*?(?:\/>|<\/xf>)/g)]
      .map((match) => ({ numFmtId: Number(match[1]), xml: match[0] }));
    const formatOf = (ref) => {
      const style = Number(sheet.match(new RegExp(`<c r="${ref}" s="(\\d+)"`))?.[1] ?? -1);
      const xf = xfs[style];
      assert.ok(xf, `${ref} 应该有样式`);
      return custom.get(xf.numFmtId) ?? builtin[xf.numFmtId] ?? '';
    };

    assert.equal(formatOf('C2'), '0.0%', '完成率按比率显示成百分比');
    assert.ok(/^#,##0(\.0+)?$/.test(formatOf('B2')), `金额格式必须写死小数位，不能出现尾点：${formatOf('B2')}`);
    const cellStyle = xfs[Number(sheet.match(/<c r="D3" s="(\d+)"/)?.[1] ?? -1)].xml;
    assert.ok(cellStyle.includes('wrapText="1"'), '超长文本单元格必须自动换行');
    const rowHeight = Number(sheet.match(/<row r="3"[^>]*?\sht="([\d.]+)"/)?.[1] ?? 0);
    const lines = Math.ceil(artifacts.spreadsheetWidth(longNote) / (widthOf(4) - 1));
    assert.ok(rowHeight >= lines * 17 - 0.001, `行高 ${rowHeight} 要放得下 ${lines} 行文字`);
    assert.ok(rowHeight <= lines * 17 + 1, '行高也不该虚高');
    assert.ok(sheet.includes('fitToWidth="1"'), '打印缩放要能一页宽放下');
    assert.ok(sheet.includes('orientation="landscape"'), '宽表按横向打印');
  });
});
