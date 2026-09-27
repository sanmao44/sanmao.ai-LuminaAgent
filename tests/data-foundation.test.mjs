import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
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
const manifest = await loadTypeScript('../lib/data-manifest.ts');

test('data profiles preserve development defaults and support explicit modes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-data-profile-'));
  try {
    assert.equal(paths.resolveDataProfile(root, {}).mode, 'development');
    assert.equal(paths.resolveDataProfile(root, {}).dataDir, path.join(root, '.data'));
    assert.equal(paths.resolveDataProfile(root, { SANMAO_PORTABLE: '1' }).mode, 'portable');
    assert.equal(paths.resolveDataProfile(root, { SANMAO_PORTABLE: '1' }).dataDir, path.join(root, 'data'));
    assert.equal(paths.resolveDataProfile(root, { SANMAO_INSTALL_MODE: 'installed', LOCALAPPDATA: path.join(root, 'LocalAppData') }).dataDir, path.join(root, 'LocalAppData', 'SANMAO.AI'));
    assert.equal(paths.resolveDataProfile(root, { SANMAO_DATA_DIR: 'custom-data', SANMAO_INSTALL_MODE: 'installed' }).mode, 'custom');
    assert.equal(paths.resolveDataProfile(root, { SANMAO_DATA_DIR: 'custom-data', SANMAO_INSTALL_MODE: 'installed' }).dataDir, path.join(root, 'custom-data'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('initial manifest starts unknown components at legacy versions', () => {
  const value = manifest.initialDataManifest('development', '2026-09-23T00:00:00.000Z');
  assert.equal(value.activeGeneration, 'legacy');
  assert.equal(value.components.workspace, 0);
  assert.equal(value.components.indexedDb, 0);
  assert.equal(value.components.canvas, 'legacy');
  assert.equal(manifest.validateDataManifest(value).format, 'sanmao-local-data');
});

test('manifest detection adopts native versions already on disk', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-data-detect-'));
  try {
    const dataDir = path.join(root, '.data');
    const providerConfigDir = path.join(root, 'provider');
    await mkdir(dataDir, { recursive: true });
    await mkdir(providerConfigDir, { recursive: true });
    await writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify({ schemaVersion: 1 }));
    await writeFile(path.join(dataDir, 'media-roots.json'), JSON.stringify({ version: 1, roots: {} }));
    await writeFile(path.join(providerConfigDir, 'state.json'), JSON.stringify({ schemaVersion: 3 }));
    const detected = await manifest.detectDataComponentVersions({ dataDir, providerConfigDir });
    assert.equal(detected.workspace, 1);
    assert.equal(detected.providerConfig, 3);
    assert.equal(detected.mediaRoots, 1);
    assert.equal(detected.backupArchive, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('manifest rejects unknown profile modes instead of silently accepting corrupted metadata', () => {
  assert.throws(() => manifest.validateDataManifest({
    format: 'sanmao-local-data',
    manifestVersion: 1,
    profileMode: 'future-mode',
    components: {},
    activeGeneration: 'legacy',
    updatedAt: '2026-09-23T00:00:00.000Z',
  }), /manifest/);
});

test('manifest rejects known components from a newer application', () => {
  const value = manifest.initialDataManifest('development');
  assert.throws(() => manifest.assertSupportedDataManifest({
    ...value,
    components: { ...value.components, indexedDb: 99 },
  }), /高于当前程序支持的版本/);
  assert.throws(() => manifest.assertSupportedDataManifest({
    ...value,
    components: { ...value.components, canvas: 'sanmao-canvas-99' },
  }), /高于当前程序支持的版本/);
});
