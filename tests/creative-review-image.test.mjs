import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import test from 'node:test';
import { buildLibModules } from './lib-build.mjs';
import { createTsRequire } from './ts-require.mjs';

const { isCreativeReviewReport } = createTsRequire(process.cwd())('./packages/contracts/creative-review');

const { main: review } = await buildLibModules(
  ['lib/image-storage', 'lib/media-paths', 'lib/creative-review/visual-evidence', 'lib/creative-review/image'],
  'lib/creative-review/image',
);

async function withImageRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-creative-review-'));
  await mkdir(root, { recursive: true });
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

async function save(root, bytes, extension = 'png') {
  const name = `${Date.now()}-${randomUUID()}.${extension}`;
  await writeFile(path.join(root, name), bytes);
  return `/api/storage/file?name=${name}`;
}

test('image review reports measured pixels and catches a requested ratio mismatch', async () => {
  await withImageRoot(async (root) => {
    const bytes = await sharp({ create: { width: 900, height: 900, channels: 3, background: '#fff' } }).png().toBuffer();
    const artifactRef = await save(root, bytes);
    const report = await review.reviewImageArtifact({ artifactRef, expectedAspectRatio: '9:16', storagePath: root });
    assert.equal(report.mediaKind, 'image');
    assert.equal(report.capability.status, 'fail', 'the measured aspect-ratio violation is a concrete failure');
    assert.equal(report.safety.status, 'unknown', 'technical validation cannot certify semantic safety');
    const ratio = report.capability.evidence.find((item) => item.dimension === 'requested_aspect_ratio');
    assert.equal(ratio.status, 'fail');
    assert.equal(ratio.observed, '900:900 (1.0000:1)');
    assert.equal(ratio.expected, '9:16 (0.5625:1)');
    assert.match(ratio.reason, /相差超过容差/);
    assert.deepEqual(report.capability.evidence.find((item) => item.dimension === 'pixel_dimensions').observed, '900×900');
  });
});

test('applies EXIF orientation before checking the requested aspect ratio', async () => {
  await withImageRoot(async (root) => {
    const bytes = await sharp({ create: { width: 320, height: 480, channels: 3, background: '#fff' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.orientation, 6, 'the fixture must retain portrait pixels with a clockwise display orientation');
    const artifactRef = await save(root, bytes, 'jpg');
    const report = await review.reviewImageArtifact({ artifactRef, expectedAspectRatio: '3:2', storagePath: root });
    const ratio = report.capability.evidence.find((item) => item.dimension === 'requested_aspect_ratio');
    assert.equal(ratio.status, 'pass');
    assert.equal(ratio.observed, '480:320 (1.5000:1)；已应用 EXIF 方向 6');
  });
});

test('image review passes structural checks but leaves uncalibrated quality and safety unknown', async () => {
  await withImageRoot(async (root) => {
    const bytes = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#fff' } }).png().toBuffer();
    const artifactRef = await save(root, bytes);
    const report = await review.reviewImageArtifact({ artifactRef, expectedAspectRatio: '3:2', storagePath: root });
    assert.equal(report.capability.status, 'unknown');
    assert.equal(report.capability.evidence.find((item) => item.dimension === 'image_decode').status, 'pass');
    assert.equal(report.capability.evidence.find((item) => item.dimension === 'requested_aspect_ratio').status, 'pass');
    assert.equal(report.capability.evidence.find((item) => item.dimension === 'brief_visual_compliance').status, 'unknown');
    assert.equal(report.capability.evidence.find((item) => item.dimension === 'visual_quality').status, 'unknown');
    assert.equal(report.safety.status, 'unknown');
  });
});

test('corrupt local image receives a structured decode failure without a false safety pass', async () => {
  await withImageRoot(async (root) => {
    const artifactRef = await save(root, Buffer.from('not an image'), 'png');
    const report = await review.reviewImageArtifact({ artifactRef, storagePath: root });
    assert.equal(report.capability.status, 'fail');
    assert.equal(report.capability.evidence[0].dimension, 'image_decode');
    assert.equal(report.capability.evidence[0].status, 'fail');
    assert.equal(report.safety.status, 'unknown');
  });
});

test('image review rejects a valid header with truncated pixel data', async () => {
  await withImageRoot(async (root) => {
    const complete = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#fff' } }).png().toBuffer();
    const truncated = complete.subarray(0, complete.length - 20);
    assert.equal((await sharp(truncated).metadata()).width, 256, 'the test input must retain a readable header');
    const artifactRef = await save(root, truncated);
    const report = await review.reviewImageArtifact({ artifactRef, storagePath: root });
    assert.equal(report.capability.status, 'fail');
    assert.equal(report.capability.evidence.find((item) => item.dimension === 'image_decode').status, 'fail');
    assert.equal(report.safety.status, 'unknown');
  });
});

test('external URLs and path-shaped references are rejected without fetching', async () => {
  const external = await review.reviewImageArtifact({ artifactRef: 'https://example.invalid/image.png' });
  assert.equal(external.capability.status, 'fail');
  assert.equal(external.safety.status, 'unknown');
  assert.equal(external.artifactRef, 'unavailable');
  assert.match(external.capability.evidence[0].reason, /不会请求外部 URL/);
  const traversal = await review.reviewImageArtifact({ artifactRef: '/api/storage/file?name=..%2Foutside.png' });
  assert.equal(traversal.capability.status, 'fail');
  assert.equal(isCreativeReviewReport(external), true, 'Canvas can display the rejected URL finding');
  assert.equal(isCreativeReviewReport(traversal), true, 'Canvas can display the rejected path finding');
  assert.equal(traversal.safety.status, 'unknown');
  assert.equal(traversal.artifactRef, 'unavailable');
});

test('image review rejects a stored filename that is a symlink outside the authorized root', async (t) => {
  await withImageRoot(async (root) => {
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'sanmao-creative-review-outside-'));
    try {
      const outside = path.join(outsideRoot, 'outside.png');
      await writeFile(outside, await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer());
      const linkName = `1795703699782-${randomUUID()}.png`;
      try {
        await symlink(outside, path.join(root, linkName));
      } catch (error) {
        if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return t.skip('host does not permit creating a symlink for this test');
        throw error;
      }
      const report = await review.reviewImageArtifact({ artifactRef: `/api/storage/file?name=${linkName}`, storagePath: root });
      assert.equal(report.capability.status, 'fail');
      assert.equal(report.safety.status, 'unknown');
      assert.match(report.capability.evidence[0].reason, /授权存储目录之外|符号链接保护/);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

test('missing local images return unknown and never block the generated artifact', async () => {
  await withImageRoot(async (root) => {
    const artifactRef = `/api/storage/file?name=${Date.now()}-${randomUUID()}.png`;
    const report = await review.reviewImageArtifact({ artifactRef, storagePath: root });
    assert.equal(report.capability.status, 'unknown');
    assert.equal(report.safety.status, 'unknown');
  });
});


test('ordinary Agent image delivery keeps technical checks without running visual inference', async () => {
  let visualCalls = 0;
  const load = createTsRequire(process.cwd(), {
    '@/lib/creative-review/local-vision': {
      reviewCreativeVisualsLocally: async () => {
        visualCalls++;
        return { status: 'pass', observed: 'fixture', reason: 'fixture' };
      },
    },
  });
  const { createAgentApplicationInfrastructure } = load('./apps/api/agent-composition');
  await withImageRoot(async (root) => {
    const bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#fff' } }).png().toBuffer();
    const artifactRef = await save(root, bytes);
    const report = await createAgentApplicationInfrastructure().creativeReview.reviewImageArtifact({
      artifactRef, storagePath: root, expectedAspectRatio: '4:3', brief: '画一张白底商品图。',
    });
    assert.equal(visualCalls, 0);
    assert.equal(isCreativeReviewReport(report), true);
    assert.equal(report.capability.evidence.find((item) => item.dimension === 'image_decode')?.status, 'pass');
    assert.equal(report.capability.evidence.find((item) => item.dimension === 'requested_aspect_ratio')?.status, 'pass');
    assert.equal(report.capability.evidence.find((item) => item.dimension === 'brief_visual_compliance')?.status, 'unknown');
    assert.equal(report.safety.status, 'unknown');
  });
});

test('image review sends one resized JPEG and the original brief to an injected reviewer', async () => {
  await withImageRoot(async (root) => {
    const original = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#fff' } }).png().toBuffer();
    const artifactRef = await save(root, original);
    const received = [];
    const report = await review.reviewImageArtifact({
      artifactRef, storagePath: root, expectedAspectRatio: '3:2',
      brief: 'A coffee cup centered on a clean counter.', generationPrompt: 'warm studio light',
      visualReviewer: async (input) => {
        received.push(input);
        return { dimension: 'brief_alignment', status: 'pass', criterion: '主体和构图符合 brief', observed: '画面中央有咖啡杯', reason: '观察到主体位于画面中央。', source: 'vision' };
      },
    });
    assert.equal(received.length, 1);
    assert.equal(received[0].brief, 'A coffee cup centered on a clean counter.');
    assert.equal(received[0].generationPrompt, 'warm studio light');
    assert.equal(received[0].mediaKind, 'image');
    assert.equal(received[0].frames.length, 1);
    const dataUrl = received[0].frames[0].dataUrl;
    assert.match(dataUrl, /^data:image\/jpeg;base64,/);
    const frame = Buffer.from(dataUrl.slice('data:image/jpeg;base64,'.length), 'base64');
    const metadata = await sharp(frame).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.ok(metadata.width <= 512 && metadata.height <= 512);
    assert.equal(report.capability.evidence.find((item) => item.dimension === 'brief_visual_compliance')?.status, 'pass');
  });
});
