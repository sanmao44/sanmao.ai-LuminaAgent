import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const CreativeReviewPanel = createTsRequire(process.cwd())('./components/CreativeReviewPanel').default;

const evidence = (overrides = {}) => ({
  dimension: 'requested_aspect_ratio',
  status: 'fail',
  criterion: '相对误差不超过 2%',
  observed: '1:1 (1.0000:1)',
  expected: '9:16 (0.5625:1)',
  reason: '实测比例与目标比例相差超过容差。',
  source: 'rule',
  ...overrides,
});

function report(overrides = {}) {
  return {
    version: 'p1',
    mediaKind: 'video',
    artifactRef: 'task-1:1',
    checkedAt: '2026-11-27T00:00:00.000Z',
    capability: { status: 'fail', evidence: [evidence()] },
    safety: { status: 'unknown', evidence: [evidence({ dimension: 'content_safety', status: 'unknown', observed: undefined, expected: undefined, reason: '没有经校准的安全评审器。', source: 'vision' })] },
    ...overrides,
  };
}

test('renders reviewer evidence in separate capability and safety sections without a combined score', () => {
  const html = renderToStaticMarkup(createElement(CreativeReviewPanel, { reports: [report()] }));
  assert.match(html, /能力检查/);
  assert.match(html, /安全判断/);
  assert.match(html, /发现问题/);
  assert.match(html, /未评估/);
  assert.match(html, /目标画面比例/);
  assert.match(html, /1:1 \(1\.0000:1\)/);
  assert.match(html, /9:16 \(0\.5625:1\)/);
  assert.match(html, /没有经校准的安全评审器/);
  assert.match(html, /视觉评审未完成/);
  assert.match(html, /未评估”不代表通过/);
  assert.doesNotMatch(html, /综合分|总分|score/i);
});

test('states explicitly when an older task has no saved review record', () => {
  const html = renderToStaticMarkup(createElement(CreativeReviewPanel, {}));
  assert.match(html, /没有已保存的评审记录/);
  assert.doesNotMatch(html, /已检查项符合/);
});


test('labels multiple image reports as images and keeps unknown visual judgment explicit', () => {
  const html = renderToStaticMarkup(createElement(CreativeReviewPanel, {
    reports: [report({ mediaKind: 'image' }), report({ mediaKind: 'image', artifactRef: 'image-2' })],
  }));
  assert.match(html, /第 1 张图片/);
  assert.match(html, /第 2 张图片/);
  assert.doesNotMatch(html, /第 \d+ 个视频/);
});

test('does not label an unknown embedding review as completed evidence', () => {
  const html = renderToStaticMarkup(createElement(CreativeReviewPanel, {
    reports: [report({
      capability: {
        status: 'unknown',
        evidence: [evidence({ dimension: 'visual_quality', status: 'unknown', source: 'embedding', reason: '没有经校准的图像向量模型。' })],
      },
    })],
  }));
  assert.match(html, /依据：图像向量评审未完成/);
  assert.doesNotMatch(html, /依据：图像向量<\/small>/);
});
