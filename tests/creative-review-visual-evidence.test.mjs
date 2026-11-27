import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { reviewCreativeBrief } = createTsRequire(process.cwd())('./lib/creative-review/visual-evidence');
const validFrame = { dataUrl: 'data:image/jpeg;base64,/9j/2Q==', location: '第 1.2 秒抽样画面' };

 test('does not extract or dispatch frames when no visual reviewer is configured', async () => {
  let frameLoads = 0;
  const evidence = await reviewCreativeBrief({
    mediaKind: 'image', dimension: 'brief_visual_compliance', brief: 'A red product on white.',
    loadFrames: async () => { frameLoads += 1; return [validFrame]; },
  });
  assert.equal(evidence.status, 'unknown');
  assert.equal(evidence.source, 'vision');
  assert.equal(frameLoads, 0);
});

test('dispatches one bounded frame set with the raw brief and returns structured evidence', async () => {
  const calls = [];
  const evidence = await reviewCreativeBrief({
    mediaKind: 'video', dimension: 'brief_alignment',
    brief: 'A red car travels through a quiet city at dawn.',
    generationPrompt: 'generation-only wording',
    visualReviewer: async (input) => {
      calls.push(input);
      return { status: 'fail', criterion: '主体应持续运动', observed: '抽样画面中汽车静止', reason: '第 1.2 秒抽样画面显示汽车未移动。', source: 'vision' };
    },
    loadFrames: async () => [validFrame],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].brief, 'A red car travels through a quiet city at dawn.');
  assert.equal(calls[0].generationPrompt, 'generation-only wording');
  assert.equal(calls[0].frames.length, 1);
  assert.equal(evidence.dimension, 'brief_alignment');
  assert.equal(evidence.status, 'fail');
  assert.equal(evidence.source, 'vision');
  assert.equal(evidence.expected, 'A red car travels through a quiet city at dawn.');
  assert.equal(evidence.location, validFrame.location);
});

test('does not accept a visual pass without measured and expected evidence', async () => {
  const evidence = await reviewCreativeBrief({
    mediaKind: 'image', dimension: 'brief_visual_compliance', brief: 'A red product on white.',
    visualReviewer: async () => ({ status: 'pass', criterion: 'The product is red.', reason: 'It appears red.' }),
    loadFrames: async () => [validFrame],
  });
  assert.equal(evidence.status, 'unknown');
  assert.match(evidence.reason, /缺少可复核/u);
});

test('preserves numeric measurements from a complete visual judgment', async () => {
  const evidence = await reviewCreativeBrief({
    mediaKind: 'image', dimension: 'brief_visual_compliance', brief: 'At least 80% of the frame is white.',
    visualReviewer: async () => ({
      status: 'fail', criterion: 'White background coverage must be at least 80%.',
      observed: 67, expected: 80, reason: 'Measured white background coverage is 67%.',
    }),
    loadFrames: async () => [validFrame],
  });
  assert.equal(evidence.status, 'fail');
  assert.equal(evidence.observed, 67);
  assert.equal(evidence.expected, 80);
});

test('fails closed for absent briefs, unsafe frame shapes, and reviewer errors', async () => {
  let reviewerCalls = 0;
  const visualReviewer = async () => { reviewerCalls += 1; return { status: 'pass', reason: 'ok', source: 'vision' }; };
  const missingBrief = await reviewCreativeBrief({ mediaKind: 'image', dimension: 'brief_visual_compliance', visualReviewer, loadFrames: async () => [validFrame] });
  assert.equal(missingBrief.status, 'unknown');
  assert.equal(reviewerCalls, 0);
  const unsafeFrame = await reviewCreativeBrief({ mediaKind: 'image', dimension: 'brief_visual_compliance', brief: 'A product.', visualReviewer, loadFrames: async () => [{ ...validFrame, dataUrl: 'https://invalid.example/image.jpg' }] });
  assert.equal(unsafeFrame.status, 'unknown');
  assert.equal(reviewerCalls, 0);
  const failedReviewer = await reviewCreativeBrief({ mediaKind: 'image', dimension: 'brief_visual_compliance', brief: 'A product.', visualReviewer: async () => { throw new Error('provider failure'); }, loadFrames: async () => [validFrame] });
  assert.equal(failedReviewer.status, 'unknown');
  assert.match(failedReviewer.reason, /unknown|评审/u);
});
