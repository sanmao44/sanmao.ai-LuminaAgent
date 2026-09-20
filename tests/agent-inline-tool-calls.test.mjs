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
