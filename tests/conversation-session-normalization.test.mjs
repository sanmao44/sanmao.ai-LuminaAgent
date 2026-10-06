import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/conversation/session-normalization.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const normalization = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const image = {
  id: 'image-1',
  url: '/image.png',
  prompt: '',
  source: 'generate',
  createdAt: 1,
  favorite: false,
};

function session(messages, extra = {}) {
  return {
    id: 'session-1',
    title: '会话',
    createdAt: 1,
    updatedAt: 1,
    messages,
    ...extra,
  };
}

test('normalizes assistant images and preserves already-marked sources', () => {
  const result = normalization.normalizeAssistantImageSources([
    { id: 'user', role: 'user', content: 'hi', images: [image] },
    { id: 'assistant', role: 'assistant', content: 'ok', images: [image] },
    { id: 'marked', role: 'assistant', content: 'ok', images: [{ ...image, source: 'agent' }] },
  ]);

  assert.equal(result[0].images[0].source, 'generate');
  assert.equal(result[1].images[0].source, 'agent');
  assert.equal(result[2].images[0].source, 'agent');
});

test('projects legacy assistant messages into one virtual version and clamps index', () => {
  const message = {
    id: 'assistant',
    role: 'assistant',
    content: 'answer',
    webSearch: { query: 'q' },
    activeVersion: 99,
  };

  assert.deepEqual(normalization.messageVersionsFor(message), [{
    id: 'assistant-v1',
    content: 'answer',
    images: undefined,
    files: undefined,
    interrupted: undefined,
    webSearch: { query: 'q' },
    webSearchDecision: undefined,
    task: undefined,
    durationSeconds: undefined,
    createdAt: 0,
  }]);
  assert.equal(normalization.messageVersionIndex(message), 0);
});

test('applies a version while retaining message-level search metadata', () => {
  const message = {
    id: 'assistant',
    role: 'assistant',
    content: 'old',
    webSearch: { query: 'q' },
  };
  const version = {
    id: 'assistant-v2',
    content: 'new',
    createdAt: 2,
  };
  const result = normalization.applyMessageVersion(message, [version], 0);

  assert.equal(result.content, 'new');
  assert.deepEqual(result.webSearch, message.webSearch);
  assert.equal(result.activeVersion, 0);
  assert.deepEqual(result.versions, [version]);
});

test('converts persisted pending messages to interrupted and fills project fallback', () => {
  const result = normalization.normalizeChatSession(session([
    {
      id: 'pending',
      role: 'assistant',
      content: '  ',
      pending: true,
      activity: 'working',
      pendingSince: 10,
    },
  ]), 'creative-project');

  assert.equal(result.projectId, 'creative-project');
  assert.equal(result.messages[0].interrupted, true);
  assert.equal(result.messages[0].content, '本轮回答在页面刷新或重启后中断。');
  assert.equal('pending' in result.messages[0], false);
  assert.equal('activity' in result.messages[0], false);
  assert.equal('pendingSince' in result.messages[0], false);
});

test('normalizes stored versions and keeps a valid project id', () => {
  const result = normalization.normalizeChatSession(session([
    {
      id: 'assistant',
      role: 'assistant',
      content: 'old',
      activeVersion: 20,
      versions: [
        { id: 'v1', content: 'first', createdAt: 1 },
        { id: 'v2', content: 'second', images: [image], createdAt: 2 },
      ],
    },
  ], { projectId: '  project-1  ' }), 'fallback');

  assert.equal(result.projectId, 'project-1');
  assert.equal(result.messages[0].content, 'second');
  assert.equal(result.messages[0].activeVersion, 1);
  assert.equal(result.messages[0].images[0].source, 'agent');
});
