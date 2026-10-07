import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/share-conversation-selection.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const selection = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('groups each user message with its following assistant reply', () => {
  const groups = selection.buildShareConversationGroups([
    { id: 'u1', role: 'user', content: '第一个问题' },
    { id: 'a1', role: 'assistant', content: '第一个回答' },
    { id: 'u2', role: 'user', content: '第二个问题' },
    { id: 'a2', role: 'assistant', content: '第二个回答' },
    { id: 'a3', role: 'assistant', content: '没有用户消息的助手补充' },
  ]);

  assert.deepEqual(groups.map((group) => group.messageIds), [
    ['u1', 'a1'],
    ['u2', 'a2'],
    ['a3'],
  ]);
  assert.ok(groups.every((group) => group.selectable));
});

test('pending groups are visible but cannot be selected', () => {
  const groups = selection.buildShareConversationGroups([
    { id: 'u1', role: 'user', content: '正在等待回答的问题' },
    { id: 'a1', role: 'assistant', content: '正在准备回答…', pending: true },
    { id: 'u2', role: 'user', content: '已完成的问题' },
    { id: 'a2', role: 'assistant', content: '已完成的回答' },
  ]);

  assert.equal(groups[0].complete, false);
  assert.equal(groups[0].selectable, false);
  assert.equal(groups[1].selectable, true);
});

test('flattening selected groups keeps conversation order and excludes unselected groups', () => {
  const groups = selection.buildShareConversationGroups([
    { id: 'u1', role: 'user', content: '保留的问题' },
    { id: 'a1', role: 'assistant', content: '保留的回答' },
    { id: 'u2', role: 'user', content: '不分享的问题' },
    { id: 'a2', role: 'assistant', content: '不分享的回答' },
  ]);
  const selected = selection.flattenSelectedShareMessages(groups, new Set([groups[1].id]));

  assert.deepEqual(selected.map((message) => message.id), ['u2', 'a2']);
});

test('a completed user-only message with an attachment remains shareable', () => {
  const [group] = selection.buildShareConversationGroups([
    { id: 'u1', role: 'user', content: '', files: [{ name: 'brief.md' }] },
  ]);

  assert.equal(group.selectable, true);
});
