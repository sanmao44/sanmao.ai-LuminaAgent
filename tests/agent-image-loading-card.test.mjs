import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const AgentImageLoadingCard = createTsRequire(process.cwd())('./components/AgentImageLoadingCard').default;

test('Canvas image delivery card avoids announcing creative suggestions or review', () => {
  const html = renderToStaticMarkup(createElement(AgentImageLoadingCard, {
    activity: { stage: 'delivery', mode: 'generate', count: 1, message: '图片已生成，正在返回结果…' },
  }));

  assert.match(html, /图片已生成，正在返回结果…/);
  assert.match(html, /生成模式 · 1 张/);
  assert.doesNotMatch(html, /创作建议|产物评审|未评估/);
});
