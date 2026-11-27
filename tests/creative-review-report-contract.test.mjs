import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { isCreativeReviewReport } = createTsRequire(process.cwd())('./packages/contracts/creative-review');

const report = {
  version: 'p1',
  mediaKind: 'image',
  artifactRef: '/api/storage/file?name=sample.png',
  checkedAt: '2026-11-27T00:00:00.000Z',
  capability: {
    status: 'unknown',
    evidence: [{ dimension: 'visual_quality', status: 'unknown', criterion: 'calibrated review required', reason: 'not calibrated', source: 'embedding' }],
  },
  safety: {
    status: 'unknown',
    evidence: [{ dimension: 'content_safety', status: 'unknown', criterion: 'calibrated review required', reason: 'not calibrated', source: 'vision' }],
  },
};

test('accepts a structured creative review for display in persisted Agent history', () => {
  assert.equal(isCreativeReviewReport(report), true);
});

test('rejects malformed persisted review payloads before UI rendering', () => {
  assert.equal(isCreativeReviewReport(null), false);
  assert.equal(isCreativeReviewReport({ ...report, version: 'p2' }), false);
  assert.equal(isCreativeReviewReport({ ...report, capability: { status: 'pass', evidence: [{ status: 'wrong' }] } }), false);
});

test('rejects summaries that contradict their evidence or lack a measured basis', () => {
  const passingEvidence = { dimension: 'aspect_ratio', status: 'pass', criterion: 'within tolerance', observed: '1:1', expected: '1:1', reason: 'measured ratio matches target', source: 'rule' };
  const failingEvidence = { ...passingEvidence, status: 'fail', observed: '16:9', reason: 'measured ratio exceeds tolerance' };
  const inconsistent = {
    ...report,
    capability: { status: 'pass', evidence: [failingEvidence] },
  };
  const missingObservation = {
    ...report,
    capability: { status: 'pass', evidence: [{ ...passingEvidence, observed: undefined }] },
  };
  const malformedValue = {
    ...report,
    capability: { status: 'pass', evidence: [{ ...passingEvidence, observed: Number.NaN }] },
  };

  assert.equal(isCreativeReviewReport(inconsistent), false);
  assert.equal(isCreativeReviewReport(missingObservation), false);
  assert.equal(isCreativeReviewReport(malformedValue), false);
  assert.equal(isCreativeReviewReport({ ...report, capability: { status: 'pass', evidence: [] } }), false);
});

test('accepts a consistent pass section with observed evidence', () => {
  const evidence = { dimension: 'aspect_ratio', status: 'pass', criterion: 'within tolerance', observed: '1:1', expected: '1:1', reason: 'measured ratio matches target', source: 'rule' };
  const consistent = { ...report, capability: { status: 'pass', evidence: [evidence] } };
  assert.equal(isCreativeReviewReport(consistent), true);
});
