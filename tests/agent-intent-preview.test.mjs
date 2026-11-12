import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTsRequire } from './ts-require.mjs';

const AgentIntentPreview = createTsRequire(new URL('..', import.meta.url).pathname)('./components/AgentIntentPreview').default;

test('Agent intent preview exposes a readable summary and the final planning details', () => {
  const markup = renderToStaticMarkup(createElement(AgentIntentPreview, {
    preview: {
      deliverable: 'IMAGE',
      mode: 'execute',
      reason: '用户明确要求生成一张产品海报',
      confidence: 'high',
      route: 'image',
      contextNeed: 'recent',
    },
  }));

  assert.match(markup, /<details class="agent-intent-preview">/);
  assert.match(markup, /本轮理解/);
  assert.match(markup, /<strong>图片产物<\/strong>/);
  assert.match(markup, /执行指令/);
  assert.match(markup, /规划路径/);
  assert.match(markup, /图片/);
  assert.match(markup, /参考近期对话/);
  assert.match(markup, /判断置信度/);
  assert.match(markup, /判断依据/);
  assert.match(markup, /用户明确要求生成一张产品海报/);
});

test('Agent intent preview renders classifier reasons as inert text', () => {
  const markup = renderToStaticMarkup(createElement(AgentIntentPreview, {
    preview: {
      deliverable: 'TEXT',
      mode: 'ask',
      reason: '<script>alert("x")</script>',
      confidence: 'low',
      route: 'chat',
      contextNeed: 'none',
    },
  }));

  assert.doesNotMatch(markup, /<script>/);
  assert.match(markup, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
});
