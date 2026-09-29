import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../components/workspace-shell-model.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { workspaceShellClassName } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('WorkspaceShell preserves the root shell class contract', () => {
  assert.equal(workspaceShellClassName('agent', false), 'app-shell');
  assert.equal(workspaceShellClassName('video', true), 'app-shell video-app-shell sidebar-is-open');
  assert.equal(workspaceShellClassName('angle', true), 'app-shell angle-app-shell sidebar-is-open');
});
