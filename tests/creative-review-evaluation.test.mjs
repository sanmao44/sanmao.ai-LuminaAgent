import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = fileURLToPath(new URL('../scripts/evaluate-creative-review.mjs', import.meta.url));
const evaluator = await import(new URL('../scripts/evaluate-creative-review.mjs', import.meta.url));
const { main: benchmark } = await (await import('./lib-build.mjs')).buildLibModules(
  ['lib/creative-review/benchmark'],
  'lib/creative-review/benchmark',
);

test('rejects malformed expected aspect ratios as invalid benchmark input', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'creative-review-manifest-'));
  try {
    const samples = Array.from({ length: 20 }, (_, index) => {
      const mediaKind = index < 10 ? 'image' : 'video';
      return {
        id: `sample-${index}`,
        mediaKind,
        fileName: `sample-${index}.${mediaKind === 'image' ? 'png' : 'mp4'}`,
        sha256: createHash('sha256').update(String(index)).digest('hex'),
        brief: `真实需求样本 ${index}`,
        labelRationale: { capability: '人工对照交付标准记录', safety: '人工复核安全标签' },
        expectedAspectRatio: index === 0 ? '0:9' : '16:9',
        ...(mediaKind === 'video' ? { expectedDurationSeconds: 5 } : {}),
        expectedCapability: index % 2 ? 'fail' : 'pass',
        expectedSafety: index % 2 ? 'unsafe' : 'safe',
      };
    });
    const manifestPath = path.join(directory, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({ version: 1, samples }));

    const result = spawnSync(process.execPath, [
      script,
      '--manifest', manifestPath,
      '--media-dir', path.join(directory, 'media-not-created'),
      '--output', path.join(directory, 'report.json'),
    ], { encoding: 'utf8', windowsHide: true });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /expectedAspectRatio.*正数比例/);
    assert.doesNotMatch(result.stderr, /ENOENT|media-not-created/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


function validManifest() {
  return {
    version: 1,
    samples: Array.from({ length: 20 }, (_, index) => {
      const mediaKind = index < 10 ? 'image' : 'video';
      return {
        id: `sample-${index}`,
        mediaKind,
        fileName: `sample-${index}.${mediaKind === 'image' ? 'png' : 'mp4'}`,
        sha256: createHash('sha256').update(`sample-${index}`).digest('hex'),
        brief: `真实用户需求 ${index}`,
        labelRationale: { capability: '人工记录交付依据', safety: '人工记录安全依据' },
        expectedAspectRatio: '16:9',
        ...(mediaKind === 'video' ? { expectedDurationSeconds: 5 } : {}),
        expectedCapability: index % 2 ? 'fail' : 'pass',
        expectedSafety: index % 2 ? 'unsafe' : 'safe',
      };
    }),
  };
}

function previousReport(manifest, manifestSha256, fingerprint) {
  const samples = manifest.samples.map((sample) => {
    const capability = sample.expectedCapability;
    const safety = sample.expectedSafety === 'safe' ? 'pass' : 'fail';
    return {
      id: sample.id,
      mediaKind: sample.mediaKind,
      fileName: sample.fileName,
      sha256: sample.sha256,
      brief: sample.brief,
      expected: { capability: sample.expectedCapability, safety: sample.expectedSafety },
      labelRationale: sample.labelRationale,
      actual: { capability, safety },
      elapsedMs: 1,
      evidence: {
        capability: { status: capability, evidence: [{ status: capability }] },
        safety: { status: safety, evidence: [{ status: safety }] },
      },
    };
  });
  const summary = benchmark.summarizeCreativeReviewBenchmark(samples.map((sample) => ({
    mediaKind: sample.mediaKind,
    expectedCapability: sample.expected.capability,
    actualCapability: sample.actual.capability,
    expectedSafety: sample.expected.safety,
    actualSafety: sample.actual.safety,
  })));
  return {
    formatVersion: 1,
    runId: 'R1',
    evaluator: 'creative-review-p1-structure',
    evaluatorFingerprint: fingerprint,
    manifestSha256,
    sampleCount: 20,
    samples,
    summary,
  };
}

test('passes the exact original brief to both image and video reviewers', async () => {
  const manifest = validManifest();
  const brief = '  用户原始需求，需要保持原样  ';
  const imageSample = { ...manifest.samples[0], brief };
  const videoSample = { ...manifest.samples[10], brief };
  const calls = [];
  const report = { capability: { status: 'unknown' }, safety: { status: 'unknown' } };
  const dependencies = {
    imageReviewer: { reviewImageArtifact: async (input) => { calls.push({ mediaKind: 'image', ...input }); return report; } },
    videoReviewer: { reviewStoredVideoArtifact: async (input) => { calls.push({ mediaKind: 'video', ...input }); return report; } },
    mediaRoot: 'sample-media',
    ffmpegPath: 'ffmpeg',
  };

  await evaluator.reviewSample(imageSample, dependencies);
  await evaluator.reviewSample(videoSample, dependencies);

  assert.deepEqual(calls.map((call) => [call.mediaKind, call.brief]), [['image', brief], ['video', brief]]);
});

test('includes video signal thresholds in the R1/R2 evaluator fingerprint inputs', () => {
  assert.ok(evaluator.REVIEWER_SOURCE_FILES.includes('lib/creative-review/video-signal-diagnostics.ts'));
});

test('accepts a balanced 20-item manifest with original brief and human rationale', () => {
  assert.doesNotThrow(() => evaluator.validateManifest(validManifest()));
});

test('rejects unlabeled rationale and per-media label imbalance', () => {
  const missingRationale = validManifest();
  delete missingRationale.samples[0].labelRationale.safety;
  assert.throws(() => evaluator.validateManifest(missingRationale), /人工判定依据/);

  const imbalanced = validManifest();
  for (const index of [1, 3, 5, 7, 9]) imbalanced.samples[index].expectedCapability = 'pass';
  assert.throws(() => evaluator.validateManifest(imbalanced), /各至少需要 2 个/);
});

test('validates R1 evidence against the same manifest, evaluator fingerprint, and recomputed metrics', () => {
  const manifest = validManifest();
  const manifestSha256 = 'a'.repeat(64);
  const fingerprint = 'b'.repeat(64);
  const report = previousReport(manifest, manifestSha256, fingerprint);
  assert.doesNotThrow(() => evaluator.validatePreviousReport(report, manifest, manifestSha256, fingerprint, benchmark));

  const tampered = structuredClone(report);
  tampered.samples[0].actual.capability = 'unknown';
  assert.throws(() => evaluator.validatePreviousReport(tampered, manifest, manifestSha256, fingerprint, benchmark), /证据不完整/);

  assert.throws(() => evaluator.validatePreviousReport(report, manifest, manifestSha256, 'c'.repeat(64), benchmark), /评审器版本/);

  const changedRationale = structuredClone(report);
  changedRationale.samples[0].labelRationale.safety = '被改写';
  assert.throws(() => evaluator.validatePreviousReport(changedRationale, manifest, manifestSha256, fingerprint, benchmark), /证据不完整/);

  const alteredSummary = structuredClone(report);
  alteredSummary.summary.capability.correct -= 1;
  assert.throws(() => evaluator.validatePreviousReport(alteredSummary, manifest, manifestSha256, fingerprint, benchmark), /汇总与逐条/);
});

test('reports R1/R2 capability and safety agreement separately and rejects different sample counts', () => {
  const records = [
    { actual: { capability: 'pass', safety: 'unknown' } },
    { actual: { capability: 'fail', safety: 'pass' } },
  ];
  assert.deepEqual(evaluator.summarizeDecisionAgreement(records, structuredClone(records)), {
    comparedSamples: 2,
    capabilityMatches: 2,
    safetyMatches: 2,
  });
  assert.throws(() => evaluator.summarizeDecisionAgreement(records, records.slice(1)), /样本数量不一致/);
});
