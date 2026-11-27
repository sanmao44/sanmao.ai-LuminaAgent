import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';


const require = createRequire(import.meta.url);
const { createTsRequire } = await import('./ts-require.mjs');
const { reviewVideoBuffer, reviewStoredVideoArtifact } = createTsRequire(process.cwd())('./lib/creative-review/video');
const { buildVideoSignalEvidence } = createTsRequire(process.cwd())('./lib/creative-review/video-signal-diagnostics');
const ffmpegPath = require('ffmpeg-static');
const canRunFfmpeg = Boolean(ffmpegPath && existsSync(ffmpegPath)
  && spawnSync(ffmpegPath, ['-hide_banner', '-version'], { stdio: 'ignore', windowsHide: true, timeout: 10_000 }).status === 0);

function run(command, args, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* The process may have exited. */ }
      resolve({ code: null, stderr, timedOut: true });
    }, timeoutMs);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stderr: String(error?.message || error), timedOut: false });
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stderr, timedOut: false });
    });
  });
}

async function createVideoFixture({ filter, color = 'red', duration = 1 } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-creative-review-video-test-'));
  const videoPath = path.join(directory, 'fixture.mp4');
  const generated = await run(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=' + color + ':s=320x180:r=24:d=' + duration,
    ...(filter ? ['-vf', filter] : []),
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath,
  ]);
  if (generated.code !== 0) {
    await rm(directory, { recursive: true, force: true });
    throw new Error(`Could not create test fixture: ${generated.stderr}`);
  }
  return {
    directory,
    bytes: await readFile(videoPath),
  };
}

test('locally decodes video and returns measurable, structured evidence without a total score', async (t) => {
  if (!canRunFfmpeg) return t.skip('ffmpeg-static is unavailable');
  const fixture = await createVideoFixture();
  try {
    const report = await reviewVideoBuffer({
      bytes: fixture.bytes,
      artifactRef: 'video-artifact-1',
      expectedAspectRatio: '16:9',
      expectedDurationSeconds: 1,
      ffmpegPath,
    });
    const evidence = report.capability.evidence;
    const decode = evidence.find((item) => item.dimension === 'video_decode');
    const dimensions = evidence.find((item) => item.dimension === 'video_dimensions');
    const duration = evidence.find((item) => item.dimension === 'video_duration');
    const aspect = evidence.find((item) => item.dimension === 'requested_aspect_ratio');
    const visual = evidence.find((item) => item.dimension === 'brief_alignment');
    const black = evidence.find((item) => item.dimension === 'black_frame_hints');
    const freeze = evidence.find((item) => item.dimension === 'freeze_hints');
    const subtitleTimeline = evidence.find((item) => item.dimension === 'subtitle_timeline');

    assert.equal(report.mediaKind, 'video');
    assert.equal(report.artifactRef, 'video-artifact-1');
    assert.equal(decode?.status, 'pass');
    assert.equal(dimensions?.observed, '320×180');
    assert.equal(dimensions?.status, 'pass');
    assert.equal(duration?.status, 'pass');
    assert.match(String(duration?.observed), /0\.9\d{2} s \(decoded timeline\)/);
    assert.equal(aspect?.status, 'pass');
    assert.equal(visual?.status, 'unknown');
    assert.equal(black?.status, 'unknown');
    assert.equal(freeze?.status, 'unknown');
    assert.equal(subtitleTimeline?.status, 'unknown');
    assert.equal(report.capability.status, 'unknown', 'unknown visual checks must not be counted as passing');
    assert.equal(report.safety.status, 'unknown');
    assert.equal('score' in report, false);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('reports black intervals with thresholds and review locations without changing pass/fail status', async (t) => {
  if (!canRunFfmpeg) return t.skip('ffmpeg-static is unavailable');
  const fixture = await createVideoFixture({ color: 'black', duration: 1 });
  try {
    const report = await reviewVideoBuffer({ bytes: fixture.bytes, artifactRef: 'black-video', ffmpegPath });
    const black = report.capability.evidence.find((item) => item.dimension === 'black_frame_hints');
    const decode = report.capability.evidence.find((item) => item.dimension === 'video_decode');
    assert.equal(decode?.status, 'pass');
    assert.equal(black?.status, 'unknown');
    assert.match(String(black?.expected), /0\.50 s.*pix_th=0\.10.*98%/);
    assert.match(String(black?.observed), /候选区间/);
    assert.match(String(black?.location), /0\.000 s/);
    assert.match(String(black?.reason), /人工复核/);
    assert.equal(report.safety.status, 'unknown');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('reports long static scenes as freeze candidates, never automatic failures', async (t) => {
  if (!canRunFfmpeg) return t.skip('ffmpeg-static is unavailable');
  const fixture = await createVideoFixture({ color: 'red', duration: 3 });
  try {
    const report = await reviewVideoBuffer({ bytes: fixture.bytes, artifactRef: 'freeze-video', ffmpegPath });
    const freeze = report.capability.evidence.find((item) => item.dimension === 'freeze_hints');
    const decode = report.capability.evidence.find((item) => item.dimension === 'video_decode');
    assert.equal(decode?.status, 'pass');
    assert.equal(freeze?.status, 'unknown');
    assert.match(String(freeze?.expected), /2\.00 s.*-50 dB/);
    assert.match(String(freeze?.observed), /候选区间/);
    assert.match(String(freeze?.location), /0\.000 s/);
    assert.match(String(freeze?.reason), /人工复核/);
    assert.equal(report.capability.status, 'unknown');
    assert.equal(report.safety.status, 'unknown');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('falls back to plain decode if the local FFmpeg build lacks signal filters', async (t) => {
  if (!canRunFfmpeg) return t.skip('ffmpeg-static is unavailable');
  const fixture = await createVideoFixture();
  const childProcessModule = require('node:child_process');
  const originalSpawn = childProcessModule.spawn;
  let filteredAttempts = 0;
  childProcessModule.spawn = (command, args, options) => {
    if (args.includes('-vf') && args.some((argument) => String(argument).includes('blackdetect'))) {
      filteredAttempts += 1;
      return originalSpawn(process.execPath, ['-e', "console.error('No such filter: blackdetect'); process.exit(1)"], options);
    }
    return originalSpawn(command, args, options);
  };
  try {
    const report = await reviewVideoBuffer({ bytes: fixture.bytes, artifactRef: 'filter-fallback', ffmpegPath });
    const decode = report.capability.evidence.find((item) => item.dimension === 'video_decode');
    const black = report.capability.evidence.find((item) => item.dimension === 'black_frame_hints');
    assert.equal(filteredAttempts, 1);
    assert.equal(decode?.status, 'pass');
    assert.equal(black?.status, 'unknown');
    assert.equal(black?.observed, '检测器不可用');
    assert.match(String(black?.reason), /不支持/);
  } finally {
    childProcessModule.spawn = originalSpawn;
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('keeps truncated signal logs unknown and never treats missing intervals as proof of absence', () => {
  const evidence = buildVideoSignalEvidence({ stderr: '', complete: false, truncated: true });
  assert.equal(evidence.every((item) => item.status === 'unknown'), true);
  assert.equal(evidence.every((item) => item.observed === '未取得完整扫描结果'), true);
  assert.equal(evidence.every((item) => /日志被截断/.test(item.reason)), true);
});

test('sends bounded representative frames and the original brief to an injected reviewer', async (t) => {
  if (!canRunFfmpeg) return t.skip('ffmpeg-static is unavailable');
  const fixture = await createVideoFixture();
  const received = [];
  try {
    const report = await reviewVideoBuffer({
      bytes: fixture.bytes,
      artifactRef: 'video-visual-review',
      brief: 'A red car drives through a quiet city at dawn.',
      visualReviewer: async (input) => {
        received.push(input);
        return {
          dimension: 'brief_alignment',
          status: 'fail',
          criterion: '主体与场景符合创作需求',
          observed: '红色汽车，静止画面',
          expected: input.brief,
          reason: '第一个抽样画面中汽车没有移动。',
          source: 'vision',
          location: input.frames[0]?.location,
        };
      },
      expectedAspectRatio: '16:9',
      expectedDurationSeconds: 1,
      ffmpegPath,
    });
    const alignment = report.capability.evidence.find((item) => item.dimension === 'brief_alignment');
    assert.equal(received.length, 1);
    assert.equal(received[0].brief, 'A red car drives through a quiet city at dawn.');
    assert.equal(received[0].mediaKind, 'video');
    assert.equal(received[0].frames.length > 0, true);
    assert.equal(received[0].frames.length <= 3, true);
    for (const frame of received[0].frames) {
      assert.match(frame.dataUrl, /^data:image\/jpeg;base64,/);
      assert.match(frame.location, /秒|抽样画面/);
      assert.equal(Buffer.from(frame.dataUrl.slice('data:image/jpeg;base64,'.length), 'base64').subarray(0, 2).toString('hex'), 'ffd8');
    }
    assert.equal(alignment?.status, 'fail');
    assert.equal(alignment?.source, 'vision');
    assert.match(String(alignment?.reason), /没有移动/);
    assert.match(String(alignment?.location), /秒|抽样画面/);
    assert.equal(report.safety.status, 'unknown');
    assert.match(String(report.safety.evidence[0]?.reason), /最多三张抽样静帧/);
    assert.match(String(report.safety.evidence[0]?.reason), /内容安全、连续运动或字幕时序/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('uses the non-square sample aspect ratio for the displayed video ratio', async (t) => {
  if (!canRunFfmpeg) return t.skip('ffmpeg-static is unavailable');
  const fixture = await createVideoFixture({ filter: 'setsar=2/1' });
  try {
    const report = await reviewVideoBuffer({ bytes: fixture.bytes, artifactRef: 'sar-video', expectedAspectRatio: '32:9', ffmpegPath });
    const aspect = report.capability.evidence.find((item) => item.dimension === 'requested_aspect_ratio');
    assert.equal(aspect?.status, 'pass');
    assert.match(String(aspect?.observed), /DAR 32:9/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('applies a 90-degree display matrix before checking the requested video ratio', async (t) => {
  if (!canRunFfmpeg) return t.skip('ffmpeg-static is unavailable');
  const fixture = await createVideoFixture();
  const childProcessModule = require('node:child_process');
  const originalSpawn = childProcessModule.spawn;
  childProcessModule.spawn = (command, args, options) => {
    const inputIndex = args.indexOf('-i');
    if (inputIndex < 0) throw new Error('FFmpeg input argument missing');
    return originalSpawn(command, [...args.slice(0, inputIndex), '-display_rotation', '90', ...args.slice(inputIndex)], options);
  };
  try {
    const report = await reviewVideoBuffer({ bytes: fixture.bytes, artifactRef: 'rotated-video', expectedAspectRatio: '9:16', ffmpegPath });
    const aspect = report.capability.evidence.find((item) => item.dimension === 'requested_aspect_ratio');
    const dimensions = report.capability.evidence.find((item) => item.dimension === 'video_dimensions');
    assert.equal(aspect?.status, 'pass');
    assert.equal(dimensions?.observed, '编码 320×180；显示 180×320');
    assert.match(String(aspect?.observed), /rotation 90°/);
  } finally {
    childProcessModule.spawn = originalSpawn;
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('leaves non-right-angle display rotations unknown', async (t) => {
  if (!canRunFfmpeg) return t.skip('ffmpeg-static is unavailable');
  const fixture = await createVideoFixture();
  const childProcessModule = require('node:child_process');
  const originalSpawn = childProcessModule.spawn;
  childProcessModule.spawn = (command, args, options) => {
    const inputIndex = args.indexOf('-i');
    if (inputIndex < 0) throw new Error('FFmpeg input argument missing');
    return originalSpawn(command, [...args.slice(0, inputIndex), '-display_rotation', '45', ...args.slice(inputIndex)], options);
  };
  try {
    const report = await reviewVideoBuffer({ bytes: fixture.bytes, artifactRef: 'diagonal-rotation', expectedAspectRatio: '16:9', ffmpegPath });
    const aspect = report.capability.evidence.find((item) => item.dimension === 'requested_aspect_ratio');
    assert.equal(aspect?.status, 'unknown');
    assert.match(String(aspect?.reason), /非直角显示旋转/);
  } finally {
    childProcessModule.spawn = originalSpawn;
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('does not follow a video file symlink outside the authorized storage root', async (t) => {
  if (!canRunFfmpeg) return t.skip('ffmpeg-static is unavailable');
  const fixture = await createVideoFixture();
  const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-creative-review-video-outside-'));
  try {
    const outside = path.join(outsideDirectory, 'outside.mp4');
    await writeFile(outside, fixture.bytes);
    try {
      await symlink(outside, path.join(fixture.directory, 'outside-link.mp4'));
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return t.skip('host does not permit creating a symlink for this test');
      throw error;
    }
    const report = await reviewStoredVideoArtifact({
      artifactRef: 'task-video-link',
      storedRef: '/api/storage/video?name=outside-link.mp4',
      storagePath: fixture.directory,
      ffmpegPath,
    });
    const access = report.capability.evidence.find((item) => item.dimension === 'local_artifact_access');
    assert.equal(access?.status, 'fail');
    assert.match(String(access?.reason), /目录之外|非普通文件|符号链接/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});

test('reviews only persisted local videos and refuses remote references', async (t) => {
  if (!canRunFfmpeg) return t.skip('ffmpeg-static is unavailable');
  const fixture = await createVideoFixture();
  try {
    const name = 'stored-output.mp4';
    await writeFile(path.join(fixture.directory, name), fixture.bytes);
    const report = await reviewStoredVideoArtifact({
      artifactRef: 'task-1:1', storedRef: '/api/storage/video?name=stored-output.mp4',
      storagePath: fixture.directory, expectedAspectRatio: '16:9', expectedDurationSeconds: 1, ffmpegPath,
    });
    assert.equal(report.artifactRef, 'task-1:1');
    assert.equal(report.capability.evidence.find((item) => item.dimension === 'video_decode')?.status, 'pass');
    assert.equal(report.safety.status, 'unknown');

    const remote = await reviewStoredVideoArtifact({
      artifactRef: 'task-1:remote', storedRef: 'https://example.invalid/video.mp4',
      storagePath: fixture.directory, ffmpegPath,
    });
    assert.equal(remote.capability.status, 'unknown');
    assert.match(remote.capability.evidence[0].reason, /不会.*远程 URL/);
    assert.equal(remote.safety.status, 'unknown');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('fails a corrupt video and reports unmet aspect and duration requirements', async (t) => {
  if (!canRunFfmpeg) return t.skip('ffmpeg-static is unavailable');
  const corruptReport = await reviewVideoBuffer({
    bytes: Buffer.from('not a video stream'),
    artifactRef: 'broken-video',
    ffmpegPath,
  });
  assert.equal(corruptReport.capability.evidence.find((item) => item.dimension === 'video_decode')?.status, 'fail');
  assert.equal(corruptReport.capability.status, 'fail');

  const fixture = await createVideoFixture();
  try {
    const report = await reviewVideoBuffer({
      bytes: fixture.bytes,
      artifactRef: 'video-artifact-2',
      expectedAspectRatio: '9:16',
      expectedDurationSeconds: 4,
      ffmpegPath,
    });
    assert.equal(report.capability.evidence.find((item) => item.dimension === 'video_decode')?.status, 'pass');
    assert.equal(report.capability.evidence.find((item) => item.dimension === 'requested_aspect_ratio')?.status, 'fail');
    assert.equal(report.capability.evidence.find((item) => item.dimension === 'requested_duration')?.status, 'fail');
    assert.equal(report.capability.status, 'fail');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('does not let concat manifests open local files through FFmpeg', async (t) => {
  if (!canRunFfmpeg) return t.skip('ffmpeg-static is unavailable');
  const fixture = await createVideoFixture();
  try {
    const playlist = Buffer.from(`ffconcat version 1.0\nfile ${pathToFileURL(path.join(fixture.directory, 'fixture.mp4')).href}\n`);
    const childProcessModule = require('node:child_process');
    const originalSpawn = childProcessModule.spawn;
    childProcessModule.spawn = (command, args, options) => {
      const inputIndex = args.indexOf('-i');
      if (inputIndex < 0) throw new Error('FFmpeg input argument missing');
      return originalSpawn(command, [...args.slice(0, inputIndex), '-f', 'concat', '-safe', '0', ...args.slice(inputIndex)], { ...options, cwd: fixture.directory });
    };
    try {
      const report = await reviewVideoBuffer({ bytes: playlist, artifactRef: 'playlist-input', ffmpegPath });
      const decode = report.capability.evidence.find((item) => item.dimension === 'video_decode');
      assert.equal(decode?.status, 'fail');
      assert.match(String(decode?.reason), /not on whitelist/i);
    } finally {
      childProcessModule.spawn = originalSpawn;
    }
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('does not turn an unavailable local decoder into a pass', async () => {
  const report = await reviewVideoBuffer({
    bytes: Buffer.from('opaque-but-authorized-bytes'),
    artifactRef: 'video-artifact-3',
    ffmpegPath: path.join(os.tmpdir(), 'sanmao-missing-ffmpeg-executable'),
  });
  assert.equal(report.capability.status, 'unknown');
  assert.equal(report.capability.evidence[0].dimension, 'video_decoder');
  assert.equal(report.capability.evidence[0].status, 'unknown');
});
