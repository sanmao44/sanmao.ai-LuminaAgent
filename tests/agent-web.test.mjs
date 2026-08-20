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
  for (const input of ['今天 AI 行业有什么新闻？', 'OpenAI 最新 API 版本是多少？', '帮我核验这个消息是否属实', '请搜索这个问题的来源']) {
    assert.equal(web.shouldUseAgentWebSearch('auto', input), true, input);
  }
  for (const input of ['写一段国风海报提示词', '解释这段 TypeScript', '给我总结这段内容', '你好']) {
    assert.equal(web.shouldUseAgentWebSearch('auto', input), false, input);
  }
  assert.equal(web.shouldUseAgentWebSearch('always', '你好'), true);
  assert.equal(web.shouldUseAgentWebSearch('off', '今天有什么新闻'), false);
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
