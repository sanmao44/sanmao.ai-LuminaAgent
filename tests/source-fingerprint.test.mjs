import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { calculateSourceFingerprint } from '../scripts/source-fingerprint.mjs';

async function createSourceRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-source-fingerprint-'));
  await mkdir(path.join(root, 'app', 'nested'), { recursive: true });
  await mkdir(path.join(root, 'components'), { recursive: true });
  await writeFile(path.join(root, 'components', 'Card.tsx'), 'export const Card = 1;\n');
  await writeFile(path.join(root, 'app', 'nested', 'page.tsx'), 'export default 1;\n');
  await writeFile(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  await writeFile(path.join(root, '.env.local'), 'TOKEN=fixture\n');
  return root;
}

test('source fingerprint is stable across read concurrency', async (t) => {
  const root = await createSourceRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const sequential = await calculateSourceFingerprint(root, { concurrency: 1 });
  const concurrent = await calculateSourceFingerprint(root, { concurrency: 8 });
  assert.equal(concurrent, sequential);
  assert.match(concurrent, /^[a-f0-9]{64}$/);
});

test('source fingerprint detects same-size content edits when modification time is restored', async (t) => {
  const root = await createSourceRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const target = path.join(root, 'app', 'nested', 'page.tsx');
  const original = await calculateSourceFingerprint(root);
  const details = await stat(target);
  await writeFile(target, 'export default 2;\n');
  await utimes(target, details.atime, details.mtime);

  assert.equal((await readFile(target)).length, details.size);
  assert.notEqual(await calculateSourceFingerprint(root), original);
});

test('source fingerprint includes added files and returns to its prior value after deletion', async (t) => {
  const root = await createSourceRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const before = await calculateSourceFingerprint(root);
  const addedFile = path.join(root, 'public', 'icon.svg');
  await mkdir(path.dirname(addedFile), { recursive: true });
  await writeFile(addedFile, '<svg />');
  const afterAdd = await calculateSourceFingerprint(root);
  await rm(addedFile);

  assert.notEqual(afterAdd, before);
  assert.equal(await calculateSourceFingerprint(root), before);
});
