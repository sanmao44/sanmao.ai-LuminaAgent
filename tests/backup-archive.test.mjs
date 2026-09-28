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

test('备份归档保留超过 100 字节的长路径', async () => {
  const longName = 'skills/' + 'skill-id-0123456789abcdef'.repeat(2) + '/references/' + '资料'.repeat(10) + '/说明文档-v1.md';
  const entries = [
    { name: 'manifest.json', data: Buffer.from('{"version":2}', 'utf8') },
    { name: longName, data: Buffer.from('# 技能正文', 'utf8') },
  ];
  assert.ok(Buffer.byteLength(longName, 'utf8') > 100);
  const restored = archive.extractBackupArchive(await archive.createBackupArchive(entries));
  assert.deepEqual(restored.map((entry) => entry.name), entries.map((entry) => entry.name));
  assert.deepEqual(restored[1].data, entries[1].data);
});

test('短路径不写 prefix 字段并保持二进制内容', async () => {
  const data = Buffer.from([0, 1, 2, 254, 255]);
  const created = await archive.createBackupArchive([{ name: 'images/a.png', data }, { name: 'server/state.json', data: Buffer.from('{}', 'utf8') }]);
  assert.equal(gunzipSync(created).subarray(345, 500).every((byte) => byte === 0), true);
  assert.deepEqual(archive.extractBackupArchive(created)[0].data, data);
});

test('无法拆分的超长文件名直接报错而不是被截断', async () => {
  await assert.rejects(archive.createBackupArchive([{ name: 'x'.repeat(120), data: Buffer.alloc(1) }]), /备份文件名过长/);
});

test('拒绝路径穿越但允许文件名中出现连续点', async () => {
  const created = await archive.createBackupArchive([{ name: 'images/v1..2.png', data: Buffer.from('x') }]);
  assert.equal(archive.extractBackupArchive(created)[0].name, 'images/v1..2.png');
  await assert.rejects(archive.createBackupArchive([{ name: 'images/../secret.png', data: Buffer.alloc(1) }]), /备份文件名无效/);
});

test('去掉逐条复制后归档仍按 512 字节对齐填充', async () => {
  const data = Buffer.alloc(600, 7);
  const tar = gunzipSync(await archive.createBackupArchive([{ name: 'a.bin', data }]));
  // 头部 512 + 数据 600 补齐到 1024 + 结尾两块 1024
  assert.equal(tar.length, 2560);
  assert.deepEqual(tar.subarray(512, 1112), data);
  assert.equal(tar.subarray(1112, 1536).every((byte) => byte === 0), true);
  assert.equal(tar.subarray(1536, 2560).every((byte) => byte === 0), true);

  const aligned = gunzipSync(await archive.createBackupArchive([{ name: 'b.bin', data: Buffer.alloc(512, 3) }]));
  assert.equal(aligned.length, 2048);
  assert.equal(aligned.subarray(1024, 2048).every((byte) => byte === 0), true);
});

test('导出预算在超限的那一刻就停下，并给出恢复上限', () => {
  const budget = archive.createArchiveBudget(1024, '4GB');
  budget.add(600, 'images/a.png');
  // 负数不能把已占用抹掉
  budget.add(-9999, 'ignored');
  assert.equal(budget.used(), 600);
  budget.add(424, 'videos/b.mp4');
  assert.equal(budget.used(), 1024);
  assert.throws(() => budget.add(1, 'videos/c.mp4'), /备份体积超过恢复上限 4GB（已到 videos\/c\.mp4）/);
  assert.equal(budget.used(), 1025);
});
