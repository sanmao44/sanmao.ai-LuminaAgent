import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

async function loadTypeScript(sourcePath) {
  const sourceUrl = new URL(sourcePath, import.meta.url);
  const source = await readFile(sourceUrl, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const paths = await loadTypeScript('../lib/data-paths.ts');

test('linked worktrees resolve provider config to the primary checkout', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'sanmao-data-paths-'));
  try {
    const primaryRoot = path.join(fixture, 'primary');
    const worktreeRoot = path.join(fixture, 'worktree');
    const worktreeGitDir = path.join(primaryRoot, '.git', 'worktrees', 'feature');
    await mkdir(path.join(primaryRoot, '.git'), { recursive: true });
    await mkdir(worktreeGitDir, { recursive: true });
    await mkdir(worktreeRoot, { recursive: true });
    await writeFile(path.join(worktreeRoot, '.git'), `gitdir: ${worktreeGitDir}\n`);
    await writeFile(path.join(worktreeGitDir, 'commondir'), '../..\n');

    assert.equal(paths.resolveMainWorktreeRoot(path.join(worktreeRoot, 'app')), primaryRoot);
    assert.equal(paths.resolveProviderConfigDir(worktreeRoot, { dataDir: '', providerConfigDir: '' }), path.join(primaryRoot, '.data'));
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('explicit provider and data directories override automatic worktree sharing', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'sanmao-data-paths-'));
  try {
    assert.equal(
      paths.resolveProviderConfigDir(fixture, { dataDir: 'local-data', providerConfigDir: 'provider-config' }),
      path.join(fixture, 'provider-config'),
    );
    assert.equal(
      paths.resolveProviderConfigDir(fixture, { dataDir: 'local-data', providerConfigDir: '' }),
      path.join(fixture, 'local-data'),
    );
    assert.equal(paths.resolveLocalDataDir(fixture, ''), path.join(fixture, '.data'));
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('normal checkouts and non-git directories keep local provider config', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'sanmao-data-paths-'));
  try {
    const checkout = path.join(fixture, 'checkout');
    const plain = path.join(fixture, 'plain');
    await mkdir(path.join(checkout, '.git'), { recursive: true });
    await mkdir(plain, { recursive: true });
    assert.equal(paths.resolveProviderConfigDir(checkout), path.join(checkout, '.data'));
    assert.equal(paths.resolveProviderConfigDir(plain), path.join(plain, '.data'));
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
