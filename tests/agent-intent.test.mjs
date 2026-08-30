import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/agent-intent.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const intent = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('routes explicit visual requests to an image deliverable', () => {
  assert.equal(intent.classifyAgentDeliverable('给我做一张带夏日特惠文字的新品海报').deliverable, 'IMAGE');
  assert.equal(intent.classifyAgentDeliverable('我只说目标，创意、模型和出图都交给你').deliverable, 'IMAGE');
});

test('routes prompt and copy requests to text without being fooled by visual nouns', () => {
  assert.equal(intent.classifyAgentDeliverable('帮我写一个小红书封面标题').deliverable, 'TEXT');
  assert.equal(intent.classifyAgentDeliverable('帮我优化这个生图提示词，不要出图').deliverable, 'TEXT');
  assert.equal(intent.classifyAgentDeliverable('给我 3 个视觉方向').deliverable, 'TEXT');
});

test('supports both deliverables and asks for clarification when the format is missing', () => {
  assert.equal(intent.classifyAgentDeliverable('做一张新品宣传图，再给我三条朋友圈文案').deliverable, 'BOTH');
  assert.equal(intent.classifyAgentDeliverable('帮我做个新品宣传').deliverable, 'CLARIFY');
});

test('uses the latest output as context for short follow-ups', () => {
  assert.equal(intent.classifyAgentDeliverable('背景换成黑色', {
    messages: [{ role: 'assistant', content: '已完成第一版。', images: [{ id: 'image-1' }] }],
  }).deliverable, 'IMAGE');
  assert.equal(intent.classifyAgentDeliverable('再短一点', {
    messages: [{ role: 'assistant', content: '这是一段朋友圈文案。' }],
  }).deliverable, 'TEXT');
});
