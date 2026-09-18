import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifactsModule } from './artifacts-build.mjs';

const artifacts = await buildArtifactsModule();

async function withStore(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-artifacts-zip-'));
  const store = artifacts.createArtifactStore({ root, cleanup: false });
  try {
    return await run(store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('能把多个 artifact 打成可解压的 zip，中文文件名保留', async () => {
  await withStore(async (store) => {
    const doc = await artifacts.generateDocumentArtifact({ filename: '方案.docx', markdown: '# 方案\n\n正文' }, store);
    const sheet = await artifacts.generateSpreadsheetArtifact({ filename: '数据.xlsx', sheets: [{ name: 'S', columns: [{ key: 'a', header: 'A' }], rows: [{ a: 1 }] }] }, store);
    const deck = await artifacts.generatePresentationArtifact({ filename: '介绍.pptx', slides: [{ layout: 'title', title: '封面' }] }, store);

    const collected = await artifacts.collectArchiveEntries([doc.artifact.id, sheet.artifact.id, deck.artifact.id], store);
    assert.equal(collected.entries.length, 3);
    assert.deepEqual(collected.missing, []);

    const result = await artifacts.generateArchiveArtifact({ filename: '项目资料包.zip', entries: collected.entries }, store);
    assert.equal(result.artifact.name, '项目资料包.zip');
    assert.equal(result.artifact.mimeType, 'application/zip');

    const buffer = await readFile((await store.read(result.artifact.id)).filePath);
    const names = Object.keys(artifacts.readArchiveEntries(buffer)).sort();
    assert.deepEqual(names, ['介绍.pptx', '数据.xlsx', '方案.docx']);
    const docPart = artifacts.readArchiveText(buffer, '方案.docx');
    assert.ok(docPart.length > 0, 'zip 里应能解出原文件内容');
  });
});

test('zip-slip 与重名条目会被清洗去重', async () => {
  const result = artifacts.buildZipArchive([
    { name: '../evil.txt', data: new Uint8Array([1, 2, 3]) },
    { name: 'C:\\Windows\\system32\\drivers\\etc\\hosts', data: new Uint8Array([4]) },
    { name: 'same.txt', data: new Uint8Array([5]) },
    { name: 'same.txt', data: new Uint8Array([6]) },
  ]);
  const names = Object.keys(artifacts.readArchiveEntries(result.buffer));
  for (const name of names) {
    assert.ok(!name.includes('..'), `不允许出现上级路径：${name}`);
    assert.ok(!name.includes('/'), `不允许出现子目录或绝对路径：${name}`);
    assert.ok(!name.includes('\\'), `不允许出现 Windows 路径分隔符：${name}`);
  }
  assert.equal(new Set(names).size, names.length, '重名条目必须去重');
  assert.ok(names.includes('evil.txt'));
  assert.ok(names.includes('hosts'));
});

test('空内容与超限条目给出明确错误或 warning', async () => {
  assert.throws(() => artifacts.buildZipArchive([]), /内容为空/);
  assert.throws(() => artifacts.buildZipArchive([{ name: 'empty.txt', data: new Uint8Array(0) }]), /内容为空/);
  const many = Array.from({ length: 70 }, (_, index) => ({ name: `f${index}.txt`, data: new Uint8Array([index]) }));
  const result = artifacts.buildZipArchive(many);
  assert.equal(Object.keys(artifacts.readArchiveEntries(result.buffer)).length, 64);
  assert.ok(result.warnings.some((warning) => warning.includes('64')));
});

test('zip 扩展名由服务端强制', () => {
  assert.equal(artifacts.resolveArchiveFileName('资料包.rar'), '资料包.zip');
  assert.equal(artifacts.resolveArchiveFileName(''), 'SANMAO-资料包.zip');
});
