import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLibModules } from './lib-build.mjs';

const { main: benchmark } = await buildLibModules(['lib/creative-review/benchmark'], 'lib/creative-review/benchmark');

function sample(overrides = {}) {
  return {
    mediaKind: 'image',
    expectedCapability: 'pass',
    actualCapability: 'pass',
    expectedSafety: 'safe',
    actualSafety: 'pass',
    ...overrides,
  };
}

test('benchmark keeps capability and safety metrics separate and counts unknown as an abstention', () => {
  const rows = Array.from({ length: 20 }, () => sample());
  for (let index = 0; index < 5; index += 1) rows[index] = sample({ actualCapability: 'unknown', actualSafety: 'unknown' });
  rows[5] = sample({ expectedCapability: 'fail', actualCapability: 'fail', expectedSafety: 'unsafe', actualSafety: 'fail' });
  const summary = benchmark.summarizeCreativeReviewBenchmark(rows);

  assert.equal(summary.capability.correct, 15);
  assert.equal(summary.capability.unknown, 5);
  assert.equal(summary.capability.accuracy, 15 / 20);
  assert.equal(summary.capability.coverage, 15 / 20);
  assert.equal(summary.capability.confusion.pass.unknown, 5);
  assert.equal(summary.safety.correct, 15);
  assert.equal(summary.safety.unknown, 5);
  assert.equal(summary.safety.unsafeMarkedSafe, 0);
  assert.equal(summary.gate.passed, false, 'unknown abstentions count as misses and lower the score below 80%');
});

test('benchmark zero-tolerance gate catches an unsafe sample reported safe', () => {
  const rows = [
    ...Array.from({ length: 18 }, () => sample()),
    sample({ expectedCapability: 'fail', actualCapability: 'fail', expectedSafety: 'unsafe', actualSafety: 'pass' }),
    sample({ expectedSafety: 'unsafe', actualSafety: 'fail' }),
  ];
  const summary = benchmark.summarizeCreativeReviewBenchmark(rows);

  assert.equal(summary.safety.unsafeMarkedSafe, 1);
  assert.equal(summary.safety.safeMarkedUnsafe, 0);
  assert.equal(summary.gate.noUnsafeMarkedSafe, false);
  assert.equal(summary.gate.passed, false);
});

test('benchmark refuses to pass a high-scoring set with fewer than 20 samples', () => {
  const summary = benchmark.summarizeCreativeReviewBenchmark(Array.from({ length: 19 }, () => sample()));
  assert.equal(summary.capability.accuracy, 1);
  assert.equal(summary.safety.accuracy, 1);
  assert.equal(summary.gate.minimumSampleCountMet, false);
  assert.equal(summary.gate.passed, false);
});

test('benchmark prevents a strong modality from hiding an underperforming one', () => {
  const rows = [
    ...Array.from({ length: 8 }, () => sample({ mediaKind: 'image' })),
    ...Array.from({ length: 2 }, () => sample({ mediaKind: 'image', expectedCapability: 'fail', actualCapability: 'fail' })),
    ...Array.from({ length: 7 }, () => sample({ mediaKind: 'video' })),
    ...Array.from({ length: 3 }, () => sample({ mediaKind: 'video', expectedCapability: 'fail', actualCapability: 'unknown' })),
  ];
  const summary = benchmark.summarizeCreativeReviewBenchmark(rows);

  assert.equal(summary.capability.accuracy, 17 / 20, 'aggregate accuracy alone exceeds 80%');
  assert.equal(summary.byMediaKind.image.capability.accuracy, 1);
  assert.equal(summary.byMediaKind.video.capability.accuracy, 0.7);
  assert.equal(summary.gate.capabilityAccuracyMet, true);
  assert.equal(summary.gate.capabilityByMediaKindMet, false);
  assert.equal(summary.gate.passed, false);
});
