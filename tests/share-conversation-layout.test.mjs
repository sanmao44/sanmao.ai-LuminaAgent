import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/share-conversation-layout.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const layout = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function measure(value, fontSize) {
  return Array.from(value).reduce((total, character) => total + (/[^\x00-\xff]/.test(character) ? fontSize : fontSize * 0.56), 0);
}

test('lays out an ordered conversation with rich text blocks and generated media', () => {
  const result = layout.buildShareConversationLayout([
    { id: 'user-1', role: 'user', content: '请用 **清晰的标题** 和 `代码` 解释这个功能。' },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '# 结论\n\n这是第一段说明。\n\n- 保留上下文\n- 展示生成图\n\n> 内容由 AI 生成',
      imageDimensions: [{ width: 1024, height: 768 }, { width: 768, height: 1024 }],
      referenceCount: 2,
      fileCount: 1,
    },
  ], measure);

  assert.equal(result.messageLayouts.length, 2);
  assert.equal(result.messageLayouts[0].role, 'user');
  assert.equal(result.messageLayouts[1].role, 'assistant');
  assert.equal(result.messageLayouts[1].media.length, 2);
  assert.ok(result.messageLayouts[1].blocks.some((block) => block.type === 'heading'));
  assert.ok(result.messageLayouts[1].blocks.some((block) => block.type === 'list'));
  assert.ok(result.messageLayouts[1].blocks.some((block) => block.type === 'quote'));
  assert.ok(result.canvasHeight > result.footerY);
  assert.equal(result.overflow, false);
});

test('wraps long mixed-language text without dropping characters', () => {
  const content = `${'请保留人物身份、构图和材质。'.repeat(90)}\n\n${'A detailed cinematic prompt with a stable perspective. '.repeat(50)}`;
  const result = layout.buildShareConversationLayout([
    { role: 'assistant', content },
  ], measure);
  const renderedText = result.messageLayouts[0].blocks.flatMap((block) => block.lines).join('');
  assert.equal(renderedText.replace(/\s/g, ''), content.replace(/\r\n?/g, '\n').replace(/\s/g, '').trim());
  assert.equal(result.overflow, false);
});

test('keeps the QR/footer area outside the message stack', () => {
  const result = layout.buildShareConversationLayout([
    { role: 'user', content: '一句话' },
    { role: 'assistant', content: '另一句话' },
  ], measure);
  assert.ok(result.footerY > result.messageLayouts.at(-1).y + result.messageLayouts.at(-1).height);
  assert.equal(result.footerHeight, 230);
});
