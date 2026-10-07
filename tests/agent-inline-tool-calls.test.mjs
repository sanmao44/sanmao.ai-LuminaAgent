import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/agent/inline-tool-calls.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const inline = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const tools = [
  { name: 'playwright__browser_click' },
  { name: 'playwright__browser_snapshot' },
  { function: { name: 'image_generate' } },
  { function: { name: 'image_edit' } },
];

test('识别模型写进正文的浏览器工具调用', () => {
  const text = [
    '点赞已完成。我继续提交评论。',
    'to=functions.playwright_browserclick',
    '{"button":"left","target":"e1128"}',
    'to=functions.playwright_browsersnapshot',
    '{"boxes":false,"depth":8}',
  ].join('\n');
  assert.equal(inline.hasInlineToolCallMarkup(text), true);
  assert.deepEqual(inline.parseInlineToolCalls(text, tools).map((call) => ({ name: call.function.name, args: JSON.parse(call.function.arguments) })), [
    { name: 'playwright__browser_click', args: { button: 'left', target: 'e1128' } },
    { name: 'playwright__browser_snapshot', args: { boxes: false, depth: 8 } },
  ]);
});

test('只恢复本轮实际提供且参数为合法对象的工具', () => {
  assert.deepEqual(inline.parseInlineToolCalls('to=functions.unknown {"x":1}', tools), []);
  assert.deepEqual(inline.parseInlineToolCalls('to=functions.playwright_browserclick not-json', tools), []);
  assert.deepEqual(inline.parseInlineToolCalls('普通文本，没有工具调用', tools), []);
});

test('recovers JSON tool envelopes only for tools actually offered', () => {
  const text = '<tool_call>{"name":"image_generate","arguments":{"prompt":"鲁迅评论图画","aspectRatio":"9:16"}}</tool_call>';
  assert.equal(inline.parseInlineToolCalls(text, tools)[0]?.function.name, 'image_generate');
  assert.deepEqual(inline.parseInlineToolCalls(text, []), []);
  assert.deepEqual(inline.parseInlineToolCalls('<tool_call>{"name":"image_generate","arguments":[]}</tool_call>', tools), []);
});

test('detects incomplete tool envelopes without executing them', () => {
  const text = '<tool_call>{"name":"image_generate","arguments":';
  assert.equal(inline.hasInlineToolCallMarkup(text), true);
  assert.deepEqual(inline.parseInlineToolCalls(text, tools), []);
});

test('恢复 DSML 图片调用时保留真实参数，不被 fallback 覆盖', () => {
  const text = [
    '<｜DSML｜function_calls>',
    '<｜DSML｜invoke name="image_edit">',
    '<｜DSML｜parameter name="prompt">保留人物和构图，只把背景改成深蓝色<｜DSML｜parameter>',
    '<｜DSML｜parameter name="aspectRatio">16:9<｜DSML｜parameter>',
    '<｜DSML｜parameter name="modelId">gpt-image-2<｜DSML｜parameter>',
    '<｜DSML｜invoke>',
    '<｜DSML｜function_calls>',
  ].join('');
  assert.equal(inline.hasInlineToolCallMarkup(text), true);
  const [call] = inline.parseInlineToolCalls(text, tools);
  assert.equal(call.function.name, 'image_edit');
  assert.deepEqual(JSON.parse(call.function.arguments), {
    prompt: '保留人物和构图，只把背景改成深蓝色',
    aspectRatio: '16:9',
    modelId: 'gpt-image-2',
  });
});
