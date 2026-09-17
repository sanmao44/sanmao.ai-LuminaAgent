import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/backup-archive.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const archive = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('备份归档保留超过 100 字节的长路径', () => {
  const longName = 'skills/' + 'skill-id-0123456789abcdef'.repeat(2) + '/references/' + '资料'.repeat(10) + '/说明文档-v1.md';
  const entries = [
    { name: 'manifest.json', data: Buffer.from('{"version":2}', 'utf8') },
    { name: longName, data: Buffer.from('# 技能正文', 'utf8') },
  ];
  assert.ok(Buffer.byteLength(longName, 'utf8') > 100);
  const restored = archive.extractBackupArchive(archive.createBackupArchive(entries));
  assert.deepEqual(restored.map((entry) => entry.name), entries.map((entry) => entry.name));
  assert.deepEqual(restored[1].data, entries[1].data);
});

test('短路径不写 prefix 字段并保持二进制内容', () => {
  const data = Buffer.from([0, 1, 2, 254, 255]);
  const created = archive.createBackupArchive([{ name: 'images/a.png', data }, { name: 'server/state.json', data: Buffer.from('{}', 'utf8') }]);
  assert.equal(gunzipSync(created).subarray(345, 500).every((byte) => byte === 0), true);
  assert.deepEqual(archive.extractBackupArchive(created)[0].data, data);
});

test('无法拆分的超长文件名直接报错而不是被截断', () => {
  assert.throws(() => archive.createBackupArchive([{ name: 'x'.repeat(120), data: Buffer.alloc(1) }]), /备份文件名过长/);
});

test('拒绝路径穿越但允许文件名中出现连续点', () => {
  const created = archive.createBackupArchive([{ name: 'images/v1..2.png', data: Buffer.from('x') }]);
  assert.equal(archive.extractBackupArchive(created)[0].name, 'images/v1..2.png');
  assert.throws(() => archive.createBackupArchive([{ name: 'images/../secret.png', data: Buffer.alloc(1) }]), /备份文件名无效/);
});
