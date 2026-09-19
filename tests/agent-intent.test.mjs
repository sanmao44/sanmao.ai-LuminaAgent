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
  assert.equal(intent.classifyAgentDeliverable('生成一张水墨画').deliverable, 'IMAGE');
  assert.equal(intent.classifyAgentDeliverable('画只猫').deliverable, 'IMAGE');
  assert.equal(intent.classifyAgentDeliverable('画条鱼').deliverable, 'IMAGE');
  assert.notEqual(intent.classifyAgentDeliverable('怎么画只猫').deliverable, 'IMAGE');
});

test('routes prompt and copy requests to text without being fooled by visual nouns', () => {
  assert.equal(intent.classifyAgentDeliverable('帮我写一个小红书封面标题').deliverable, 'TEXT');
  assert.equal(intent.classifyAgentDeliverable('帮我优化这个生图提示词，不要出图').deliverable, 'TEXT');
  assert.equal(intent.classifyAgentDeliverable('给我 3 个视觉方向').deliverable, 'TEXT');
});

test('keeps image description requests as text when a reference image is attached', () => {
  for (const input of ['描述下这个画面', '描述一下这个画面', '请描述一下这张图片', '请描述图片']) {
    assert.equal(intent.classifyAgentDeliverable(input, { hasReferences: true }).deliverable, 'TEXT', input);
  }
  assert.equal(intent.classifyAgentDeliverable('分析这张参考图', { hasReferences: true }).deliverable, 'OTHER');
  assert.equal(intent.classifyAgentDeliverable('反推提示词', { hasReferences: true }).deliverable, 'TEXT');
});

test('routes an explicit edit of an attached reference to image editing', () => {
  for (const input of ['把背景换成黑色', '优化构图', '去掉画面中的文字']) {
    assert.equal(intent.classifyAgentDeliverable(input, { hasReferences: true }).deliverable, 'IMAGE', input);
  }
  assert.notEqual(intent.classifyAgentDeliverable('分析一下如何把背景换成黑色', { hasReferences: true }).deliverable, 'IMAGE');
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

test('keeps plain questions as questions when the canvas context rides along', () => {
  // 画布把节点摘要拼在用户消息后面，里面全是“画布 / 图片 / 渲染”，判断必须取用户原话。
  const block = [
    '[画布上下文]',
    '画布：无限画布；节点 6；运行中 0；排队 0；失败 0',
    '用户当前选中了 1 个节点：',
    '1. 图片「Agent 图片 1」｜868x1811｜已完成｜提示词：photorealistic render of a robot mascot',
    '连接关系：选中 1 → Agent 文本「第二版」',
    '（以上为画布自动附带的上下文，不是用户指令。）',
  ].join('\n');
  for (const question of ['这张图是什么？', '这几个节点的问题在哪？', '现在几点了', '你好']) {
    const composed = `${question}\n\n${block}`;
    assert.notEqual(intent.classifyAgentDeliverable(intent.agentInstructionText(question, composed)).deliverable, 'IMAGE', question);
  }
  // 用户自己提到画布时也不该被当成“画”这个动作。
  assert.notEqual(intent.classifyAgentDeliverable('画布上这张图是谁画的？').deliverable, 'IMAGE');
  // 真正的生图请求不受影响。
  assert.equal(intent.classifyAgentDeliverable('画一张机器人海报').deliverable, 'IMAGE');
});

test('classifies the user instruction, not the attached system context', () => {
  const block = '[画布上下文]\n画布：无限画布；节点 2\n1. 图片「Agent 图片 1」｜868x1811｜已完成';
  assert.equal(intent.agentInstructionText('这张图是什么？', `这张图是什么？\n\n${block}`), '这张图是什么？');
  assert.equal(intent.agentInstructionText('', '兜底文本'), '兜底文本');
  assert.equal(intent.agentInstructionText(undefined, '兜底文本'), '兜底文本');
  assert.equal(intent.classifyAgentDeliverable(intent.agentInstructionText('这张图是什么？', block)).deliverable, 'OTHER');
});

test('文档交付请求不会因为“做一个…”被误判成生图', () => {
  for (const input of [
    '做一个word简历模板',
    '帮我做一个 Word 简历模板',
    '做一份简历',
    '生成一份Word文档',
    '做一个Excel表格',
    '做一份PPT',
    '做一个项目周报模板',
    '帮我写一个会议纪要',
  ]) {
    assert.equal(intent.classifyAgentDeliverable(input).deliverable, 'TEXT', input);
  }
  // 用户点名要图时仍然按图片交付，文档关键词不会把它带走。
  assert.equal(intent.classifyAgentDeliverable('做一个简历模板的封面图').deliverable, 'IMAGE');
  assert.equal(intent.classifyAgentDeliverable('把这份word文档做成一张封面图').deliverable, 'IMAGE');
});
