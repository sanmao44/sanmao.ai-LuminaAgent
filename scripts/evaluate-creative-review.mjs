#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildLibModules } from '../tests/lib-build.mjs';

const MINIMUM_SAMPLES = 20;
const MINIMUM_PER_LABEL_AND_MEDIA = 2;
const EVALUATOR_ID = 'creative-review-p1-structure';
export const REVIEWER_SOURCE_FILES = Object.freeze([
  'package.json',
  'package-lock.json',
  'lib/image-storage.ts',
  'lib/media-paths.ts',
  'lib/video-trim-service.ts',
  'lib/creative-review/image.ts',
  'lib/creative-review/video.ts',
  'lib/creative-review/video-signal-diagnostics.ts',
  'lib/creative-review/visual-evidence.ts',
  'lib/creative-review/benchmark.ts',
  'tests/lib-build.mjs',
]);
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}\.(?:png|jpe?g|webp|gif|bmp|svg|mp4|webm|mov|ogv|m4v)$/iu;
const SHA256 = /^[a-f0-9]{64}$/iu;
const REVIEW_STATUSES = new Set(['pass', 'fail', 'unknown']);

function optionsFrom(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--manifest', '--media-dir', '--output', '--previous'].includes(key)) throw new Error(`不支持的参数：${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} 后缺少路径`);
    options[key.slice(2)] = value;
    index += 1;
  }
  for (const key of ['manifest', 'media-dir', 'output']) {
    if (!options[key]) throw new Error(`缺少必填参数 --${key}`);
  }
  return options;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function isValidAspectRatio(value) {
  const match = typeof value === 'string' && value.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/u);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
}

export function reviewerFingerprint(sourceBytes) {
  const digest = createHash('sha256');
  for (const [fileName, bytes] of sourceBytes) digest.update(fileName, 'utf8').update('\0').update(bytes).update('\0');
  return digest.digest('hex');
}

export function sectionStatus(section) {
  if (!section || !Array.isArray(section.evidence) || !section.evidence.length) return null;
  if (section.evidence.some((item) => item.status === 'fail')) return 'fail';
  if (section.evidence.some((item) => item.status === 'unknown')) return 'unknown';
  return 'pass';
}

export function validatePreviousReport(previous, manifest, manifestSha256, fingerprint, metrics) {
  if (previous?.formatVersion !== 1
    || previous?.runId !== 'R1'
    || previous?.evaluator !== EVALUATOR_ID
    || previous?.evaluatorFingerprint !== fingerprint
    || previous?.manifestSha256 !== manifestSha256
    || previous?.sampleCount !== MINIMUM_SAMPLES
    || !Array.isArray(previous?.samples)
    || previous.samples.length !== MINIMUM_SAMPLES) {
    throw new Error('--previous 报告的评审器版本、清单哈希或样本数量不匹配；两轮必须使用同一实现和同一组样本。');
  }

  for (const [index, sample] of manifest.samples.entries()) {
    const record = previous.samples[index];
    const capabilityEvidence = record?.evidence?.capability;
    const safetyEvidence = record?.evidence?.safety;
    const evidenceStatusesValid = [capabilityEvidence, safetyEvidence].every((section) => (
      Array.isArray(section?.evidence)
      && section.evidence.length > 0
      && section.evidence.every((item) => REVIEW_STATUSES.has(item?.status))
      && section.status === sectionStatus(section)
    ));
    if (!record
      || record.id !== sample.id
      || record.mediaKind !== sample.mediaKind
      || record.fileName !== sample.fileName
      || String(record.sha256).toLowerCase() !== sample.sha256.toLowerCase()
      || record.brief !== sample.brief
      || record.labelRationale?.capability !== sample.labelRationale.capability
      || record.labelRationale?.safety !== sample.labelRationale.safety
      || record.expected?.capability !== sample.expectedCapability
      || record.expected?.safety !== sample.expectedSafety
      || !REVIEW_STATUSES.has(record.actual?.capability)
      || !REVIEW_STATUSES.has(record.actual?.safety)
      || !Number.isFinite(record.elapsedMs)
      || record.elapsedMs < 0
      || !evidenceStatusesValid
      || record.actual.capability !== capabilityEvidence.status
      || record.actual.safety !== safetyEvidence.status) {
      throw new Error(`--previous 报告第 ${index + 1} 条记录与本次清单不一致或证据不完整。`);
    }
  }

  const recomputedSummary = metrics.summarizeCreativeReviewBenchmark(previous.samples.map((record) => ({
    mediaKind: record.mediaKind,
    expectedCapability: record.expected.capability,
    actualCapability: record.actual.capability,
    expectedSafety: record.expected.safety,
    actualSafety: record.actual.safety,
  })));
  if (JSON.stringify(previous.summary) !== JSON.stringify(recomputedSummary)) {
    throw new Error('--previous 报告汇总与逐条人工标签/评审结果不一致。');
  }
}

export async function reviewSample(sample, { imageReviewer, videoReviewer, mediaRoot, ffmpegPath }) {
  const artifactRef = sample.mediaKind === 'image'
    ? `/api/storage/file?name=${sample.fileName}`
    : `${sample.id}:${sample.fileName}`;
  return sample.mediaKind === 'image'
    ? imageReviewer.reviewImageArtifact({
      artifactRef,
      brief: sample.brief,
      expectedAspectRatio: sample.expectedAspectRatio,
      storagePath: mediaRoot,
    })
    : videoReviewer.reviewStoredVideoArtifact({
      artifactRef,
      storedRef: `/api/storage/video?name=${sample.fileName}`,
      storagePath: mediaRoot,
      brief: sample.brief,
      expectedAspectRatio: sample.expectedAspectRatio,
      expectedDurationSeconds: sample.expectedDurationSeconds,
      ffmpegPath,
    });
}

async function hashLocalFile(root, fileName) {
  if (!FILE_NAME.test(fileName)) throw new Error(`样本文件名不是受支持的平面文件名：${fileName}`);
  const candidate = path.join(root, fileName);
  let handle;
  try {
    handle = await open(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`样本不是普通文件：${fileName}`);
    const [entry, resolved] = await Promise.all([lstat(candidate), realpath(candidate)]);
    const resolvedStat = await stat(resolved);
    if (entry.isSymbolicLink() || !inside(root, resolved)) throw new Error(`样本路径越过媒体目录或经过符号链接：${fileName}`);
    if (!before.ino || !resolvedStat.ino || before.dev !== resolvedStat.dev || before.ino !== resolvedStat.ino) {
      throw new Error(`样本文件身份无法稳定验证：${fileName}`);
    }
    const digest = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk);
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) {
      throw new Error(`计算校验值期间样本文件发生变化：${fileName}`);
    }
    return digest.digest('hex');
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`找不到样本文件：${fileName}`);
    if (error?.code === 'ELOOP') throw new Error(`样本文件是符号链接，已拒绝：${fileName}`);
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function validateManifest(manifest) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.samples) || manifest.samples.length !== MINIMUM_SAMPLES) {
    throw new Error(`清单必须使用 version: 1，并且正好包含 ${MINIMUM_SAMPLES} 个人工标注样本。`);
  }
  const ids = new Set();
  const files = new Set();
  const hashes = new Set();
  const kinds = new Set();
  const labelCounts = {
    image: { capability: { pass: 0, fail: 0 }, safety: { safe: 0, unsafe: 0 } },
    video: { capability: { pass: 0, fail: 0 }, safety: { safe: 0, unsafe: 0 } },
  };
  for (const sample of manifest.samples) {
    if (!/^[A-Za-z0-9._:-]{1,80}$/u.test(sample.id || '') || ids.has(sample.id)) throw new Error(`样本 ID 无效或重复：${sample.id}`);
    if (!['image', 'video'].includes(sample.mediaKind)) throw new Error(`样本 ${sample.id} 的 mediaKind 必须是 image 或 video。`);
    if (!FILE_NAME.test(sample.fileName || '') || files.has(sample.fileName.toLowerCase())) throw new Error(`样本 ${sample.id} 的文件名无效或重复。`);
    if (!SHA256.test(sample.sha256 || '') || hashes.has(sample.sha256.toLowerCase())) throw new Error(`样本 ${sample.id} 的 SHA-256 缺失、格式错误或与其他样本重复。`);
    if (!['pass', 'fail'].includes(sample.expectedCapability)) throw new Error(`样本 ${sample.id} 必须由人工标注 expectedCapability: pass|fail。`);
    if (!['safe', 'unsafe'].includes(sample.expectedSafety)) throw new Error(`样本 ${sample.id} 必须由人工标注 expectedSafety: safe|unsafe。`);
    if (typeof sample.brief !== 'string' || !sample.brief.trim() || sample.brief.length > 4000) {
      throw new Error(`样本 ${sample.id} 必须包含不超过 4000 字符的原始 brief。`);
    }
    if (typeof sample.labelRationale?.capability !== 'string' || !sample.labelRationale.capability.trim()
      || typeof sample.labelRationale?.safety !== 'string' || !sample.labelRationale.safety.trim()) {
      throw new Error(`样本 ${sample.id} 必须分别记录能力标签与安全标签的人工判定依据。`);
    }
    if (sample.expectedAspectRatio !== undefined && !isValidAspectRatio(sample.expectedAspectRatio)) {
      throw new Error(`样本 ${sample.id} 的 expectedAspectRatio 必须是正数比例，例如 16:9。`);
    }
    if (sample.expectedDurationSeconds !== undefined && (!Number.isFinite(sample.expectedDurationSeconds) || sample.expectedDurationSeconds <= 0)) {
      throw new Error(`样本 ${sample.id} 的 expectedDurationSeconds 必须是正数。`);
    }
    if (sample.mediaKind === 'image' && sample.expectedDurationSeconds !== undefined) throw new Error(`图片样本 ${sample.id} 不能设置视频目标时长。`);
    ids.add(sample.id);
    files.add(sample.fileName.toLowerCase());
    hashes.add(sample.sha256.toLowerCase());
    kinds.add(sample.mediaKind);
    labelCounts[sample.mediaKind].capability[sample.expectedCapability] += 1;
    labelCounts[sample.mediaKind].safety[sample.expectedSafety] += 1;
  }
  if (kinds.size < 2) throw new Error('20 个样本必须同时包含图片与视频，才能覆盖两类创作产物。');
  for (const kind of kinds) {
    if (manifest.samples.filter((sample) => sample.mediaKind === kind).length < 5) throw new Error(`${kind} 样本少于 5 个，无法形成有意义的分类评测。`);
    const counts = labelCounts[kind];
    if (Object.values(counts.capability).some((count) => count < MINIMUM_PER_LABEL_AND_MEDIA)
      || Object.values(counts.safety).some((count) => count < MINIMUM_PER_LABEL_AND_MEDIA)) {
      throw new Error(`${kind} 样本的能力 pass/fail 和安全 safe/unsafe 标签各至少需要 ${MINIMUM_PER_LABEL_AND_MEDIA} 个，避免类别失衡掩盖漏检。`);
    }
  }
}

function statusCounts(score) {
  const percent = (value) => value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`;
  return `准确率 ${percent(score.accuracy)}（${score.correct}/${score.total}），覆盖率 ${percent(score.coverage)}，未评估 ${score.unknown}`;
}

export function summarizeDecisionAgreement(records, previousRecords) {
  if (!Array.isArray(previousRecords) || records.length !== previousRecords.length) {
    throw new Error('R1/R2 样本数量不一致，无法比较判定一致率。');
  }
  return {
    comparedSamples: records.length,
    capabilityMatches: records.filter((record, index) => record.actual.capability === previousRecords[index].actual.capability).length,
    safetyMatches: records.filter((record, index) => record.actual.safety === previousRecords[index].actual.safety).length,
  };
}

async function main() {
  const options = optionsFrom(process.argv.slice(2));
  const manifestPath = path.resolve(options.manifest);
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  validateManifest(manifest);
  const mediaRoot = await realpath(path.resolve(options['media-dir']));
  const outputPath = path.resolve(options.output);
  const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
  const reviewerSources = await Promise.all([
    readFile(new URL(import.meta.url)).then((bytes) => ['scripts/evaluate-creative-review.mjs', bytes]),
    ...REVIEWER_SOURCE_FILES.map(async (fileName) => [fileName, await readFile(path.resolve(fileName))]),
  ]);
  const evaluatorFingerprint = reviewerFingerprint(reviewerSources);
  const { main: metrics } = await buildLibModules(['lib/creative-review/benchmark'], 'lib/creative-review/benchmark');
  let previous = null;
  let previousBytes = null;
  if (options.previous) {
    previousBytes = await readFile(path.resolve(options.previous));
    previous = JSON.parse(previousBytes.toString('utf8'));
    validatePreviousReport(previous, manifest, manifestSha256, evaluatorFingerprint, metrics);
  }

  for (const sample of manifest.samples) {
    const actualSha256 = await hashLocalFile(mediaRoot, sample.fileName);
    if (actualSha256.toLowerCase() !== sample.sha256.toLowerCase()) throw new Error(`样本 ${sample.id} 的 SHA-256 与人工标注清单不一致。`);
  }

  const { main: imageReviewer } = await buildLibModules(
    ['lib/image-storage', 'lib/media-paths', 'lib/creative-review/image'],
    'lib/creative-review/image',
  );
  const { main: videoReviewer, load } = await buildLibModules(
    ['lib/creative-review/video', 'lib/video-trim-service'],
    'lib/creative-review/video',
  );
  const { command: ffmpegPath } = manifest.samples.some((sample) => sample.mediaKind === 'video')
    ? await (await load('video-trim-service')).resolveFfmpeg()
    : { command: '' };

  const records = [];
  const startedAt = Date.now();
  for (const sample of manifest.samples) {
    const sampleStartedAt = Date.now();
    const report = await reviewSample(sample, { imageReviewer, videoReviewer, mediaRoot, ffmpegPath });
    const capabilityAfter = await hashLocalFile(mediaRoot, sample.fileName);
    if (capabilityAfter.toLowerCase() !== sample.sha256.toLowerCase()) throw new Error(`评审样本 ${sample.id} 时文件内容发生变化；该轮无效。`);
    records.push({
      id: sample.id,
      mediaKind: sample.mediaKind,
      fileName: sample.fileName,
      sha256: sample.sha256.toLowerCase(),
      brief: sample.brief,
      expected: { capability: sample.expectedCapability, safety: sample.expectedSafety },
      labelRationale: sample.labelRationale,
      actual: { capability: report.capability.status, safety: report.safety.status },
      elapsedMs: Date.now() - sampleStartedAt,
      evidence: { capability: report.capability, safety: report.safety },
    });
  }

  const summary = metrics.summarizeCreativeReviewBenchmark(records.map((record) => ({
    mediaKind: record.mediaKind,
    expectedCapability: record.expected.capability,
    actualCapability: record.actual.capability,
    expectedSafety: record.expected.safety,
    actualSafety: record.actual.safety,
  })));
  const runId = previous ? 'R2' : 'R1';
  const decisionAgreement = previous ? summarizeDecisionAgreement(records, previous.samples) : null;
  const result = {
    formatVersion: 1,
    evaluator: EVALUATOR_ID,
    evaluatorFingerprint,
    runId,
    previousRun: previous ? {
      runId: previous.runId,
      manifestSha256: previous.manifestSha256,
      evaluatorFingerprint: previous.evaluatorFingerprint,
      reportSha256: createHash('sha256').update(previousBytes).digest('hex'),
    } : null,
    decisionAgreement,
    evaluatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    manifestSha256,
    sampleCount: records.length,
    cost: { modelCalls: 0, tokens: null, estimatedUsd: null, note: '当前结构评审不调用模型；token 与模型费用不适用。' },
    summary,
    samples: records,
  };
  await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  console.log(`评测结果：${outputPath}`);
  console.log(`能力检查：${statusCounts(summary.capability)}`);
  console.log(`安全判断：${statusCounts(summary.safety)}`);
  console.log(`不安全样本误报为安全：${summary.safety.unsafeMarkedSafe}（必须为 0）`);
  console.log(`耗时：${result.elapsedMs} ms；模型调用：0；token/费用：不适用`);
  console.log(`P1 门槛：${summary.gate.passed ? '通过' : '未通过'}；完整报告已保存，unknown 按未命中计分。`);
  if (!summary.gate.passed) process.exitCode = 2;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`评测未完成：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}



