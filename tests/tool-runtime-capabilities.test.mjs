import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(process.cwd());
const capabilities = load('./packages/tool-runtime/native-capabilities');

test('native web capability returns bounded tool results and preserves search state', async () => {
  const result = await capabilities.executeWebCapability({
    callId: 'web-1',
    args: { query: 'sanmao' },
    signal: new AbortController().signal,
    searchWeb: async (query) => ({ query, results: [{ title: 'result' }] }),
    formatWebSearchContext: (value) => `context:${value.query}`,
  });
  assert.equal(result.webSearchData.query, 'sanmao');
  assert.equal(JSON.parse(result.message.content), 'context:sanmao');
});

test('native file capability normalizes multiple generated files through its port', () => {
  const result = capabilities.executeFileCapability({
    callId: 'file-1',
    args: { files: [{ name: 'a.txt' }, { name: 'b.txt' }] },
    signal: new AbortController().signal,
    normalizeGeneratedFile: (raw) => ({ name: raw.name, size: 4 }),
  });
  assert.equal(result.files.length, 2);
  assert.deepEqual(JSON.parse(result.message.content), { ok: true, count: 2, files: [{ name: 'a.txt', size: 4 }, { name: 'b.txt', size: 4 }] });
});

test('native canvas capability validates before returning an accepted patch', () => {
  const patch = { version: 1, operations: [{ op: 'remove_nodes', ids: ['node-1'] }] };
  const result = capabilities.executeCanvasCapability({
    callId: 'canvas-1',
    args: {},
    signal: new AbortController().signal,
    canvasDocument: { nodes: [{ id: 'node-1' }] },
    parseToolArguments: () => patch,
    validateCanvasPatch: (_document, candidate) => candidate.operations.length ? { ok: true } : { ok: false, error: 'empty' },
    runId: 'run-1',
  });
  assert.equal(result.canvasPatch.runId, 'run-1');
  assert.equal(JSON.parse(result.message.content).ok, true);
});

test('worker task control uses the worker-owned service boundary', async () => {
  const worker = load('./apps/worker/task-entry');
  let observed = 0;
  const result = await worker.runVideoTask('video-1', async (taskId) => {
    observed += 1;
    return { id: taskId, status: 'running' };
  }, { emit: async (event) => { assert.equal(event.kind, 'task'); } });
  assert.equal(observed, 1);
  assert.equal(result.status, 'running');
});

test('image capability normalizes ordered prompt batches at the runtime boundary', () => {
  const image = load('./packages/tool-runtime/image-capability');
  const result = image.normalizeImagePromptBatch({
    args: { prompts: [' first ', 'second', ''] },
    latestInstruction: '生成套图',
    fallbackImagePrompt: 'fallback',
    isBareImageExecution: () => false,
    extractBatchPrompts: () => [],
  });
  assert.deepEqual(result.prompts, ['first', 'second']);
  assert.equal(result.count, 1);
});


test('artifact capability executes through its runtime port and returns metadata only', async () => {
  const { executeArtifactCapability } = load('./packages/tool-runtime/artifact-capability');
  const state = { generatedFiles: [], generatedArtifactCount: 0 };
  const result = await executeArtifactCapability({ state, call: { id: 'artifact-1', function: { name: 'document_generate' } }, args: { filename: 'part-b-runtime-contract.docx', markdown: '# Runtime contract' }, signal: new AbortController().signal });
  const payload = JSON.parse(String(result.content));
  assert.equal(payload.ok, true);
  assert.equal(typeof payload.file.artifactId, 'string');
  assert.equal('content' in payload.file, false);
  assert.equal(state.generatedFiles.length, 1);
});

test('skill capability executes search through the runtime port', async () => {
  const { executeSkillCapability } = load('./packages/tool-runtime/skill-capability');
  const state = { generatedFiles: [], generatedArtifactCount: 0, skillToolCalls: 0, skillInstalls: 0, usedSkills: [] };
  const result = await executeSkillCapability({ state, call: { id: 'skill-1', function: { name: 'skill_search' } }, args: { query: 'runtime' }, skillContext: { settings: { enabled: true, autoApprove: false }, skills: [{ id: 'runtime', name: 'Runtime', description: 'runtime guidance', tags: ['runtime'], body: 'body', enabled: true }], pending: [], indexSection: '', toolHint: '' }, signal: new AbortController().signal, installer: { kind: 'agent', name: 'test', detail: 'test' }, parseToolArguments: () => ({}) });
  const payload = JSON.parse(String(result.content));
  assert.equal(payload.ok, true);
  assert.equal(payload.skills[0].id, 'runtime');
  assert.equal(state.skillToolCalls, 1);
});
