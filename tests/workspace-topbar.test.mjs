import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../components/workspace-topbar-model.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { workspaceTopbarModes } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('WorkspaceTopbar keeps image, video and Agent active mode semantics', () => {
  assert.deepEqual(workspaceTopbarModes('generate'), { imageActive: true, videoActive: false, agentActive: false });
  assert.deepEqual(workspaceTopbarModes('angle'), { imageActive: true, videoActive: false, agentActive: false });
  assert.deepEqual(workspaceTopbarModes('video'), { imageActive: false, videoActive: true, agentActive: false });
  assert.deepEqual(workspaceTopbarModes('agent'), { imageActive: false, videoActive: false, agentActive: true });
});
