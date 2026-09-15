import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/agent-memory.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const memory = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const messages = (count) => Array.from({ length: count }, (_, index) => ({ id: `m${index}`, role: index % 2 ? 'assistant' : 'user', content: `message ${index}` }));

test('memory trigger keeps one custom tooltip and an accessible name', async () => {
  const editor = await readFile(new URL('../components/AgentMemoryEditor.tsx', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('AgentMemoryEditor.tsx', editor, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let attributes;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'button') {
      const props = node.attributes.properties.filter(ts.isJsxAttribute);
      if (props.some((prop) => prop.name.getText(tree) === 'data-tooltip')) attributes = props;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert(attributes, 'memory trigger exists');
  const values = new Map(attributes.map((prop) => [prop.name.getText(tree), prop.initializer?.text]));
  assert.equal(values.get('data-tooltip'), '当前对话记忆');
  assert.equal(values.get('aria-label'), '当前对话记忆');
  assert.equal(values.has('title'), false, 'native title would duplicate the custom tooltip');
});

test('short conversations do not call a model; summaries refresh in batches', async () => {
  const calls = [];
  const summarize = async (summary, text) => { calls.push({ summary, text }); return 'summary'; };
  const short = await memory.prepareConversationMemory(messages(12), undefined, summarize);
  assert.equal(calls.length, 0);
  assert.equal(short.summary, '');
  const first = await memory.prepareConversationMemory(messages(15), undefined, summarize);
  assert.equal(first.covered.length, 0);
  assert.equal(calls.length, 0);
  const batched = await memory.prepareConversationMemory(messages(20), first, summarize);
  assert.equal(batched.covered.length, 8);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /message 0/);
  assert.match(calls[0].text, /message 7/);
  assert.doesNotMatch(calls[0].text, /message 8/);
});

test('relevant history keeps complete turns within the twelve-message request budget', () => {
  const history = [
    { id: 'u0', role: 'user', content: '讨论旅行路线和预算' },
    { id: 'a0', role: 'assistant', content: '旅行建议' },
    { id: 'u1', role: 'user', content: '讨论数据库备份策略' },
    { id: 'a1', role: 'assistant', content: '数据库建议' },
    { id: 'u2', role: 'user', content: '讨论图片提示词' },
    { id: 'a2', role: 'assistant', content: '图片建议' },
    ...Array.from({ length: 8 }, (_, index) => ({ id: `recent-${index}`, role: index % 2 ? 'assistant' : 'user', content: `最近消息 ${index}` })),
  ];
  const selected = memory.selectRelevantConversationMessages(history, '数据库备份');
  assert.equal(selected.length, 10);
  assert.deepEqual(selected.map((message) => message.id), ['u1', 'a1', ...Array.from({ length: 8 }, (_, index) => `recent-${index}`)]);
});

test('restored memory is reusable and isolated by message identity', async () => {
  const history = messages(20);
  const saved = await memory.prepareConversationMemory(history, undefined, async () => 'old summary');
  const restored = JSON.parse(JSON.stringify(saved));
  const result = await memory.prepareConversationMemory(history, restored, async () => assert.fail('already summarized'));
  assert.equal(result.summary, 'old summary');
  assert.equal(memory.validConversationMemory(saved, history.map((message) => ({ ...message, id: `other-${message.id}` }))), undefined);
});

test('deletions and changed versions invalidate old summaries; recent edits do not', async () => {
  const history = messages(20);
  const saved = await memory.prepareConversationMemory(history, undefined, async () => 'obsolete');
  assert.equal(memory.validConversationMemory(saved, history.slice(1)), undefined);
  assert.equal(memory.validConversationMemory(saved, history.map((message, index) => index === 0 ? { ...message, content: 'corrected' } : message)), undefined);
  assert.equal(memory.validConversationMemory(saved, history.map((message, index) => index === 14 ? { ...message, content: 'corrected' } : message)), saved);
  let previous;
  await memory.prepareConversationMemory(messages(13), saved, async (summary) => { previous = summary; return 'earlier summary'; });
  assert.equal(previous, undefined);
});

test('manual edits persist and clearing does not immediately recreate the erased summary', async () => {
  const history = messages(20);
  const edited = memory.editConversationMemory(history, 'manual correction');
  const restored = await memory.prepareConversationMemory(history, edited, async () => assert.fail('do not regenerate edits'));
  assert.equal(restored.summary, 'manual correction');
  const cleared = memory.editConversationMemory(history, '');
  await memory.prepareConversationMemory(history, cleared, async () => assert.fail('do not regenerate cleared history'));
  let transcript;
  await memory.prepareConversationMemory(messages(28), cleared, async (summary, text) => { assert.equal(summary, ''); transcript = text; return 'new summary'; });
  assert.doesNotMatch(transcript, /message 0/);
  assert.match(transcript, /message 8/);
});

test('large messages are fully processed in bounded chunks and failure does not mutate saved memory', async () => {
  const history = messages(20);
  history[0].content = 'x'.repeat(memory.MEMORY_BATCH_CHARS * 2);
  const chunks = [];
  await memory.prepareConversationMemory(history, undefined, async (_, text) => { chunks.push(text); return 'summary'; });
  assert.equal(chunks.length, 3);
  assert(chunks.every((chunk) => chunk.length <= memory.MEMORY_BATCH_CHARS));
  const reconstructed = chunks.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(reconstructed[0].content, history[0].content);
  const saved = memory.editConversationMemory(messages(12), 'keep');
  const before = JSON.stringify(saved);
  await assert.rejects(memory.prepareConversationMemory(history, saved, async () => { throw new Error('offline'); }), /offline/);
  assert.equal(JSON.stringify(saved), before);
  await assert.rejects(memory.prepareConversationMemory(history, saved, async () => ''), /摘要/);
});

test('cancellation prevents committing partial summaries', async () => {
  const controller = new AbortController();
  await assert.rejects(memory.prepareConversationMemory(messages(20), undefined, async () => {
    controller.abort(); return 'cancelled summary';
  }, controller.signal), { name: 'AbortError' });
});

test('memory is background user content and cannot enlarge the bounded context', () => {
  assert.deepEqual(memory.memoryContextMessage(undefined), []);
  const [context] = memory.memoryContextMessage('x'.repeat(10000));
  assert.equal(context.role, 'user');
  assert.equal(JSON.parse(context.content.split('\n')[1]).conversationSummary.length, memory.MEMORY_CONTEXT_MAX_CHARS);
});
