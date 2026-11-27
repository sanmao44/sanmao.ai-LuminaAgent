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
  assert.match(html, /未评估的项目暂无通过或失败结论/);
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

test('keeps findings visible while the native disclosure is closed by default', () => {
  const html = renderToStaticMarkup(createElement(CreativeReviewPanel, { reports: [report()] }));
  assert.match(html, /^<details\b(?![^>]*\bopen(?:\s|=|>))[^>]*><summary>产物检查明细<span[^>]*>发现 1 项问题<\/span><\/summary>/);
  assert.match(html, /<\/summary>.*能力检查.*目标画面比例/);
});

test('keeps inconclusive brief checks and unevaluated quality and safety distinct', () => {
  const html = renderToStaticMarkup(createElement(CreativeReviewPanel, {
    reports: [report({
      mediaKind: 'image',
      capability: {
        status: 'unknown',
        evidence: [
          evidence({
            dimension: 'brief_visual_compliance', status: 'unknown', source: 'vision',
            observed: '本地视觉评审没有生成可验证的逐项结论', reason: '视觉评审超时。',
          }),
          evidence({
            dimension: 'brief_alignment', status: 'unknown', source: 'vision',
            observed: undefined, reason: '本次未启用视觉评审器。',
          }),
          evidence({ dimension: 'visual_quality', status: 'unknown', source: 'embedding', reason: '没有经校准的图像向量模型。' }),
        ],
      },
    })],
  }));
  const summary = html.match(/<summary>(.*?)<\/summary>/)?.[1];
  assert.equal(summary, '产物检查明细');
  assert.match(html, /画面与需求一致性<\/strong><span[^>]*>未得出结论<\/span>/);
  assert.match(html, /画面与需求一致性<\/strong><span[^>]*>未评估<\/span>/);
  assert.match(html, /视觉评审超时/);
  assert.match(html, /视觉质量<\/strong><span[^>]*>未评估<\/span>/);
  assert.match(html, /内容安全<\/strong><span[^>]*>未评估<\/span>/);
  assert.doesNotMatch(html, /依据：(图像向量|视觉模型)/);
});
