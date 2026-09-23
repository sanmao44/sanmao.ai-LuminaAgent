import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

const migrations = await loadTypeScript('../lib/migrations/framework.ts');

function baseManifest() {
  return {
    format: 'sanmao-local-data',
    manifestVersion: 1,
    profileMode: 'development',
    components: { workspace: 1 },
    activeGeneration: 'legacy',
    updatedAt: '2026-09-23T00:00:00.000Z',
  };
}

test('metadata migrations use staging and commit marker without copying media', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-migration-'));
  try {
    let saved = baseManifest();
    const result = await migrations.runMigrations({
      dataDir,
      manifest: saved,
      target: { workspace: 2 },
      commit: async ({ dataDir, stagingDir }) => { await copyFile(path.join(stagingDir, 'workspace.json'), path.join(dataDir, 'workspace.json')); },
      writeManifest: async (value) => { saved = value; },
      now: () => '2026-09-23T00:00:00.000Z',
      steps: [{
        id: 'workspace-1-to-2',
        component: 'workspace',
        from: 1,
        to: 2,
        run: async (context) => { await context.writeJson('workspace.json', { migrated: true }); },
        verify: async (context) => { assert.deepEqual(await context.readJson('workspace.json'), { migrated: true }); },
      }],
    });
    assert.equal(result.migrated, true);
    assert.equal(saved.components.workspace, 2);
    assert.match(saved.activeGeneration, /^mig-/);
    const root = path.join(dataDir, 'migrations', saved.activeGeneration);
    assert.equal(JSON.parse(await readFile(path.join(root, 'commit.json'), 'utf8')).migrationId, saved.activeGeneration);
    assert.equal(JSON.parse(await readFile(path.join(root, 'journal.json'), 'utf8')).status, 'committed');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('failed migrations keep the original manifest and leave a failed journal', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-migration-failed-'));
  try {
    const original = baseManifest();
    let saved = original;
    await assert.rejects(() => migrations.runMigrations({
      dataDir,
      manifest: original,
      target: { workspace: 2 },
      commit: async () => { throw new Error('commit failure'); },
      writeManifest: async (value) => { saved = value; },
      steps: [{ id: 'broken', component: 'workspace', from: 1, to: 2, run: async () => { throw new Error('synthetic failure'); } }],
    }), /synthetic failure/);
    assert.deepEqual(saved, original);
    const migrationDirs = await readdir(path.join(dataDir, 'migrations'));
    const journal = JSON.parse(await readFile(path.join(dataDir, 'migrations', migrationDirs[0], 'journal.json'), 'utf8'));
    assert.equal(journal.status, 'failed');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a commit failure restores metadata without touching external media', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-migration-rollback-'));
  try {
    const original = baseManifest();
    await writeFile(path.join(dataDir, 'workspace.json'), '{"old":true}\n');
    await writeFile(path.join(dataDir, 'large-media.bin'), Buffer.alloc(32));
    await assert.rejects(() => migrations.runMigrations({
      dataDir,
      manifest: original,
      target: { workspace: 2 },
      commit: async ({ dataDir, stagingDir }) => {
        await copyFile(path.join(stagingDir, 'workspace.json'), path.join(dataDir, 'workspace.json'));
        throw new Error('commit interrupted');
      },
      writeManifest: async () => {},
      steps: [{
        id: 'workspace-1-to-2', component: 'workspace', from: 1, to: 2,
        run: async (context) => { await context.writeJson('workspace.json', { migrated: true }); },
      }],
    }), /commit interrupted/);
    assert.equal(await readFile(path.join(dataDir, 'workspace.json'), 'utf8'), '{"old":true}\n');
    assert.equal((await readFile(path.join(dataDir, 'large-media.bin'))).byteLength, 32);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('startup completes a commit whose manifest write was interrupted', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-migration-recover-'));
  try {
    const original = baseManifest();
    let failedManifestWrite = true;
    await assert.rejects(() => migrations.runMigrations({
      dataDir,
      manifest: original,
      target: { workspace: 2 },
      commit: async ({ dataDir, stagingDir }) => { await copyFile(path.join(stagingDir, 'workspace.json'), path.join(dataDir, 'workspace.json')); },
      writeManifest: async () => { if (failedManifestWrite) { failedManifestWrite = false; throw new Error('manifest write interrupted'); } },
      steps: [{
        id: 'workspace-1-to-2', component: 'workspace', from: 1, to: 2,
        run: async (context) => { await context.writeJson('workspace.json', { migrated: true }); },
      }],
    }), /manifest write interrupted/);
    let recovered = original;
    const result = await migrations.recoverPendingMigrations({
      dataDir,
      manifest: original,
      writeManifest: async (value) => { recovered = value; },
    });
    assert.deepEqual(result.recovered, [recovered.lastMigrationId]);
    assert.equal(recovered.components.workspace, 2);
    assert.equal(JSON.parse(await readFile(path.join(dataDir, 'workspace.json'), 'utf8')).migrated, true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('startup recovery supports journals from before rollbackPath was persisted', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-migration-legacy-journal-'));
  try {
    const original = baseManifest();
    const root = path.join(dataDir, 'migrations', 'mig-legacy');
    await mkdir(path.join(root, 'rollback'), { recursive: true });
    await writeFile(path.join(dataDir, 'workspace.json'), '{"old":true}\n');
    await writeFile(path.join(root, 'rollback', 'index.json'), JSON.stringify([{ relativePath: 'workspace.json', existed: true }]));
    await writeFile(path.join(root, 'journal.json'), JSON.stringify({
      format: 'sanmao-migration-journal', version: 1, migrationId: 'mig-legacy', status: 'verified',
      source: { workspace: 1 }, target: { workspace: 2 }, stagingPath: path.join(root, 'staging'),
      completedSteps: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }));
    let recovered = original;
    const result = await migrations.recoverPendingMigrations({ dataDir, manifest: original, writeManifest: async (value) => { recovered = value; } });
    assert.deepEqual(result.rolledBack, ['mig-legacy']);
    assert.equal(recovered.components.workspace, 1);
    assert.equal(JSON.parse(await readFile(path.join(dataDir, 'workspace.json'), 'utf8')).old, true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
