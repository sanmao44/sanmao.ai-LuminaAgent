import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/backup-crypto.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const crypto = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('encrypts and decrypts a backup payload with a separate password', () => {
  const payload = Buffer.from('SANMAO backup payload');
  const encrypted = crypto.encryptBackupPayload(payload, 'correct-local-password');
  assert.equal(crypto.isEncryptedBackup(encrypted), true);
  assert.deepEqual(crypto.decryptBackupPayload(encrypted, 'correct-local-password'), payload);
});

test('rejects short or incorrect backup passwords without exposing plaintext', () => {
  assert.throws(() => crypto.encryptBackupPayload(Buffer.from('x'), 'short'), /至少需要 12/);
  const encrypted = crypto.encryptBackupPayload(Buffer.from('secret'), 'correct-local-password');
  assert.throws(() => crypto.decryptBackupPayload(encrypted, 'wrong-local-password'), /密码错误或备份文件已被篡改/);
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => crypto.decryptBackupPayload(tampered, 'correct-local-password'), /密码错误或备份文件已被篡改/);
});

test('decrypts the v1 envelope from disk without a full payload buffer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sanmao-crypto-'));
  try {
    const payload = Buffer.alloc(2 * 1024 * 1024 + 31, 5);
    const encrypted = crypto.encryptBackupPayload(payload, 'correct-local-password');
    const input = join(root, 'input.backup');
    const output = join(root, 'output.archive');
    await writeFile(input, encrypted);
    assert.equal(await crypto.isEncryptedBackupFile(input), true);
    await crypto.decryptBackupFile(input, output, 'correct-local-password');
    assert.deepEqual(await readFile(output), payload);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

