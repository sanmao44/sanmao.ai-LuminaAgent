import assert from 'node:assert/strict';
import test from 'node:test';
import { buildArtifactsModule } from './artifacts-build.mjs';

const { textWidthEm, charWidthEm, wrapText, wrapToLines, countLines, emWidthFor, spreadsheetWidth } = await buildArtifactsModule();

test('全角按 1em、半角按实测字宽计算，不等宽的拉丁字母不能按同一档处理', () => {
  assert.equal(charWidthEm('中'), 1);
  assert.equal(charWidthEm('，'), 1);
  assert.equal(charWidthEm('（'), 1);
  assert.equal(spreadsheetWidth('中文abc'), 7, '全角 2、半角 1');
  assert.ok(charWidthEm('l') < charWidthEm('m') / 2, '窄字母 l 必须明显窄于 m');
  assert.ok(charWidthEm('I') < charWidthEm('W') / 2, 'I 必须明显窄于 W');
  assert.ok(charWidthEm(' ') < charWidthEm('中'));
  assert.ok(textWidthEm('WORD / EXCEL') > textWidthEm('word / excel'), '大写更宽');
});

test('中文可以在任意位置断行，拉丁单词保持完整', () => {
  const lines = wrapText('这是一段需要自动换行的中文说明文字', 6);
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(textWidthEm(line) <= 6, `每行都不能超过 6em：${line}`);
  assert.deepEqual(wrapText('hello world', 3), ['hello', 'world'], '英文按单词断行，不拆开单词');
});

test('超长链接才硬切，token 本身放得下时不切开', () => {
  const url = 'https://github.com/sanmao44/sanmao.ai-LuminaAgent/blob/main/lib/artifacts/powerpoint.ts';
  const lines = wrapText(url, 10);
  assert.ok(lines.length > 1, '超长链接必须被切开');
  for (const line of lines) assert.ok(textWidthEm(line) <= 10.0001, `切开后每行都要放进 10em：${line}`);
  assert.equal(lines.join('').replace(/\s/g, ''), url, '切开后内容不能丢');
  assert.deepEqual(wrapText('abc', 10), ['abc'], '放得下就不切');
});

test('空文本与空白文本返回单行空串，宽度非法时按 1em 兜底', () => {
  assert.deepEqual(wrapText('', 20), ['']);
  assert.deepEqual(wrapText('   ', 20), ['']);
  assert.deepEqual(wrapText('中文', 0), wrapText('中文', 1));
  assert.equal(emWidthFor(6, 12), 36, '6 英寸 12pt 一行可以放 36 个全角字');
  assert.equal(countLines('中文', 6, 72), 1);
  const wrapped = wrapToLines('中'.repeat(5), 3, 72).split('\n');
  assert.ok(wrapped.length > 1, '每行放不下 5 个全角字，必须换行');
  for (const line of wrapped) assert.ok(textWidthEm(line) <= 3, '换行后每行都要放进 3em');
  assert.equal(wrapped.join(''), '中'.repeat(5), '换行不能丢字');
});

test('文本宽度越大换行越多，且每行都不超过给定宽度', () => {
  const text = 'SANMAO.AI 把对话理解、提示词优化、多模型调度与文件交付收进同一个工作台。';
  let previous = Number.POSITIVE_INFINITY;
  for (const width of [8, 12, 20, 40, 80]) {
    const lines = wrapText(text, width);
    assert.ok(lines.length <= previous, '宽度变大行数不应增加');
    previous = lines.length;
    for (const line of lines) assert.ok(textWidthEm(line) <= width + 0.001, `${width}em 下超宽：${line}`);
  }
});
