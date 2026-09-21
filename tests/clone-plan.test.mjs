import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/clone/plan.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const plan = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const cloneShot = (index, extra = {}) => ({
  index,
  start: index,
  end: index + 1,
  visual: '',
  line: '',
  prompt: '',
  status: 'pending',
  ...extra,
});

test('克隆参数收敛到默认值与安全上限', () => {
  const defaults = plan.normalizeCloneOptions({ brief: '  火锅店探店  ' });
  assert.equal(defaults.brief, '火锅店探店');
  assert.equal(defaults.maxShots, plan.CLONE_DEFAULT_MAX_SHOTS);
  assert.equal(defaults.maxSeconds, plan.CLONE_DEFAULT_MAX_SECONDS);
  assert.equal(defaults.aspect, '9:16');

  const clamped = plan.normalizeCloneOptions({ maxShots: 99, maxSeconds: 9999, aspect: '4:5' });
  assert.equal(clamped.maxShots, plan.CLONE_MAX_SHOTS);
  assert.equal(clamped.maxSeconds, plan.CLONE_MAX_SECONDS);
  assert.equal(clamped.aspect, '9:16');
  assert.equal(plan.normalizeCloneOptions({ maxShots: 0, maxSeconds: 0 }).maxShots, 1);
  assert.equal(plan.normalizeCloneOptions({ maxSeconds: 0 }).maxSeconds, plan.CLONE_MIN_SECONDS);
});

test('抽帧取每段中点，并且不超过最大帧数', () => {
  assert.deepEqual(plan.frameSampleTimes(10, 2, 10), [1, 3, 5, 7, 9]);
  assert.equal(plan.frameSampleTimes(600, 2, 10).length, 10);
  assert.deepEqual(plan.frameSampleTimes(0), [0]);
});

test('拆解结果归一化：别名字段、排序、越界裁剪与兜底', () => {
  const shots = plan.normalizeShots({
    shots: [
      { start: 6, end: 9, description: '结尾特写', image_prompt: '特写' },
      { startSeconds: 0, endSeconds: 3, visual: '开场全景' },
      { from: 3, to: 6, summary: '中段动作' },
    ],
  }, { durationSeconds: 10, maxShots: 8 });
  assert.deepEqual(shots.map((shot) => [shot.start, shot.end]), [[0, 3], [3, 6], [6, 9]]);
  assert.equal(shots[0].visual, '开场全景');
  assert.equal(shots[2].prompt, '特写');

  const overrun = plan.normalizeShots({ shots: [{ start: 8, end: 40 }] }, { durationSeconds: 10, maxShots: 4 });
  assert.deepEqual(overrun.map((shot) => [shot.start, shot.end]), [[8, 10]]);

  const fallback = plan.normalizeShots('模型返回了一堆废话', { durationSeconds: 12, maxShots: 4 });
  assert.equal(fallback.length, 4);
  assert.deepEqual(fallback.map((shot) => [shot.start, shot.end]), [[0, 3], [3, 6], [6, 9], [9, 12]]);

  const capped = plan.normalizeShots({ shots: Array.from({ length: 20 }, (_, index) => ({ start: index * 2, end: index * 2 + 2 })) }, { durationSeconds: 60, maxShots: 8 });
  assert.equal(capped.length, 8);
});

test('一句一镜：镜头多则尾部合并，句子多则接到最后一镜', () => {
  const shots = plan.normalizeShots({ shots: [{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 6 }] }, { durationSeconds: 6, maxShots: 6 });
  const merged = plan.alignShotsWithLines(shots, ['第一句', '第二句']);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].line, '第二句');
  assert.equal(merged[1].end, 6);

  const extended = plan.alignShotsWithLines(shots, ['第一句', '第二句', '第三句', '第四句']);
  assert.equal(extended.length, 3);
  assert.equal(extended[2].line, '第三句 第四句');
});

test('文案切句按标点与列表前缀整理', () => {
  assert.deepEqual(plan.splitLines('1. 第一句。2. 第二句！'), ['第一句。', '第二句！']);
  assert.deepEqual(plan.splitLines('\n\n  - 只有一句 \n'), ['只有一句']);
  assert.deepEqual(plan.splitLines('   '), []);
});

test('没有配音时按字数估时长，有配音时以真实时长为准', () => {
  assert.equal(plan.estimateLineSeconds('四字文案'), 0.889);
  assert.equal(plan.estimateLineSeconds(''), plan.CLONE_MIN_SHOT_SECONDS);
  assert.equal(plan.countVisibleChars('一 二\n三'), 3);

  const shots = [cloneShot(0, { line: '几个字的文案', audioSeconds: 2.4 }), cloneShot(1, { line: '四句文案' })];
  assert.deepEqual(plan.shotDurations(shots), [2.4, 0.889]);
});

test('时间轴按视频/配音/字幕三轨排布，字幕一句一屏', () => {
  const shots = [
    cloneShot(0, { line: '第一句文案', audioSeconds: 2.5, videoUrl: '/api/storage/video?name=a.mp4', audioUrl: '/api/storage/audio?name=a.mp3' }),
    cloneShot(1, { line: '第二句文案', imageUrl: '/api/storage/file?name=b.png' }),
  ];
  const timeline = plan.buildTimeline(shots, plan.normalizeCloneOptions({ aspect: '9:16' }));
  assert.equal(timeline.fps, 30);
  assert.equal(timeline.aspect, '9:16');
  assert.deepEqual(timeline.clips.filter((clip) => clip.track === 'video').map((clip) => [clip.id, clip.type, clip.start, clip.duration]), [
    ['clone-video-0', 'video', 0, 2.5],
    ['clone-video-1', 'image', 2.5, 1.111],
  ]);
  assert.deepEqual(timeline.clips.filter((clip) => clip.track === 'audio').map((clip) => [clip.id, clip.start, clip.duration]), [['clone-audio-0', 0, 2.5]]);
  const captions = timeline.clips.filter((clip) => clip.track === 'caption');
  assert.deepEqual(captions.map((clip) => [clip.text, clip.start, clip.duration, clip.fontSize]), [
    ['第一句文案', 0, 2.5, plan.CLONE_CAPTION_FONT_SIZE],
    ['第二句文案', 2.5, 1.111, plan.CLONE_CAPTION_FONT_SIZE],
  ]);
  assert.equal(timeline.duration, 3.611);
  assert.equal(captions[0].captionBackgroundOpacity, plan.CLONE_CAPTION_BACKGROUND_OPACITY);
});

test('三条降级链都给出明确提示', () => {
  const none = plan.decideCapabilities({ hasVisionModel: false, hasSpeechModel: false, hasImageModel: false, hasVideoModel: false });
  assert.equal(none.capabilities.vision, false);
  assert.equal(none.warnings.length, 4);
  assert.match(none.warnings.join(' '), /视觉/);
  assert.match(none.warnings.join(' '), /无声 \+ 字幕/);
  assert.match(none.warnings.join(' '), /生图/);
  assert.match(none.warnings.join(' '), /静态图/);

  const full = plan.decideCapabilities({ hasVisionModel: true, hasSpeechModel: true, hasImageModel: true, hasVideoModel: true });
  assert.deepEqual(full.warnings, []);
  assert.deepEqual(full.capabilities, { vision: true, speech: true, offlineSpeech: false, image: true, video: true, referenceImages: false, firstFrame: false, referenceAudio: false });
});

test('没有在线配音模型时用本机离线配音兜底，有在线模型时不抢戏', () => {
  const offline = plan.decideCapabilities({ hasVisionModel: true, hasSpeechModel: false, hasImageModel: true, hasVideoModel: true, offlineSpeech: true });
  assert.equal(offline.capabilities.speech, true);
  assert.equal(offline.capabilities.offlineSpeech, true);
  assert.deepEqual(offline.warnings, ['没有在线的配音模型：本次改用「本机离线配音」出声（免费、离线、不需联网，音色偏机械）。']);

  const online = plan.decideCapabilities({ hasVisionModel: true, hasSpeechModel: true, hasImageModel: true, hasVideoModel: true, offlineSpeech: true });
  assert.equal(online.capabilities.offlineSpeech, false);
  assert.deepEqual(online.warnings, []);

  // 平台不支持（macOS / Linux）时维持原来的「无声 + 字幕」提示。
  const unsupported = plan.decideCapabilities({ hasVisionModel: true, hasSpeechModel: false, hasImageModel: true, hasVideoModel: true, offlineSpeech: false });
  assert.equal(unsupported.capabilities.offlineSpeech, false);
  assert.match(unsupported.warnings.join(' '), /无声 \+ 字幕/);
});

test('弹窗能力预判与服务端判据一致', () => {
  const flags = plan.cloneCapabilityFlags([
    { kind: 'chat', enabled: true, published: true, capabilities: ['chat', 'vision'] },
    { kind: 'image', enabled: true, published: true, capabilities: ['generate'] },
    { kind: 'video', enabled: false, published: true, capabilities: ['video-generate'] },
    { kind: 'audio', enabled: true, published: false, capabilities: ['speech'] },
  ]);
  assert.deepEqual(flags, { hasChatModel: true, hasVisionModel: true, hasSpeechModel: false, hasImageModel: true, hasVideoModel: false });
  assert.deepEqual(plan.cloneCapabilityFlags([]), { hasChatModel: false, hasVisionModel: false, hasSpeechModel: false, hasImageModel: false, hasVideoModel: false });
  // 有对话模型但没有视觉：能写文案、拆不了画面，两件事要分开告诉用户。
  const textOnly = plan.cloneCapabilityFlags([{ kind: 'chat', enabled: true, published: true, capabilities: ['chat'] }]);
  assert.equal(textOnly.hasChatModel, true);
  assert.equal(textOnly.hasVisionModel, false);
});

test('没有对话模型时不塌缩镜头，时长退回参考节奏', () => {
  const shots = plan.normalizeShots({ shots: [{ start: 0, end: 3 }, { start: 3, end: 9 }] }, { durationSeconds: 9, maxShots: 4 });
  const kept = plan.alignShotsWithLines(shots, []);
  // 一句文案都没有时保留全部镜头（只是没字幕），而不是塌成 1 个镜头。
  assert.equal(kept.length, 2);
  assert.deepEqual(kept.map((shot) => shot.line), ['', '']);
  assert.deepEqual(kept.map((shot) => [shot.start, shot.end]), [[0, 3], [3, 9]]);
  // 没有文案也没有配音时，用参考视频这一段本身的时长兜底，而不是每镜都塌成 0.8 秒。
  assert.deepEqual(plan.shotDurations(kept), [3, 6]);
});

test('镜头时长夹到视频模型允许的档位', () => {
  // Agnes Video 2.5 只接受 4–12 秒：不能把 2 秒的短句直接丢过去。
  const agnes = { minSeconds: 4, maxSeconds: 12, allowedSeconds: Array.from({ length: 9 }, (_, i) => i + 4) };
  assert.equal(plan.clampShotSeconds(2, agnes), 4);
  assert.equal(plan.clampShotSeconds(7, agnes), 7);
  assert.equal(plan.clampShotSeconds(99, agnes), 12);
  assert.equal(plan.clampShotSeconds(0, agnes), 4);
  assert.equal(plan.clampShotSeconds(NaN, agnes), 4);
  // 固定时长模型（如 Veo Omni）忽略配音长度。
  assert.equal(plan.clampShotSeconds(9, { minSeconds: 8, maxSeconds: 8, fixedSeconds: 8 }), 8);
  assert.equal(plan.clampShotSeconds(9, { minSeconds: 8, maxSeconds: 8 }), 8);
  // 没有限制时保持旧的保守行为（2–10 秒）。
  assert.equal(plan.clampShotSeconds(1, {}), 2);
  assert.equal(plan.clampShotSeconds(30, {}), 10);
  assert.equal(plan.clampShotSeconds(4.4, {}), 4);
});

test('从 ffmpeg stderr 解析媒体时长', () => {
  assert.equal(plan.parseFfmpegDuration('  Duration: 00:00:12.34, start: 0.000000, bitrate: 920 kb/s'), 12.34);
  assert.equal(plan.parseFfmpegDuration('Duration: 01:02:03.50'), 3723.5);
  assert.equal(plan.parseFfmpegDuration('没有时长信息'), null);
});

test('中断判定只认非终态且久无心跳的任务', () => {
  const now = Date.parse('2026-09-19T12:00:00.000Z');
  const stamp = (offsetMs) => new Date(now + offsetMs).toISOString();
  assert.equal(plan.isCloneJobStale({ stage: 'imaging', updatedAt: stamp(-plan.CLONE_STALE_JOB_MS - 1) }, now), true);
  assert.equal(plan.isCloneJobStale({ stage: 'rendering', updatedAt: stamp(-60_000) }, now), false, '正常心跳不能被误判');
  assert.equal(plan.isCloneJobStale({ stage: 'rendering', updatedAt: stamp(-1) }, now), false);
  for (const stage of ['done', 'failed', 'cancelled']) {
    assert.equal(plan.isCloneJobStale({ stage, updatedAt: stamp(-plan.CLONE_STALE_JOB_MS * 10) }, now), false, stage + ' 是终态');
  }
  assert.equal(plan.isCloneJobStale({ stage: 'queued' }, now), false, '没有时间戳时不做判断');
  assert.equal(plan.isCloneJobStale({ stage: 'queued', updatedAt: '不是时间' }, now), false);
});
test('阶段进度与说明覆盖全部阶段', () => {
  for (const stage of ['queued', 'analyzing', 'scripting', 'voicing', 'imaging', 'rendering', 'assembling', 'done', 'failed', 'cancelled']) {
    assert.equal(typeof plan.cloneStageProgress(stage), 'number');
    assert.ok(plan.describeCloneStage(stage).length > 0, stage);
  }
  assert.equal(plan.cloneStageProgress('done'), 1);
});
