import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTypeScript(path) {
  const sourceUrl = new URL(path, import.meta.url);
  const source = await readFile(sourceUrl, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceUrl.pathname,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

const format = await loadTypeScript('../lib/workspace-format.ts');

function emptyWorkspace(overrides = {}) {
  return {
    schemaVersion: 1,
    updatedAt: 10,
    clientId: 'browser-a',
    canvas: { projects: [], documents: {}, ui: {} },
    gallery: [],
    chatSessions: [],
    assetIndex: [],
    assetCollections: [{ id: 'all', builtin: true }],
    preferences: {},
    ...overrides,
  };
}

test('validates complete workspace snapshots and rejects malformed data', () => {
  const workspace = emptyWorkspace();
  assert.deepEqual(format.validateWorkspaceShape(workspace), workspace);
  assert.throws(() => format.validateWorkspaceShape({ ...workspace, schemaVersion: 99 }), /版本/);
  assert.throws(() => format.validateWorkspaceShape({ ...workspace, preferences: { theme: 1 } }), /偏好/);
  assert.throws(() => format.validateWorkspaceShape({ ...workspace, canvas: { projects: [], documents: [] } }), /画布/);
});

test('content signature ignores transport metadata but detects workspace changes', () => {
  const first = emptyWorkspace();
  const second = { ...first, updatedAt: 20, clientId: 'browser-b' };
  assert.equal(format.workspaceContentSignature(first), format.workspaceContentSignature(second));
  assert.notEqual(
    format.workspaceContentSignature(first),
    format.workspaceContentSignature({ ...first, preferences: { 'sanmao-theme': 'dark' } }),
  );
});

test('recognizes custom asset collections as real first-run data', () => {
  const empty = emptyWorkspace();
  assert.equal(format.workspaceHasData(empty), false);
  assert.equal(format.workspaceHasData({ ...empty, assetCollections: [...empty.assetCollections, { id: 'ideas' }] }), true);
  assert.equal(format.workspaceHasData({ ...empty, gallery: [{ id: 'image-1' }] }), true);
});
