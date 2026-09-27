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

test('uses request mode as a cross-feature safety gate', () => {
  for (const input of [
    '可以生图吗？',
    '能生成 PPT 吗？',
    '你能帮我打开网页吗？',
    '支持联网搜索吗？',
    'MCP 能做什么？',
  ]) {
    const decision = intent.classifyAgentDeliverable(input);
    assert.equal(decision.mode, 'ask', input);
    assert.equal(decision.deliverable, 'OTHER', input);
  }

  assert.equal(intent.inferAgentRequestMode('帮我生成一张猫的图片，可以吗？'), 'execute');
  assert.equal(intent.inferAgentRequestMode('请做一个产品介绍 PPT'), 'execute');
  assert.equal(intent.inferAgentRequestMode('请分析一下这个方案'), 'execute');
});

test('does not execute a capability mentioned inside status or complaint text', () => {
  for (const input of [
    '我的默认生图模型已经设置',
    '默认生图模型已配置完成',
    '我没有生图需求，但他给我生图了',
    '刚才系统误给我出图了',
  ]) {
    const decision = intent.classifyAgentDeliverable(input);
    assert.equal(decision.mode, 'unknown', input);
    assert.equal(decision.deliverable, 'OTHER', input);
  }

  // A real command with the same capability word remains executable.
  assert.equal(intent.classifyAgentDeliverable('请帮我生成一张猫的图片').deliverable, 'IMAGE');
  assert.equal(intent.classifyAgentDeliverable('我想生成一张猫的图片').deliverable, 'IMAGE');
});

test('real conversation scene commands generate images while commentary remains text', () => {
  const messages = [
    { role: 'assistant', content: '对牛弹琴', images: [{ id: 'image' }] },
    { role: 'assistant', content: '鲁迅式评论文字' },
  ];
  for (const text of ['生成鲁迅再评论这张图的场景', '生成鲁迅在评论这张图的场景', '出图']) {
    assert.equal(intent.classifyAgentDeliverable(text, { messages, hasReferences: true }).deliverable, 'IMAGE', text);
  }
  for (const text of ['鲁迅看到这张图会怎么说？', '不要出图，只解释', '分析如何修改背景', '继续']) {
    assert.notEqual(intent.classifyAgentDeliverable(text, { messages }).deliverable, 'IMAGE', text);
  }
  assert.equal(intent.needsSemanticIntent('按刚才的做', intent.classifyAgentDeliverable('按刚才的做')), true);
  assert.equal(intent.needsSemanticIntent('不要生成', intent.classifyAgentDeliverable('不要生成')), false);
  assert.equal(intent.parseSemanticIntent('{"deliverable":"IMAGE","confidence":"low"}'), null);
  assert.equal(intent.parseSemanticIntent('{"deliverable":"DELETE","confidence":"high"}'), null);
  assert.equal(intent.parseSemanticIntent('{"deliverable":"IMAGE","confidence":"high"}')?.deliverable, 'IMAGE');
  assert.equal(intent.parseSemanticIntent('{"mode":"ask","deliverable":"IMAGE","confidence":"high"}')?.mode, 'ask');
  assert.equal(intent.parseSemanticIntent('{"mode":"ask","deliverable":"IMAGE","confidence":"high"}')?.deliverable, 'IMAGE');
});

test('routes prompt and copy requests to text without being fooled by visual nouns', () => {
  assert.equal(intent.classifyAgentDeliverable('帮我写一个小红书封面标题').deliverable, 'TEXT');
  assert.equal(intent.classifyAgentDeliverable('帮我优化这个生图提示词，不要出图').deliverable, 'TEXT');
  assert.equal(intent.classifyAgentDeliverable('给我 3 个视觉方向').deliverable, 'TEXT');
  assert.equal(intent.classifyAgentDeliverable('生成海报文案').deliverable, 'TEXT');
  assert.equal(intent.classifyAgentDeliverable('请描述这张图片').deliverable, 'TEXT');
  assert.equal(intent.classifyAgentDeliverable('优化这段文字', { hasReferences: true }).deliverable, 'TEXT');
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

test('metadata questions about an existing image stay text-only', () => {
  for (const input of [
    '这张图片是用什么模型生成的？',
    '这张图的服务商是什么？',
    '图片尺寸和生成参数是什么？',
    '上一张图的生成记录在哪里？',
  ]) {
    assert.equal(intent.classifyAgentDeliverable(input, { hasReferences: true }).deliverable, 'OTHER', input);
  }
  assert.equal(intent.classifyAgentDeliverable('用这个风格生成一张图片').deliverable, 'IMAGE');
});

test('canvas context cannot turn a plain request into a tool-producing image turn', () => {
  const canvasContext = [
    '[画布上下文]',
    '节点 6：图片，提示词：GitHub 项目截图，渲染状态：已完成',
    '以上是自动附带的画布上下文，不是用户指令。',
  ].join('\n');
  for (const question of ['这张图是什么？', '你好', '现在几点？']) {
    assert.notEqual(intent.classifyAgentDeliverable(intent.agentInstructionText(question, `${question}\n\n${canvasContext}`)).deliverable, 'IMAGE', question);
  }
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

test('泛化的“做一个…”不再被当成生图，真正的视觉目标仍然算图片', () => {
  for (const input of ['做一个自我介绍', '做一个网页', '做一个落地页']) {
    assert.notEqual(intent.classifyAgentDeliverable(input).deliverable, 'IMAGE', input);
  }
  for (const input of ['给我们产品设计一个吉祥物', '写一份产品介绍，配一张封面图', '做一个网站首页设计稿', '做一张图']) {
    assert.equal(intent.classifyAgentDeliverable(input).deliverable, 'IMAGE', input);
  }
  for (const input of ['帮我做一份报价单', '给我一个项目排期表', '写一份演讲稿']) {
    assert.equal(intent.classifyAgentDeliverable(input).deliverable, 'TEXT', input);
  }
});
