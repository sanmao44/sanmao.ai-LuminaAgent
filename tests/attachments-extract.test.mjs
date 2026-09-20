import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import { buildArtifactsModule } from './artifacts-build.mjs';
import { buildAttachmentsModule } from './attachments-build.mjs';

const artifacts = await buildArtifactsModule();
const attachments = await buildAttachmentsModule();

async function withStore(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-attachments-'));
  const store = artifacts.createArtifactStore({ root, cleanup: false });
  try {
    return await run(store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const bufferOf = async (store, artifact) => readFile((await store.read(artifact.id)).filePath);

/**
 * 手写一份最小 PDF：只用一个标准字体的文字对象，离线可跑，也不需要额外依赖。
 * 故意不写 xref，pdfjs 会自己重建（控制台那行 Indexing all PDF objects 就是它）。
 */
function tinyPdf(lines) {
  const stream = lines.map((line, index) => `BT /F1 16 Tf 20 ${160 - index * 24} Td (${line}) Tj ET`).join('\n');
  return Buffer.from([
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${stream.length} >> stream`,
    stream,
    'endstream endobj',
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    'trailer << /Root 1 0 R /Size 6 >>',
    '%%EOF',
  ].join('\n'), 'latin1');
}

test('docx 抽正文与表格，忽略样式标记', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateDocumentArtifact({
      filename: '季度目标',
      title: '季度目标',
      markdown: '# 季度目标\n\n本季度重点是 Office 解析。\n\n- 完成 Word\n- 完成 Excel\n\n| 指标 | 目标 |\n| --- | --- |\n| 交付 | 3 类文件 |\n',
    }, store);
    const parsed = await attachments.extractAttachmentText('季度目标.docx', await bufferOf(store, result.artifact));
    assert.equal(parsed.truncated, false);
    assert.match(parsed.text, /季度目标/);
    assert.match(parsed.text, /本季度重点是 Office 解析。/);
    assert.match(parsed.text, /完成 Excel/);
    assert.match(parsed.text, /指标 \| 目标/);
    assert.match(parsed.text, /交付 \| 3 类文件/);
    assert.doesNotMatch(parsed.text, /<w:/, '抽出来必须是纯文字');
  });
});

test('xlsx 按工作表抽成 TSV，隐藏表与超限行列都不进上下文', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('销售数据');
  sheet.addRow(['月份', '占比', '销售额']);
  sheet.addRow(['1月', 0.1234, 120000]);
  sheet.addRow(['合计', null, { formula: 'SUM(C2:C2)' }]);
  sheet.getCell('B2').numFmt = '0.0%';
  const hidden = workbook.addWorksheet('内部');
  hidden.state = 'hidden';
  hidden.addRow(['不该出现的文字']);
  const wide = workbook.addWorksheet('超限');
  // 在线预览的行上限是 400（lib/artifacts/limits.ts 的 PREVIEW_MAX_ROWS），这里故意多写 20 行。
  for (let index = 0; index < 420; index += 1) wide.addRow([`行${index + 1}`]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const parsed = await attachments.extractAttachmentText('销售.xlsx', new Uint8Array(buffer));
  assert.match(parsed.text, /【工作表：销售数据】/);
  assert.match(parsed.text, /月份\t占比\t销售额/);
  assert.match(parsed.text, /1月\t12\.3%\t120000/);
  assert.match(parsed.text, /=SUM\(C2:C2\)/, '没有缓存结果的公式要退回公式本身');
  assert.doesNotMatch(parsed.text, /不该出现的文字/, '隐藏工作表不参与解析');
  assert.equal(parsed.truncated, true, '行数超限要标记截断');
  assert.doesNotMatch(parsed.text, /行420/, '超出上限的行不抽');
});

test('pptx 按页抽文字，并带上演讲者备注', async () => {
  const pptx = new PptxGenJS();
  const slide = pptx.addSlide();
  slide.addText('SANMAO 产品介绍', { x: 0.5, y: 0.5, w: 8, h: 1, fontSize: 28 });
  slide.addText('核心能力', { x: 0.5, y: 1.6, w: 8, h: 1 });
  slide.addNotes('开场先讲交付效率。');
  const buffer = Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));

  const parsed = await attachments.extractAttachmentText('介绍.pptx', new Uint8Array(buffer));
  assert.match(parsed.text, /【第 1 页】/);
  assert.match(parsed.text, /SANMAO 产品介绍/);
  assert.match(parsed.text, /核心能力/);
  assert.match(parsed.text, /（备注）开场先讲交付效率。/);
});

test('pdf 抽文字层', async () => {
  const parsed = await attachments.extractAttachmentText('样例.pdf', new Uint8Array(tinyPdf(['Hello SANMAO'])));
  assert.match(parsed.text, /【第 1 页】/);
  assert.match(parsed.text, /Hello SANMAO/);
});

test('坏文件给出中文原因，不支持的类型返回 null', async () => {
  await assert.rejects(
    () => attachments.extractAttachmentText('假的.docx', new Uint8Array(Buffer.from('这不是压缩包'))),
    /读不出来/,
  );
  await assert.rejects(
    () => attachments.extractAttachmentText('空的.docx', new Uint8Array()),
    /空的/,
  );
  await assert.rejects(
    () => attachments.extractAttachmentText('扫描件.pdf', new Uint8Array(Buffer.from('not a pdf'))),
    /读不出来/,
  );
  assert.equal(await attachments.extractAttachmentText('笔记.txt', new Uint8Array(Buffer.from('纯文本'))), null);
  assert.equal(attachments.isBinaryAttachmentName('报告.DOCX'), true);
  assert.equal(attachments.isBinaryAttachmentName('报告.doc'), false, '老二进制格式不在支持范围');
  assert.equal(attachments.isBinaryAttachmentName('笔记.txt'), false);
});

test('上传链路把 Office/PDF 交给服务端解析，文本文件仍走本地读取', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const route = await readFile(new URL('../app/api/attachments/extract/route.ts', import.meta.url), 'utf8');
  for (const extension of ['docx', 'xlsx', 'pptx', 'pdf']) assert.match(page, new RegExp(`'${extension}'`));
  assert.match(page, /fetch\('\/api\/attachments\/extract'/);
  assert.match(page, /form\.append\('file', file\)/);
  assert.match(page, /const binaryAttachmentMaxBytes = 20 \* 1024 \* 1024/);
  assert.match(page, /sourceSize: file\.size/);
  assert.match(page, /truncated: Boolean\(data\?\.truncated\)/);
  assert.match(page, /const agentReferenceAccept = `\$\{referenceAccept\},\.docx,\.xlsx,\.pptx,\.pdf`/);
  assert.match(page, /accept: agentReferenceAccept/);
  assert.match(route, /isTrustedAppRequest\(request\)/);
  assert.match(route, /file\.size > ATTACHMENT_MAX_BYTES/);
  assert.match(route, /text: parsed\.text/);
});