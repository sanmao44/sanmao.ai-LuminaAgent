import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifactsModule } from './artifacts-build.mjs';

const artifacts = await buildArtifactsModule();

async function withStore(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-artifacts-preview-'));
  const store = artifacts.createArtifactStore({ root, cleanup: false });
  try {
    return await run(store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const bufferOf = async (store, id) => readFile((await store.read(id)).filePath);

/** 1x1 PNG：够小又能通过 sharp 的真实解码校验，用来验证插图内联。 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function withImageRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-artifacts-media-'));
  try {
    await writeFile(path.join(root, 'sample.png'), TINY_PNG);
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('xlsx 预览渲染表头与数据，并转义单元格里的 HTML', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateSpreadsheetArtifact({
      filename: '预览.xlsx',
      sheets: [{
        name: '销售',
        columns: [{ key: 'month', header: '月份' }, { key: 'note', header: '备注' }],
        rows: [{ month: '1月', note: '<script>alert(1)</script>' }, { month: '2月', note: '正常' }],
      }],
    }, store);
    const html = await artifacts.buildArtifactPreviewHtml({
      kind: 'spreadsheet',
      name: '预览.xlsx',
      data: await bufferOf(store, result.artifact.id),
      theme: 'dark',
    });
    assert.match(html, /class="theme-dark"/);
    assert.match(html, /月份/);
    assert.match(html, /1月/);
    assert.match(html, /正常/);
    assert.ok(!html.includes('<script>alert(1)</script>'), '单元格内容必须转义');
    assert.match(html, /&lt;script&gt;/);
  });
});

test('docx 预览输出标题、列表与表格', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateDocumentArtifact({
      filename: '方案.docx',
      markdown: '# 目标\n\n本季度目标：\n\n- 完成 Office 导出\n\n## 数据\n\n| 指标 | 目标 |\n| --- | --- |\n| 交付 | 3 类文件 |\n',
    }, store);
    const html = await artifacts.buildArtifactPreviewHtml({
      kind: 'document',
      name: '方案.docx',
      data: await bufferOf(store, result.artifact.id),
    });
    assert.match(html, /<h1 id="[^"]+">目标<\/h1>/);
    assert.match(html, /<h2 id="[^"]+">数据<\/h2>/);
    assert.match(html, /本季度目标/);
    assert.match(html, /<li>完成 Office 导出<\/li>/);
    assert.match(html, /3 类文件/);
    assert.match(html, /<table class="doc-table">/);
  });
});

test('pptx 预览按页列出标题与要点', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generatePresentationArtifact({
      filename: '介绍.pptx',
      slides: [
        { layout: 'title', title: 'SANMAO.AI', subtitle: 'AI 创作工作台' },
        { layout: 'bullets', title: '核心能力', bullets: ['图片生成', '视频生成'] },
      ],
    }, store);
    const html = await artifacts.buildArtifactPreviewHtml({
      kind: 'presentation',
      name: '介绍.pptx',
      data: await bufferOf(store, result.artifact.id),
    });
    assert.equal((html.match(/class="slide"/g) || []).length, 2);
    assert.match(html, /SANMAO\.AI/);
    assert.match(html, /核心能力/);
    assert.match(html, /图片生成/);
    assert.ok(!html.includes('<li>核心能力</li>'), '幻灯片标题不应重复成要点');
    assert.ok(!html.includes('<li>2 / 2</li>'), '页码页脚不应混进要点');
  });
});

test('zip 预览列出条目与数量', async () => {
  await withStore(async (store) => {
    const doc = await artifacts.generateDocumentArtifact({ filename: '方案.docx', markdown: '# 方案\n\n正文' }, store);
    const collected = await artifacts.collectArchiveEntries([doc.artifact.id], store);
    const result = await artifacts.generateArchiveArtifact({ filename: '资料包.zip', entries: collected.entries }, store);
    const html = await artifacts.buildArtifactPreviewHtml({
      kind: 'archive',
      name: '资料包.zip',
      data: await bufferOf(store, result.artifact.id),
    });
    assert.match(html, /方案\.docx/);
    assert.match(html, /共 1 个文件/);
  });
});

test('预览响应按 id 取件，非法 id 与缺失文件分别是 400/404', async () => {
  await withStore(async (store) => {
    const invalid = await artifacts.buildArtifactPreviewResponse('../etc/passwd', {}, store);
    assert.equal(invalid.status, 400);
    const missing = await artifacts.buildArtifactPreviewResponse('11111111-1111-4111-8111-111111111111', {}, store);
    assert.equal(missing.status, 404);
    const doc = await artifacts.generateDocumentArtifact({ filename: '预览.docx', markdown: '# 标题\n\n正文' }, store);
    const ok = await artifacts.buildArtifactPreviewResponse(doc.artifact.id, { theme: 'light' }, store);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('Content-Type') || '', /text\/html/);
    assert.match(ok.headers.get('Content-Disposition') || '', /inline/);
    assert.match(await ok.text(), /标题/);
  });
});

test('docx 预览内联文档里的插图', async () => {
  await withStore(async (store) => {
    await withImageRoot(async (root) => {
      const result = await artifacts.generateDocumentArtifact({
        filename: '图文.docx',
        sections: [{ heading: '配图', paragraphs: ['下面是一张插图：'], images: [{ ref: 'sample.png', caption: '示例图' }] }],
      }, store, { imageRoots: [root] });
      assert.deepEqual(result.warnings, [], '插图必须真的写进文档，否则这个用例没有意义');
      const html = await artifacts.buildArtifactPreviewHtml({
        kind: 'document',
        name: '图文.docx',
        data: await bufferOf(store, result.artifact.id),
      });
      assert.match(html, /<figure class="doc-figure"><img src="data:image\/png;base64,/);
      assert.match(html, /示例图/);
      assert.ok(!html.includes('未在预览中显示'), '小图不应触发体积提示');
    });
  });
});

test('pptx 预览显示幻灯片插图与图表数据', async () => {
  await withStore(async (store) => {
    await withImageRoot(async (root) => {
      const result = await artifacts.generatePresentationArtifact({
        filename: '图表.pptx',
        slides: [
          {
            layout: 'chart',
            title: '月度销量',
            chart: { type: 'bar', categories: ['1月', '2月'], series: [{ name: '销量', values: [12, 30] }] },
          },
          { layout: 'image', title: '配图', image: { ref: 'sample.png', caption: '示例图' } },
        ],
      }, store, { imageRoots: [root] });
      const html = await artifacts.buildArtifactPreviewHtml({
        kind: 'presentation',
        name: '图表.pptx',
        data: await bufferOf(store, result.artifact.id),
      });
      assert.match(html, /<th>销量<\/th>/);
      assert.match(html, /<td>1月<\/td><td class="num">12<\/td>/);
      assert.match(html, /<div class="slide-media"><img src="data:image\/png;base64,/);
    });
  });
});

test('pptx 预览把图表画成图形，同时保留缓存数据点', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generatePresentationArtifact({
      filename: '图形.pptx',
      theme: 'sanmao-dark',
      slides: [
        { layout: 'chart', title: '月度销量', chart: { type: 'bar', categories: ['1月', '2月'], series: [{ name: '销量', values: [12, 30] }] } },
        { layout: 'chart', title: '渠道占比', chart: { type: 'pie', categories: ['A', 'B'], series: [{ name: '占比', values: [60, 40] }] } },
      ],
    }, store);
    const html = await artifacts.buildArtifactPreviewHtml({
      kind: 'presentation',
      name: '图形.pptx',
      data: await bufferOf(store, result.artifact.id),
      theme: 'dark',
    });
    assert.equal((html.match(/<svg class="chart-svg"/g) || []).length, 2, '柱状图与饼图都要画出来');
    assert.match(html, /<rect [^>]*fill="#3b82f6"/, '柱状图要有真实的柱子');
    assert.match(html, /<circle [^>]*stroke="#3b82f6" stroke-width="100"/, '饼图要按扇区描边画出来');
    assert.match(html, /<table class="chart-table">/, '图形之外仍要保留缓存数据');
    assert.match(html, /<td>1月<\/td><td class="num">12<\/td>/);
  });
});

test('xlsx 预览还原底纹与四类条件格式', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateSpreadsheetArtifact({
      filename: '格式.xlsx',
      sheets: [{
        name: '销售',
        columns: [
          { key: 'month', header: '月份' },
          { key: 'amount', header: '金额', total: 'sum', highlight: 'dataBar' },
          { key: 'growth', header: '增长', highlight: 'colorScale' },
          { key: 'delta', header: '差额', highlight: 'negative' },
          { key: 'score', header: '评分', highlight: 'top10' },
        ],
        rows: [
          { month: '1月', amount: 120, growth: 3, delta: 5, score: 90 },
          { month: '2月', amount: 80, growth: 9, delta: -4, score: 60 },
          { month: '3月', amount: 200, growth: 6, delta: 2, score: 75 },
        ],
      }],
    }, store);
    const html = await artifacts.buildArtifactPreviewHtml({
      kind: 'spreadsheet',
      name: '格式.xlsx',
      data: await bufferOf(store, result.artifact.id),
    });
    // 生成器写的静态底纹：表头蓝底白字、斑马纹、合计行。
    assert.match(html, /<th style="background-color:#2563eb;font-weight:600;color:#ffffff">月份<\/th>/);
    assert.match(html, /background-color:#f4f7fb/);
    assert.match(html, /background-color:#eaf1fb;font-weight:600/);
    // dataBar：80 是区间最小值，120 落在 33% 处。
    assert.match(html, /background-image:linear-gradient\(to right, #2563eb 33%, transparent 33%\)/);
    // colorScale：最小值红、中间值黄、最大值绿。
    assert.match(html, /background-color:#f8696b/);
    assert.match(html, /background-color:#ffeb84/);
    assert.match(html, /background-color:#63be7b/);
    // cellIs lessThan 0 与 top10 的绿底红字规则。
    assert.match(html, /style="background-color:#fee2e2;font-weight:600;color:#b91c1c">-4</);
    assert.match(html, /style="background-color:#dcfce7;font-weight:600;color:#15803d">90</);
    // 没有底纹的单元格不能带文件里的深色字体，否则深色主题下变成深底深字。
    assert.match(html, /<td>1月<\/td>/);
  });
});

test('docx 预览还原粗体、有序列表与表头底纹的可读配色', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateDocumentArtifact({
      filename: '样式.docx',
      markdown: '# 标题\n\n正文含**加粗**字样。\n\n- 无序一\n\n1. 第一步\n2. 第二步\n\n| 指标 | 目标 |\n| --- | --- |\n| 交付 | 3 类 |\n',
    }, store);
    const html = await artifacts.buildArtifactPreviewHtml({
      kind: 'document',
      name: '样式.docx',
      data: await bufferOf(store, result.artifact.id),
    });
    assert.match(html, /<p>正文含<strong>加粗<\/strong>字样。<\/p>/);
    assert.match(html, /<ul><li>无序一<\/li><\/ul>/);
    assert.match(html, /<ol><li>第一步<\/li><li>第二步<\/li><\/ol>/, '有序列表必须用 ol，不能退化成 ul');
    assert.match(html, /<td style="background-color:#dce6f5;text-align:center;color:#1f2937"><strong>指标<\/strong><\/td>/);
  });
});

test('pptx 预览还原幻灯片表格', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generatePresentationArtifact({
      filename: '清单.pptx',
      slides: [{ layout: 'table', title: '交付清单', columns: ['模块', '状态'], rows: [['预览', '完成'], ['导出', '进行中']] }],
    }, store);
    const html = await artifacts.buildArtifactPreviewHtml({
      kind: 'presentation',
      name: '清单.pptx',
      data: await bufferOf(store, result.artifact.id),
    });
    assert.match(html, /<table class="slide-table">/, '表格页不能只剩标题');
    assert.match(html, /<th style="background-color:#3b82f6;color:#[0-9a-f]{6};text-align:center;font-weight:600">模块<\/th>/);
    assert.match(html, /<td[^>]*>预览<\/td>/);
    assert.match(html, /<td[^>]*>进行中<\/td>/);
  });
});

test('docx 预览保留链接与粗体的行内样式', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateDocumentArtifact({
      filename: '链接.docx',
      markdown: '# 链接\n\n参考 [官方文档](https://example.com/docs) 与**重点**内容。\n',
    }, store);
    const html = await artifacts.buildArtifactPreviewHtml({
      kind: 'document',
      name: '链接.docx',
      data: await bufferOf(store, result.artifact.id),
    });
    // 预览 iframe 的 sandbox 不含 allow-popups，外链只做样式还原，不生成点了没反应的 a。
    assert.match(html, /<span class="doc-link"><u>官方文档<\/u><\/span>/);
    assert.match(html, /<strong>重点<\/strong>/);
  });
});

test('docx 目录预览重建条目并做成可跳转锚点，不泄漏 TOC 域代码', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateDocumentArtifact({
      filename: '目录.docx',
      title: '季度报告',
      toc: true,
      markdown: '## 第一章 概述\n正文一。\n### 明细\n正文二。\n## 第二章 数据\n正文三。\n',
    }, store);
    const html = await artifacts.buildArtifactPreviewHtml({
      kind: 'document',
      name: '目录.docx',
      data: await bufferOf(store, result.artifact.id),
      theme: 'dark',
    });
    assert.match(html, /<nav class="doc-toc">/, '目录要有一个像目录的块');
    assert.match(html, /<a class="doc-anchor" href="#sanmao-h-1">第一章 概述<\/a>/, '目录项要指向正文标题的书签');
    assert.match(html, /margin-left:32px"><a class="doc-anchor" href="#[^"]+">明细<\/a>/, 'h3 目录项要比 h2 缩进更多');
    assert.ok(!html.includes('TOC \\h'), 'TOC 域代码不能漏进预览正文');
    assert.match(html, /<h2 id="sanmao-h-1">第一章 概述<\/h2>/, '标题要带锚点 id');
  });
});

test('docx 预览把代码块排成等宽代码，而不是正文段落', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateDocumentArtifact({
      filename: '代码.docx',
      markdown: '## 命令\n\n```\nnpx tsc --noEmit\nnpm test\n```\n',
    }, store);
    const html = await artifacts.buildArtifactPreviewHtml({
      kind: 'document',
      name: '代码.docx',
      data: await bufferOf(store, result.artifact.id),
    });
    assert.match(html, /<pre class="doc-code"><code>npx tsc --noEmit\nnpm test<\/code><\/pre>/);
    assert.ok(!html.includes('<p>npx tsc'), '代码块不能再退化成正文段落');
  });
});

test('xlsx 预览按 numFmt 还原数字、列宽、冻结与下拉候选', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateSpreadsheetArtifact({
      filename: '格式.xlsx',
      sheets: [{
        name: '销售',
        columns: [
          { key: 'month', header: '月份', width: 10 },
          { key: 'amount', header: '金额', width: 14, format: '¥#,##0.00', total: 'sum' },
          { key: 'ratio', header: '占比', width: 12, format: '0.0%' },
          { key: 'status', header: '状态', width: 30, options: ['进行中', '已完成'] },
        ],
        rows: [{ month: '1月', amount: 1234567.891, ratio: 0.0345, status: '进行中' }],
        freezeHeader: true,
        autoFilter: true,
      }],
    }, store);
    const html = await artifacts.buildArtifactPreviewHtml({
      kind: 'spreadsheet',
      name: '格式.xlsx',
      data: await bufferOf(store, result.artifact.id),
    });
    assert.match(html, /¥1,234,567.89/, '货币与千分位要按 numFmt 显示');
    assert.match(html, /3\.5%|3\.4%/, '百分比要乘 100 再带 %');
    assert.ok(!html.includes('1234567.891'), '不能把原始数字直接丢出来');
    const widths = [...html.matchAll(/<col style="width:([\d.]+)%" \/>/g)].map((match) => Number(match[1]));
    assert.equal(widths.length, 4, '每列都要给出列宽');
    assert.ok(widths[3] > widths[0], '宽列（状态 30）要比窄列（月份 10）分到更多宽度');
    assert.match(html, /<table class="sticky-head">/);
    assert.match(html, /冻结首行 · 自动筛选 · 1 列带下拉候选/);
    assert.match(html, /状态<span class="dd" title="下拉候选：进行中、已完成">▾<\/span>/);
  });
});

test('pptx 预览保留幻灯片底色，并把两栏版式排成两栏', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generatePresentationArtifact({
      filename: '对比.pptx',
      theme: 'sanmao-dark',
      slides: [{ layout: 'two-column', title: '对比', leftTitle: '改造前', leftBullets: ['只能下载'], rightTitle: '改造后', rightBullets: ['在线预览'] }],
    }, store);
    const html = await artifacts.buildArtifactPreviewHtml({
      kind: 'presentation',
      name: '对比.pptx',
      data: await bufferOf(store, result.artifact.id),
      theme: 'light',
    });
    assert.match(html, /<section class="slide" style="background-color:#0b1220;color:#f8fafc">/, '深色主题的幻灯片不能显示成浅色底');
    assert.match(html, /<div class="slide-cols">/);
    assert.match(html, /<div class="slide-col-title">改造前<\/div><ul><li>只能下载<\/li><\/ul>/, '左栏标题与要点要成组');
    assert.match(html, /<div class="slide-col-title">改造后<\/div><ul><li>在线预览<\/li><\/ul>/, '右栏标题与要点要成组');
    assert.ok(!html.includes('<li>改造后</li>'), '栏标题不能混进要点列表');
  });
});

test('docx 预览的文档字色走 CSS 变量，深色主题下自动提亮', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateDocumentArtifact({
      filename: '封面.docx',
      title: '季度运营方案',
      subtitle: '2026 Q3',
      markdown: '# 正文\n\n内容。\n',
    }, store);
    const html = await artifacts.buildArtifactPreviewHtml({
      kind: 'document',
      name: '封面.docx',
      data: await bufferOf(store, result.artifact.id),
      theme: 'dark',
    });
    assert.match(html, /<span class="doc-fg" style="--doc-fg:#0f172a"><strong>季度运营方案<\/strong><\/span>/, '字色要挂到 CSS 变量上');
    assert.ok(!html.includes('style="color:#0f172a"'), '深色主题下不能再写死深色内联字色');
    assert.match(html, /\.theme-dark \.doc-fg \{ color:color-mix\(in srgb, var\(--doc-fg\) 30%, #ffffff 70%\); \}/, '深色主题要整体提亮');
  });
});
