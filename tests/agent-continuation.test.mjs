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
const continuation = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('extracts numbered continuation directions and caps them at three', () => {
  const directions = continuation.extractAgentDirections([
    '## 创作说明',
    '保持当前主体和构图。',
    '',
    '### 下一版可尝试方向',
    '',
    '1. 强化标题层级',
    '2、优化光线色彩',
    '3) 调整细节风格',
    '4. 不应显示这一项',
  ].join('\n'));

  assert.deepEqual(directions, ['强化标题层级', '优化光线色彩', '调整细节风格']);
});

test('keeps compatibility with legacy bullet directions and provides a fallback', () => {
  const legacy = continuation.extractAgentDirections('## 下一版可尝试方向\n- 强化信息层级\n- 优化版式节奏');
  assert.deepEqual(legacy, ['强化信息层级', '优化版式节奏']);

  const fallback = continuation.extractAgentDirections('本版已完成。');
  assert.equal(fallback.length, 3);
  assert.ok(fallback.every((item) => typeof item === 'string' && item.length > 0));
});

test('detects visual continuation requests without treating ordinary questions as edits', () => {
  assert.equal(continuation.isImageContinuationRequest('调整视觉风格，加入更简洁的线性图标'), true);
  assert.equal(continuation.isImageContinuationRequest('优化构图并强化信息层级'), true);
  assert.equal(continuation.isImageContinuationRequest('这张图的提示词是什么？'), false);
  assert.equal(continuation.isImageContinuationRequest('帮我解释这段代码'), false);
});

test('uses the last image from the latest assistant image message', () => {
  const image = continuation.latestAssistantImage([
    { role: 'assistant', images: [{ id: 'old' }] },
    { role: 'user', content: '继续' },
    { role: 'assistant', images: [{ id: 'new-1' }, { id: 'new-2' }] },
  ]);

  assert.equal(image.id, 'new-2');
  assert.equal(continuation.latestAssistantImage([{ role: 'assistant', content: '没有图片' }]), null);
  assert.equal(continuation.buildContinuationPrompt('优化光线'), '请基于这张参考图继续修改：优化光线');
});
