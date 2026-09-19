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
    assert.match(html, /<h1>目标<\/h1>/);
    assert.match(html, /<h2>数据<\/h2>/);
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
