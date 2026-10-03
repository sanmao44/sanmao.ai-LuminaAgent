import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-restore-transaction-'));
const transactionModule = createTsRequire(process.cwd())('./lib/backup-restore-transaction');
test.after(() => rm(root, { recursive: true, force: true }));

test('restore transaction rolls back replaced and newly created files', async () => {
  const existing = path.join(root, 'state.json');
  const created = path.join(root, 'nested', 'media.bin');
  await writeFile(existing, 'old-state');
  const transaction = new transactionModule.BackupRestoreTransaction(root, 'test');
  await transaction.write(existing, 'new-state');
  await transaction.write(created, Buffer.from([1, 2, 3]));
  await transaction.rollback();
  assert.equal(await readFile(existing, 'utf8'), 'old-state');
  await assert.rejects(() => readFile(created));
});

test('successful restore removes rollback files and keeps new content', async () => {
  const existing = path.join(root, 'settings.json');
  await writeFile(existing, 'before');
  const transaction = new transactionModule.BackupRestoreTransaction(root, 'commit');
  await transaction.write(existing, 'after');
  await transaction.commit();
  assert.equal(await readFile(existing, 'utf8'), 'after');
  await assert.rejects(() => readFile(path.join(root, '.restore-rollback-commit', 'settings.json')));
});
