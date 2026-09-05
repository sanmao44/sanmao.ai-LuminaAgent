import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/agent-web.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const web = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('migrates legacy web preference and accepts explicit modes', () => {
  assert.equal(web.resolveAgentWebMode('always'), 'always');
  assert.equal(web.resolveAgentWebMode('off'), 'off');
  assert.equal(web.resolveAgentWebMode('auto'), 'auto');
  assert.equal(web.resolveAgentWebMode(undefined, false), 'off');
  assert.equal(web.resolveAgentWebMode(undefined, true), 'auto');
});

test('smart mode searches changing facts and explicit source checks only', () => {
  for (const input of ['今天 AI 行业有什么新闻？', 'OpenAI 最新 API 版本是多少？', '帮我核验这个消息是否属实', '请搜索这个问题的来源', '推荐北京周末适合去的咖啡店', '帮我比较 ChatGPT 和 Claude 的当前版本']) {
    assert.equal(web.shouldUseAgentWebSearch('auto', input).shouldSearch, true, input);
  }
  for (const input of ['写一段国风海报提示词', '解释这段 TypeScript', '给我总结这段内容', '你好']) {
    assert.equal(web.shouldUseAgentWebSearch('auto', input).shouldSearch, false, input);
  }
  assert.equal(web.shouldUseAgentWebSearch('always', '你好').shouldSearch, true);
  assert.equal(web.shouldUseAgentWebSearch('off', '今天有什么新闻').shouldSearch, false);
});

test('prioritizes factual questions and status verification in smart mode', () => {
  const death = web.shouldUseAgentWebSearch('auto', '朱镕基去世了吗？');
  assert.equal(death.shouldSearch, true);
  assert.equal(death.reason, 'fact-verification');
  assert.match(death.query, /朱镕基去世了吗/);

  const rumor = web.shouldUseAgentWebSearch('auto', '这个消息是真的吗？', [
    { role: 'user', content: '有人说朱镕基已经去世了。' },
  ]);
  assert.equal(rumor.shouldSearch, true);
  assert.equal(rumor.reason, 'fact-verification');
});

test('builds a minimal query for context follow-ups without sending the full transcript', () => {
  const decision = web.shouldUseAgentWebSearch('auto', '他现在怎么样？', [
    { role: 'user', content: '朱镕基最近怎么样？' },
    { role: 'assistant', content: '这里是上一轮很长的回答，包含了很多不应被直接发送给搜索服务的无关细节。' },
  ]);
  assert.equal(decision.shouldSearch, true);
  assert.equal(decision.reason, 'context-follow-up');
  assert.match(decision.query, /朱镕基/);
  assert.match(decision.query, /他现在怎么样/);
  assert.ok(decision.query.length <= 320);
});

test('keeps stable explanations, creative work and code out of smart search', () => {
  for (const input of ['什么是光合作用？', '解释这段 Python 代码', '帮我写一段产品文案']) {
    const decision = web.shouldUseAgentWebSearch('auto', input);
    assert.equal(decision.shouldSearch, false, input);
    assert.equal(decision.reason, 'ordinary-chat', input);
  }
});

test('tool requests stay on planner path while ordinary text can stream directly', () => {
  assert.equal(web.likelyAgentToolRequest('生成一张赛博朋克海报', false), true);
  assert.equal(web.likelyAgentToolRequest('生成一只狗', false), true);
  assert.equal(web.likelyImageGenerationRequest('画个猫'), true);
  assert.equal(web.likelyImageGenerationRequest('帮我画一个猫'), true);
  assert.equal(web.likelyImageGenerationRequest('画宇宙飞船'), true);
  assert.equal(web.likelyImageGenerationRequest('我想画一个不存在的生物'), true);
  assert.equal(web.likelyImageGenerationRequest('枯藤老树昏鸦，夕阳西下。生成一幅画!'), true);
  assert.equal(web.likelyImageGenerationRequest('做成海报图'), true);
  assert.equal(web.likelyImageGenerationRequest('帮我把这段内容做成一张宣传海报'), true);
  assert.equal(web.likelyImageGenerationRequest('变成一张电影海报'), true);
  assert.equal(web.likelyImageGenerationRequest('帮我生成一个 JSON 文件'), false);
  assert.equal(web.likelyImageGenerationRequest('帮我生成一段生图提示词'), false);
  assert.equal(web.likelyImageGenerationRequest('写一个画猫的提示词'), false);
  assert.equal(web.likelyImageGenerationRequest('画一张图的提示词'), false);
  assert.equal(web.likelyImageGenerationRequest('做成海报图的提示词'), false);
  assert.equal(web.isImageContinuationRequest('做成海报图'), true);
  assert.equal(web.isImageContinuationRequest('把这张图做成海报图'), true);
  assert.equal(web.likelyAgentToolRequest('请换背景并保留人物', true), true);
  assert.equal(web.likelyAgentToolRequest('解释这段代码', false), false);
});

test('covers common Chinese and English drawing expressions', () => {
  for (const input of [
    '请画一只戴墨镜的猫',
    '帮我绘制一幅山水画',
    '请直接出图：未来城市',
    '来一张海边日落',
    '我要一张猫咪头像',
    '我想要一个游戏角色立绘',
    '帮我制作一张宣传海报',
    '设计一个品牌 logo',
    '做一张公众号封面',
    '给这篇文章配图',
    '给故事配一张插画',
    '把这段内容转成信息图',
    '将文字排成海报',
    '生成一个机器人',
    '创建一个不存在的生物',
    '做个猫',
    '来个宇宙飞船',
    'draw a cat',
    'create an image of a fox',
    'make a poster',
  ]) {
    assert.equal(web.likelyImageGenerationRequest(input), true, input);
  }
});

test('keeps text, file, tutorial and prompt-only requests out of image generation', () => {
  for (const input of [
    '请生成一段生图提示词',
    '写一个画猫的提示词',
    '帮我优化海报提示词',
    '帮我写海报文案',
    '制作一个海报方案',
    '生成一个报告',
    '生成一个视频',
    '生成一张表格',
    '我要一张表格',
    '帮我生成一个 JSON 文件',
    '怎么画一只猫',
    '教我画海报',
    '画图软件怎么用',
    '给我解释这张图',
    '分析这张海报',
    '做海报的步骤',
    '海报制作方法',
    '生成一张海报的文案',
    '导出一张图片文件',
    '生成一段用于 seedance2.0 生成视频的提示词，不要背景音乐，只保留音效，不要出图片，只要提示词',
    '不要出图，只输出提示词',
    '帮我根据这张图反推提示词，不要生成新图片',
  ]) {
    assert.equal(web.likelyImageGenerationRequest(input), false, input);
  }
});

test('keeps prompt-only requests out of the agent tool planner', () => {
  assert.equal(web.likelyAgentToolRequest('帮我根据这张图反推提示词', true), false);
  assert.equal(web.likelyAgentToolRequest('先写提示词，再生成一张海报', false), true);
});
