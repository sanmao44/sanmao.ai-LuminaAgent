import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { prepareFilesystemEdit, callFilesystemEdit, undoFilesystemEdit } = createTsRequire(process.cwd())('./lib/mcp/filesystem-edit');

function fixture(t, name = 'target.txt') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanmao-reviewed-edit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, name);
  return { target, root, scope: { roots: [root], writeRoots: [root] } };
}

function edit(target, oldText, newText) {
  return { path: target, edits: [{ oldText, newText }] };
}

function plan(args, scope) {
  const result = prepareFilesystemEdit(args, scope);
  assert.equal(result.ok, true, result.error);
  return result.approval;
}

function approvedEdit(args, scope, approved, captureUndo) {
  return callFilesystemEdit(args, scope, { requirePreview: true, approved, captureUndo });
}

test('reviewed edit preserves UTF-8 bytes and line endings outside the replacement', async (t) => {
  const { target, root, scope } = fixture(t);
  const original = Buffer.from('\ufeffheader\r\nold line\r\nlast \t line\nnon-ASCII \u4e2d\u6587');
  const expected = Buffer.from(original.toString('utf8').replace('old line', 'longer new line').replace('last \t line', 'another line'));
  writeFileSync(target, original);
  const userNote = path.join(root, 'uncommitted-note.txt');
  const userBytes = Buffer.from('user draft\r\n');
  writeFileSync(userNote, userBytes);
  const args = edit(target, 'old line', 'longer new line');
  args.edits.push({ oldText: 'last \t line', newText: 'another line' });
  const approved = plan(args, scope);
  assert.match(approved.diff, /-old line\n\+longer new line/);
  assert.deepEqual(readFileSync(target), original);
  let undo;
  assert.equal((await approvedEdit(args, scope, approved, (record) => { undo = record; })).isError, false);
  assert.deepEqual(readFileSync(target), expected);

  assert.equal((await undoFilesystemEdit(undo, scope)).isError, false);
  assert.deepEqual(readFileSync(target), original);
  assert.deepEqual(readFileSync(userNote), userBytes);
});

test('approving an edit after another process changes the file preserves the latest bytes', async (t) => {
  const { target, scope } = fixture(t);
  writeFileSync(target, 'old line\r\n');
  const args = edit(target, 'old line', 'new line');
  const approved = plan(args, scope);
  // Leave the matching line intact so a blind replacement would still succeed.
  appendFileSync(target, 'concurrent draft\r\n');
  const latest = readFileSync(target);
  const result = await approvedEdit(args, scope, approved);
  assert.equal(result.isError, true);
  assert.match(result.text, /预览后已发生变化/);
  assert.deepEqual(readFileSync(target), latest);
});

test('an old approval, a different replacement, and revoked write access leave the file untouched', async (t) => {
  const { target, scope } = fixture(t);
  const original = 'old line\r\n';
  writeFileSync(target, original);
  const args = edit(target, 'old line', 'approved line');
  const approved = plan(args, scope);
  const legacy = await approvedEdit(args, scope, undefined);
  const changed = await approvedEdit(edit(target, 'old line', 'unreviewed line'), scope, approved);
  const revoked = await approvedEdit(args, { ...scope, writeRoots: [] }, approved);
  for (const result of [legacy, changed]) {
    assert.equal(result.isError, true);
    assert.match(result.text, /缺少可核对的预览/);
  }
  assert.equal(revoked.isError, true);
  assert.match(revoked.text, /没有任何授权目录打开写入/);
  assert.equal(readFileSync(target, 'utf8'), original);
});

test('protected configuration cannot appear in a preview even inside a writable folder', async (t) => {
  const { target, scope } = fixture(t, '.env');
  const value = 'synthetic-only-fixture';
  const original = `SYNTHETIC_VALUE=${value}\n`;
  writeFileSync(target, original);
  const args = edit(target, 'SYNTHETIC_VALUE', 'UPDATED_VALUE');
  const prepared = prepareFilesystemEdit(args, scope);
  assert.equal(prepared.ok, false);
  assert.match(prepared.error, /需要单独授权读取/);
  const preview = await callFilesystemEdit({ ...args, dryRun: true }, scope);
  assert.equal(preview.isError, true);
  assert.match(preview.text, /需要单独授权读取/);
  assert.doesNotMatch(`${preview.text} ${prepared.error}`, new RegExp(value));
  assert.equal(readFileSync(target, 'utf8'), original);
});
