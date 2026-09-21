import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/agent-context.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const history = [
  { id: 'u1', role: 'user', content: '画个对牛弹琴的寓意图，9:16' },
  { id: 'a1', role: 'assistant', content: '已生成', images: [{ id: 'img1', url: '/api/storage/file?name=one.png', prompt: '对牛弹琴', aspectRatio: '9:16' }] },
  { id: 'u2', role: 'user', content: '鲁迅看到这张图会怎么说？' },
  { id: 'a2', role: 'assistant', content: '这是评论文字。' },
  { id: 'u3', role: 'user', content: '生成鲁迅在评论这张图的场景' },
  { id: 'a3', role: 'assistant', content: '鲁迅站在书房评论画中场景。' },
];

test('analysis and generation resolve the same actual image within the conversation', () => {
  for (const input of ['鲁迅看到这张图会怎么说？', '生成鲁迅在评论这张图的场景', '出图', '把背景换成黑色']) {
    assert.equal(context.conversationImage(input, history)?.id, 'img1', input);
  }
  assert.equal(context.conversationImage('继续', history), null, 'a text follow-up must not resume an older image');
  assert.equal(context.conversationImage('画一张全新的海报', history), null);
  assert.equal(context.conversationImage('不用原图，生成新的场景', history), null);
  assert.equal(context.conversationImage('出图', [...history, { role: 'user', content: '出图' }, { role: 'assistant', content: '生成失败' }])?.id, 'img1');
});

test('new conversations cannot retrieve other conversations and ambiguous sets are not guessed', () => {
  assert.equal(context.conversationImage('出图', []), null);
  assert.equal(context.conversationImage('这张图怎么样', [{ role: 'assistant', images: [{ url: '/1.png' }, { url: '/2.png' }] }]), null);
  assert.equal(context.conversationImage('第一张图', history), null);
  assert.equal(context.conversationImage('这张图怎么样', [{ role: 'user', references: [{ id: 'upload', dataUrl: 'data:image/png;base64,abc' }] }])?.id, 'upload');
});

test('bare generation does not attach an unrelated old image after changing topics', () => {
  for (const request of ['写一封请假邮件', '画一张全新的海报']) {
    const switched = [...history, { role: 'user', content: request }, { role: 'assistant', content: '这是新的内容。' }];
    assert.equal(context.conversationImage('出图', switched), null, request);
  }
});

test('short image commands retain subject and ratio without leaking another conversation', () => {
  const prompt = context.contextualImagePrompt('出图', history);
  assert.match(prompt, /鲁迅/);
  assert.match(prompt, /9:16/);
  assert.equal(context.contextualImagePrompt('出图', []), '出图');
  assert.equal(context.contextualImagePrompt('画一张新的海报', history), '画一张新的海报');
  const metadata = context.conversationMessageText(history[1]);
  assert.match(metadata, /9:16/);
  assert.doesNotMatch(metadata, /base64|api\/storage/);
  assert.match(context.contextualImagePrompt('好的', history), /鲁迅/);
});

test('new chat resets current content and drafts, retry keeps the original request', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const reset = page.slice(page.indexOf('function startNewChat()'), page.indexOf('function openChatSession('));
  for (const line of ['activeChatIdRef.current = null', "agentPersonaRef.current = ''", 'setMessages([])', 'setAgentRefs([])', 'setAgentFiles([])', 'setAgentFollowUp(null)']) assert.ok(reset.includes(line), line);
  assert.match(page, /chatMemoryRef\.current\.get\(sessionId\)/);
  assert.doesNotMatch(page, /id: 'retry-instruction'/);
  assert.match(page, /conversationImage\(content, currentSessionMessages\)/);
  assert.match(page, /item\.localFileName \? '本地图片'/);
  assert.match(page, /prompt: image\.localFileName \|\| meta\.prompt/);
});
