import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const route = fs.readFileSync(path.join(root, 'app/api/workspace/route.ts'), 'utf8');
const tempsSource = fs.readFileSync(path.join(root, 'lib/workspace-temps.ts'), 'utf8');
const compiled = ts.transpileModule(tempsSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const temps = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('workspace writes flush and validate before replacing the live snapshot', () => {
  assert.match(route, /writeFile\(temporary, content, \{ encoding: 'utf8', flush: true \}\)/);
  assert.match(route, /parseWorkspace\(await readFile\(temporary, 'utf8'\)\)/);
});

test('workspace reads can recover from a valid temporary snapshot after corruption', () => {
  assert.match(tempsSource, /WORKSPACE_TEMP_PATTERN = \/\^workspace\\\.json\\\.\\d\+\\\.\\d\+\\\.tmp\$\//);
  assert.match(route, /readdir\(dataDir, \{ withFileTypes: true \}\)/);
  assert.match(route, /const recovered = await recoverWorkspace\(\)/);
  assert.match(route, /if \(recovered\) return recovered/);
});

test('workspace writes clean up after failures and sweep stale temporaries', () => {
  assert.match(route, /unlink\(temporary\)\.catch\(\(\) => undefined\)/);
  assert.match(route, /await renameWorkspaceSnapshot\(temporary\)/);
  assert.match(route, /await sweepStaleWorkspaceTemps\(dataDir\)\.catch\(\(\) => 0\)/);
});

test('client restore marks the restored snapshot as the new sync baseline', () => {
  const workspace = fs.readFileSync(path.join(root, 'lib/workspace.ts'), 'utf8');
  assert.match(workspace, /writeMeta\(\{/);
  assert.match(workspace, /serverUpdatedAt: snapshot\.updatedAt/);
  assert.match(workspace, /pending: false/);
  assert.match(workspace, /contentSignature: workspaceContentSignature\(snapshot\)/);
});

test('workspace CAS exposes a conflict state without changing the snapshot shape', () => {
  const workspace = fs.readFileSync(path.join(root, 'lib/workspace.ts'), 'utf8');
  const routeSource = fs.readFileSync(path.join(root, 'app/api/workspace/route.ts'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'app/canvas.css'), 'utf8');
  assert.match(workspace, /WorkspaceSyncStatus = .*conflict/);
  assert.match(workspace, /expectedRevision/);
  assert.match(routeSource, /WORKSPACE_CONFLICT/);
  assert.match(routeSource, /contentHash/);
  assert.match(css, /workspace-sync-state\.conflict/);
});

test('sweep removes only stale workspace temporaries', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sanmao-workspace-temps-'));
  try {
    const stale = path.join(dir, 'workspace.json.111.222.tmp');
    const fresh = path.join(dir, 'workspace.json.333.444.tmp');
    const live = path.join(dir, 'workspace.json');
    const unrelated = path.join(dir, 'workspace.json.backup.tmp');
    for (const file of [stale, fresh, live, unrelated]) await writeFile(file, '{}');
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(stale, old, old);
    assert.equal(await temps.sweepStaleWorkspaceTemps(dir, { maxAgeMs: 10 * 60 * 1000 }), 1);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(fresh), true);
    assert.equal(fs.existsSync(live), true);
    assert.equal(fs.existsSync(unrelated), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
