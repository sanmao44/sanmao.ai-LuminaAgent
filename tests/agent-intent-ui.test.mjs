import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTsRequire } from './ts-require.mjs';

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const clarify = await readFile(new URL('../components/AgentIntentClarifyCard.tsx', import.meta.url), 'utf8');
const AssistantMarkdown = createTsRequire(new URL('..', import.meta.url).pathname)('./components/AssistantMarkdown').default;
const Icon = ({ name }) => createElement('i', { 'data-icon': name });

test('hides ordinary Agent deliverable notices from the composer', () => {
  assert.ok(page.includes("activeAgentIntent.deliverable === 'CLARIFY' && agentInput.trim()"));
  assert.ok(clarify.includes('className="agent-intent-card clarify-only"'));
  assert.equal(page.includes('Agent 判断 ·'), false);
});

test('keeps the compact clarification choices available', () => {
  assert.match(clarify, /\['IMAGE', '直接出图'\]/);
  assert.ok(clarify.includes('onChoose(value)'));
  assert.ok(clarify.includes('请确认交付形式'));
});

test('uses the shared deliverable as the only main Agent image-loading route', () => {
  assert.ok(page.includes("const likelyImageRequest = !task && (selectedDeliverable === 'IMAGE' || selectedDeliverable === 'BOTH');"));
  assert.equal(page.includes('likelyImageGenerationRequest(requestContent)'), false);
});

test('automatically persists a Qianfan key after a successful connection test', () => {
  assert.match(page, /if \(!webSearchAnySearchSelected && key\) \{\s*await saveWebSearchApi\(false, \{/s);
  assert.ok(page.includes('测试成功，已自动保存'));
  assert.ok(page.includes('搜索测试成功，但自动保存失败'));
});

test('renders follow-up directions only when the reply provided them', () => {
  const markup = renderToStaticMarkup(createElement(AssistantMarkdown, {
    content: '### 后续方向\n\n1. 优化光线',
    Icon,
    onNotify: () => {},
    directionPicker: { kind: 'image', directions: ['优化光线'], disabled: false, onSelect: () => {} },
  }));
  assert.match(markup, /agent-direction-section/);
  assert.match(markup, /agent-direction-option/);
  assert.match(markup, /aria-label="[^"]+"/);
});
