import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/backup-archive.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const archive = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('disk-backed archive source round trips through the streaming tar writer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sanmao-backup-'));
  try {
    const file = join(root, 'large.bin');
    const data = Buffer.alloc(2 * 1024 * 1024 + 17, 9);
    await writeFile(file, data);
    const created = await archive.createBackupArchive([{ name: 'videos/large.bin', filePath: file, size: data.length }]);
    const restored = await archive.extractBackupArchiveStreaming(created);
    assert.deepEqual(restored[0].data, data);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('extracts archive entries to staging files with checksums', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sanmao-backup-stage-'));
  try {
    const data = Buffer.alloc(2 * 1024 * 1024 + 17, 3);
    const archiveBytes = await archive.createBackupArchive([{ name: 'videos/large.bin', data }]);
    const archivePath = join(root, 'archive.gz');
    const stage = join(root, 'entries');
    await writeFile(archivePath, archiveBytes);
    const entries = await archive.extractBackupArchiveFile(archivePath, stage);
    assert.equal(entries[0].size, data.length);
    assert.equal(entries[0].sha256, archive.sha256(data));
    assert.deepEqual(await readFile(entries[0].filePath), data);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
