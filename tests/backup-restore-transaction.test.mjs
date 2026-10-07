import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
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

test('recovers a rollback journal left by an interrupted restore', async () => {
  const journalRoot = await mkdtemp(path.join(os.tmpdir(), 'sanmao-transaction-journal-'));
  try {
    const target = path.join(journalRoot, 'state.json');
    const rollback = path.join(journalRoot, '.restore-rollback-crash', 'state.json');
    const journal = path.join(journalRoot, '.restore-rollback-crash', 'journal.json');
    await writeFile(target, 'new-state');
    await mkdir(path.join(journalRoot, '.restore-rollback-crash'), { recursive: true });
    await writeFile(rollback, 'old-state');
    await writeFile(journal, JSON.stringify([{ target, existed: true, backup: rollback, captured: true }]));
    await transactionModule.BackupRestoreTransaction.recover(journalRoot);
    assert.equal(await readFile(target, 'utf8'), 'old-state');
  } finally {
    await rm(journalRoot, { recursive: true, force: true });
  }
});

test('does not delete a live file when capture was journaled before the move completed', async () => {
  const journalRoot = await mkdtemp(path.join(os.tmpdir(), 'sanmao-transaction-pre-capture-'));
  try {
    const target = path.join(journalRoot, 'state.json');
    const rollbackRoot = path.join(journalRoot, '.restore-rollback-pre-capture');
    await writeFile(target, 'original');
    await mkdir(rollbackRoot, { recursive: true });
    await writeFile(path.join(rollbackRoot, 'journal.json'), JSON.stringify({
      phase: 'active',
      entries: [{ target, existed: true, backup: path.join(rollbackRoot, 'state.json'), captured: false }],
      operations: [],
    }));
    await transactionModule.BackupRestoreTransaction.recover(journalRoot);
    assert.equal(await readFile(target, 'utf8'), 'original');
  } finally {
    await rm(journalRoot, { recursive: true, force: true });
  }
});

test('recovers when the old file was moved before the capture marker was flushed', async () => {
  const journalRoot = await mkdtemp(path.join(os.tmpdir(), 'sanmao-transaction-mid-capture-'));
  try {
    const target = path.join(journalRoot, 'state.json');
    const rollbackRoot = path.join(journalRoot, '.restore-rollback-mid-capture');
    const rollback = path.join(rollbackRoot, 'state.json');
    await mkdir(rollbackRoot, { recursive: true });
    await writeFile(rollback, 'original');
    await writeFile(path.join(rollbackRoot, 'journal.json'), JSON.stringify({
      phase: 'active',
      entries: [{ target, existed: true, backup: rollback, captured: false }],
      operations: [],
    }));
    await transactionModule.BackupRestoreTransaction.recover(journalRoot);
    assert.equal(await readFile(target, 'utf8'), 'original');
  } finally {
    await rm(journalRoot, { recursive: true, force: true });
  }
});

test('keeps a committed transaction and only removes its journal after cutover', async () => {
  const commitRoot = await mkdtemp(path.join(os.tmpdir(), 'sanmao-transaction-commit-'));
  try {
    const target = path.join(commitRoot, 'state.json');
    await writeFile(target, 'before');
    const tx = new transactionModule.BackupRestoreTransaction(commitRoot, 'durable');
    await tx.write(target, 'after');
    const journal = path.join(commitRoot, '.restore-rollback-durable', 'journal.json');
    const committed = JSON.parse(await readFile(journal, 'utf8'));
    assert.equal(committed.phase, 'active');
    await tx.commit();
    await assert.rejects(() => readFile(journal));
    await transactionModule.BackupRestoreTransaction.recover(commitRoot);
    assert.equal(await readFile(target, 'utf8'), 'after');
  } finally {
    await rm(commitRoot, { recursive: true, force: true });
  }
});

test('multi-root cutover failure after capture restores every physical root', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'sanmao-transaction-multi-root-'));
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), 'sanmao-transaction-media-'));
  try {
    const state = path.join(dataRoot, 'state.json');
    const media = path.join(externalRoot, 'images', 'one.bin');
    await mkdir(path.dirname(media), { recursive: true });
    await writeFile(state, 'old-state');
    await writeFile(media, 'old-media');
    const tx = new transactionModule.BackupRestoreTransaction(dataRoot, 'multi-root');
    await tx.write(state, 'new-state');
    await tx.write(media, 'new-media');
    await assert.rejects(() => tx.commit({ failAfterCapture: true }), /Injected restore cutover failure/);
    await tx.rollback();
    assert.equal(await readFile(state, 'utf8'), 'old-state');
    assert.equal(await readFile(media, 'utf8'), 'old-media');
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
});
