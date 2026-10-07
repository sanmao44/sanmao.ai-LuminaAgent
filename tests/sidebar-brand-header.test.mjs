import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../components/sidebar-brand-header-model.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { sidebarToggleLabel } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('sidebar brand header preserves expanded and collapsed labels', () => {
  assert.equal(sidebarToggleLabel(false), '展开侧边栏');
  assert.equal(sidebarToggleLabel(true), '收起侧边栏');
});
