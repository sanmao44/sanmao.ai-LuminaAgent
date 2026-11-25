import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTsRequire } from './ts-require.mjs';

const requireTs = createTsRequire(fileURLToPath(new URL('../lib', import.meta.url)));
const { isTextFileFallbackRequested, makeTextFileFallbackCall, textFileFallbackUserPrompt, isTextFileContextSizeFailure } = requireTs('./agent/text-file-fallback');

test('text file fallback validates and converts a complete HTML envelope', () => {
  const result = makeTextFileFallbackCall({
    response: JSON.stringify({ filename: 'ignored.txt', content: '<!doctype html><html><body>ok</body></html>' }),
    instruction: '生成 HTML 文件，命名为 demo.html',
    callId: 'fallback-html',
  });
  assert.equal(result.ok, true);
  assert.equal(result.call.function.name, 'file_generate');
  assert.deepEqual(JSON.parse(result.call.function.arguments), {
    files: [{ filename: 'demo.html', content: '<!doctype html><html><body>ok</body></html>', encoding: 'utf8' }],
  });
});

test('text file fallback accepts fenced JSON and valid JSON content', () => {
  const result = makeTextFileFallbackCall({
    response: '```json\n{"filename":"data.json","content":"{\\"ok\\":true}"}\n```',
    instruction: '请导出 data.json 文件',
    callId: 'fallback-json',
  });
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(result.call.function.arguments).files[0].filename, 'data.json');
});

test('text file fallback accepts a complete fenced HTML document without JSON escaping', () => {
  const content = '<!doctype html><html><body><button>运行</button></body></html>';
  const result = makeTextFileFallbackCall({
    response: `\x60\x60\x60html\n${content}\n\x60\x60\x60`,
    instruction: '生成 HTML 文件，命名为 demo.html',
    callId: 'fallback-html-fenced',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.call.function.arguments), {
    files: [{ filename: 'demo.html', content, encoding: 'utf8' }],
  });
});

test('text file fallback rejects malformed, empty, oversized, and incomplete content', () => {
  const cases = [
    ['invalid-json', 'not json', '生成 txt 文件'],
    ['missing-content', JSON.stringify({ filename: 'a.txt', content: '  ' }), '生成 txt 文件'],
    ['invalid-document', JSON.stringify({ filename: 'a.html', content: '<html>未闭合' }), '生成 a.html 文件'],
    ['content-too-large', JSON.stringify({ filename: 'a.txt', content: 'x'.repeat(4_000_001) }), '生成 txt 文件'],
  ];
  for (const [reason, response, instruction] of cases) {
    const result = makeTextFileFallbackCall({ response, instruction, callId: `bad-${reason}` });
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
  }
});

test('text file fallback prompt names the requested extension without claiming persistence', () => {
  const prompt = textFileFallbackUserPrompt('请生成一个样式表，保存为 theme.css');
  assert.match(prompt, /\.css/);
  assert.match(textFileFallbackUserPrompt('生成一个交互网页文件，带按钮和动画'), /\.html/);
});

test('text file fallback classification distinguishes text deliverables from Office requests', () => {
  assert.equal(isTextFileFallbackRequested('画只鹅骑自行车的 SVG 动画，HTML 交付，带交互控件！'), true);
  assert.equal(isTextFileFallbackRequested('生成一个 HTML 网页，命名为 demo.html'), true);
  assert.equal(isTextFileFallbackRequested('生成一个交互网页文件，带按钮和动画'), true);
  assert.equal(isTextFileFallbackRequested('生成 Word 文档并导出'), false);
  assert.equal(isTextFileFallbackRequested('请打包成 ZIP，命名为 demo.zip'), false);
  assert.equal(isTextFileFallbackRequested('如何制作 CSV 文件'), false);
});

test('text file fallback only retries a context-size 413, not a bare request-size 413 or rate limit', () => {
  assert.equal(isTextFileContextSizeFailure(Object.assign(new Error('context_length_exceeded'), { providerStatus: 413 })), true);
  assert.equal(isTextFileContextSizeFailure(Object.assign(new Error('body too large'), { providerStatus: 413 })), false);
  assert.equal(isTextFileContextSizeFailure(Object.assign(new Error('rate limit'), { providerStatus: 429 })), false);
});
