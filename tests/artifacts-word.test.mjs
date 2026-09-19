import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifactsModule } from './artifacts-build.mjs';

const artifacts = await buildArtifactsModule();

async function withStore(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-artifacts-word-'));
  const store = artifacts.createArtifactStore({ root, cleanup: false });
  try {
    return await run(store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('生成结构完整的 docx，中文标题与正文写入 document.xml', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateDocumentArtifact({
      filename: '项目方案',
      title: '项目方案',
      author: 'SANMAO.AI',
      markdown: '# 目标\n\n本季度目标：\n\n- 完成 Office 导出\n\n## 数据\n\n| 指标 | 目标 |\n| --- | --- |\n| 交付 | 3 类文件 |\n',
    }, store);

    assert.equal(result.artifact.name, '项目方案.docx');
    assert.equal(result.artifact.kind, 'document');
    assert.match(result.artifact.downloadUrl, /^\/api\/artifacts\/[0-9a-f-]{36}$/);
    assert.match(result.artifact.mimeType, /wordprocessingml\.document/);

    const stored = await store.read(result.artifact.id);
    const buffer = await readFile(stored.filePath);
    const entries = artifacts.readArchiveEntries(buffer);
    assert.ok(entries['[Content_Types].xml'], '缺少 [Content_Types].xml');
    assert.ok(entries['word/document.xml'], '缺少 word/document.xml');

    const xml = artifacts.readArchiveText(buffer, 'word/document.xml');
    assert.ok(xml.includes('项目方案'));
    assert.ok(xml.includes('完成 Office 导出'));
    assert.ok(xml.includes('交付'));
    assert.equal(result.artifact.size, buffer.length);
  });
});

test('sections 结构化输入与 markdown 可以同时使用，空内容直接报错', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateDocumentArtifact({
      sections: [{ heading: '第一章', level: 1, paragraphs: ['正文内容'], bullets: ['要点一'], tables: [{ columns: ['A', 'B'], rows: [['1', '2']] }] }],
      markdown: '# 第二章\n\n补充说明',
    }, store);
    const xml = artifacts.readArchiveText(await readFile((await store.read(result.artifact.id)).filePath), 'word/document.xml');
    assert.ok(xml.includes('第一章'));
    assert.ok(xml.includes('要点一'));
    assert.ok(xml.includes('第二章'));

    await assert.rejects(() => artifacts.generateDocumentArtifact({ title: '只有标题' }, store), /内容为空/);
  });
});

test('文件名扩展名由服务端强制为 .docx', async () => {
  assert.equal(artifacts.resolveDocumentFileName('季度报表.xlsx'), '季度报表.docx');
  assert.equal(artifacts.resolveDocumentFileName('无扩展名'), '无扩展名.docx');
  assert.equal(artifacts.resolveDocumentFileName(''), 'SANMAO-文档.docx');
});

test('markdown 会被解析成章节，而不是整段堆进一个段落', () => {
  const sections = artifacts.markdownToSections('# 标题\n\n正文\n\n- 一\n- 二\n\n## 小节\n\n结尾');
  assert.deepEqual(sections.map((section) => section.heading), ['标题', '小节']);
  assert.deepEqual(sections[0].bullets, ['一', '二']);
  assert.deepEqual(sections[1].paragraphs, ['结尾']);
});

test('有序列表写入真正的编号，而不是降级成圆点', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateDocumentArtifact({
      filename: '步骤.docx',
      markdown: '## 操作步骤\n\n1. 打开工作台\n2. 生成图片\n3. 导出文件\n',
    }, store);
    const buffer = await readFile((await store.read(result.artifact.id)).filePath);
    const entries = artifacts.readArchiveEntries(buffer);

    const sections = artifacts.markdownToSections('1. 甲\n2. 乙\n');
    assert.deepEqual(sections[0].orderedBullets, ['甲', '乙']);
    assert.equal(sections[0].bullets, undefined);

    const xml = artifacts.readArchiveText(buffer, 'word/document.xml');
    assert.ok(xml.includes('打开工作台'));
    assert.match(xml, /<w:numPr>/, '有序列表段落应带编号属性');
    assert.ok(!xml.includes('1. 打开工作台'), '序号不应混进正文文本');

    const numbering = artifacts.readArchiveText(buffer, 'word/numbering.xml');
    assert.match(numbering, /w:numFmt w:val="decimal"/);
  });
});

test('markdown 链接会变成可点击超链接，不安全协议按纯文本输出', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateDocumentArtifact({
      filename: '链接.docx',
      markdown: '参考[官方文档](https://example.com/docs)查看。\n\n危险链接[点我](javascript:void)不要点。\n',
    }, store);
    const buffer = await readFile((await store.read(result.artifact.id)).filePath);
    const xml = artifacts.readArchiveText(buffer, 'word/document.xml');
    const rels = artifacts.readArchiveText(buffer, 'word/_rels/document.xml.rels');

    assert.ok(xml.includes('官方文档'));
    assert.ok(!xml.includes('[官方文档]'), '链接语法不应原样输出');
    assert.match(xml, /<w:hyperlink/, '应生成 hyperlink 元素');
    assert.ok(rels.includes('https://example.com/docs'), '应写入外部关系');

    assert.ok(xml.includes('点我'));
    assert.ok(!rels.includes('javascript'), '不安全协议不得进入关系表');
  });
});
