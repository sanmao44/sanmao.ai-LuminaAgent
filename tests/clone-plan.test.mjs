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

test('参考视频切点会优先进入抽帧，并能生成稳定的镜头边界', () => {
  assert.deepEqual(plan.parseSceneChangeTimes('pts_time:0.98 pts_time:1.000 pts_time:2.50', 3, 8), [0.98, 1, 2.5]);
  assert.deepEqual(plan.referenceFrameSampleTimes(3, [1, 2], 8), [0.5, 0.88, 1.12, 1.5, 1.88, 2.12, 2.5]);
  assert.deepEqual(plan.shotsFromSceneChanges(3, [1, 2], 8).map((shot) => [shot.start, shot.end]), [[0, 1], [1, 2], [2, 3]]);
  const snapped = plan.snapShotBoundariesToSceneChanges([
    { start: 0, end: 1.2 },
    { start: 1.2, end: 3 },
  ], [1]);
  assert.deepEqual(snapped.map((shot) => [shot.start, shot.end]), [[0, 1], [1, 3]]);
});

test('拆解结果归一化：别名字段、排序、越界裁剪与兜底', () => {
  const shots = plan.normalizeShots({
    shots: [
      { start: 6, end: 9, description: '结尾特写', image_prompt: '特写' },
      { startSeconds: 0, endSeconds: 3, visual: '开场全景' },
      { from: 3, to: 6, summary: '中段动作' },
    ],
  }, { durationSeconds: 10, maxShots: 8 });
  assert.deepEqual(shots.map((shot) => [shot.start, shot.end]), [[0, 3], [3, 6], [6, 9], [9, 10]]);
  assert.equal(shots[3].referenceGap, true);
  assert.equal(shots[0].visual, '开场全景');
  assert.equal(shots[2].prompt, '特写');

  const overrun = plan.normalizeShots({ shots: [{ start: 8, end: 40 }] }, { durationSeconds: 10, maxShots: 4 });
  assert.deepEqual(overrun.map((shot) => [shot.start, shot.end]), [[0, 8], [8, 10]]);
  assert.equal(overrun[0].referenceGap, true);

  const fallback = plan.normalizeShots('模型返回了一堆废话', { durationSeconds: 12, maxShots: 4 });
  assert.equal(fallback.length, 4);
  assert.deepEqual(fallback.map((shot) => [shot.start, shot.end]), [[0, 3], [3, 6], [6, 9], [9, 12]]);

  const capped = plan.normalizeShots({ shots: Array.from({ length: 20 }, (_, index) => ({ start: index * 2, end: index * 2 + 2 })) }, { durationSeconds: 60, maxShots: 8 });
  assert.equal(capped.length, 8);
});

test('structured graphics and transition fields survive shot normalization', () => {
  const shots = plan.normalizeShots({ shots: [{
    start: 0,
    end: 2,
    visual: 'brand card',
    analysis: {
      graphicsText: 'SANMAO',
      graphicsPosition: 'top-center',
      graphicsStyle: 'outlined text',
      graphicsBounds: { x: 0.12, y: 0.08, width: 0.64, height: 0.11 },
      transitionType: 'dissolve',
      transitionDuration: 0.42,
      motionPath: 'left to right',
    },
  }] }, { durationSeconds: 2, maxShots: 4 });
  assert.equal(shots[0].analysis.graphicsText, 'SANMAO');
  assert.equal(shots[0].analysis.graphicsPosition, 'top-center');
  assert.deepEqual(shots[0].analysis.graphicsBounds, { x: 0.12, y: 0.08, width: 0.64, height: 0.11 });
  assert.equal(shots[0].analysis.transitionType, 'dissolve');
  assert.equal(shots[0].analysis.transitionDuration, 0.42);
  assert.equal(shots[0].analysis.motionPath, 'left to right');
});

test('legacy full-shot graphics remain when a separate event has no text', () => {
  const timeline = plan.buildTimeline([
    cloneShot(0, {
      start: 0,
      end: 2,
      line: 'narration',
      analysis: {
        graphicsText: 'legacy title',
        events: [{ kind: 'broll', start: 0.4, end: 1.2, prompt: 'product insert' }],
      },
    }),
  ], plan.normalizeCloneOptions({}));
  assert.equal(timeline.clips.find((clip) => clip.track === 'graphics')?.text, 'legacy title');
  assert.equal(timeline.tracks.find((track) => track.kind === 'broll')?.clips[0]?.text, 'product insert');
});

test('视觉系统镜头保留原片动态，普通小字卡仍允许替换主体', () => {
  assert.equal(plan.shouldPreserveReferenceFrameAnalysis({ role: 'graphic' }), true);
  assert.equal(plan.shouldPreserveReferenceFrameAnalysis({ layout: { mode: 'picture-in-picture' } }), true);
  assert.equal(plan.shouldPreserveReferenceFrameAnalysis({ transitionType: 'wipe' }), true);
  assert.equal(plan.shouldPreserveReferenceFrameAnalysis({ graphicsText: '价格', graphicsBounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.6 } }), true);
  assert.equal(plan.shouldPreserveReferenceFrameAnalysis({ graphicsText: '产品名', graphicsBounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.08 } }), false);
  assert.equal(plan.shouldPreserveReferenceFrameAnalysis({ graphicsText: '标题', composition: '人物近景' }), false);
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

test('参考时间线结构不会因为文案句数不足而丢镜头或丢时间段', () => {
  const shots = plan.normalizeShots({ shots: [
    { start: 0, end: 2, visual: '开场' },
    { start: 2, end: 4, visual: '卡片' },
    { start: 4, end: 6, visual: '结尾' },
  ] }, { durationSeconds: 6, maxShots: 6 });
  const aligned = plan.alignShotsWithLines(shots, ['第一句', '第二句'], { preserveShotStructure: true });
  assert.equal(aligned.length, 3);
  assert.deepEqual(aligned.map((shot) => [shot.start, shot.end]), [[0, 2], [2, 4], [4, 6]]);
  assert.deepEqual(aligned.map((shot) => shot.line), ['第一句', '第二句', '']);

  const withGap = plan.normalizeShots({ shots: [{ start: 1.5, end: 3 }] }, { durationSeconds: 5, maxShots: 6 });
  assert.deepEqual(withGap.map((shot) => [shot.start, shot.end]), [[0, 1.5], [1.5, 3], [3, 5]]);
  assert.equal(withGap[0].referenceGap, true);
});

test('默认保留参考镜头节奏，旁白过长只延展不压缩', () => {
  const options = plan.normalizeCloneOptions({});
  assert.equal(options.preserveReferenceTiming, true);
  assert.equal(options.preserveReferenceAudio, true);
  const shots = [cloneShot(0, { start: 0, end: 3, line: '短句', audioSeconds: 1 }), cloneShot(1, { start: 3, end: 5, line: '长句', audioSeconds: 4 })];
  assert.deepEqual(plan.shotDurations(shots, options), [3, 4]);
  assert.deepEqual(plan.shotDurations(shots, { preserveReferenceTiming: false }), [1, 4]);
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
  assert.deepEqual(timeline.tracks.map((track) => [track.kind, track.clips.length]), [
    ['video', 2],
    ['reference-audio', 1],
    ['voice', 1],
    ['caption', 2],
  ]);
  assert.deepEqual(timeline.tracks.find((track) => track.kind === 'reference-audio')?.clips[0], {
    id: 'clone-reference-audio-global',
    shotIndex: 0,
    start: 0,
    duration: 3.611,
    source: 'reference-video',
    sourceOffset: 0,
    volume: 0.35,
  });
  assert.equal(timeline.tracks.find((track) => track.kind === 'video').clips[0].source, 'generated-media');
});

test('word-level ASR timing enters caption clips and degrades deterministically without ASR', () => {
  const transcript = {
    text: '甲乙丙丁',
    model: 'test',
    words: [
      { start: 0.5, end: 1, text: '参考' },
      { start: 1, end: 1.5, text: '节奏' },
    ],
    segments: [],
  };
  const timed = plan.buildTimeline([
    cloneShot(0, { start: 0, end: 2, line: '甲乙丙丁' }),
  ], plan.normalizeCloneOptions({}), transcript);
  const clip = timed.clips.find((item) => item.track === 'caption');
  assert.deepEqual(clip?.words?.map(({ start, end, text }) => ({ start, end, text })), [
    { start: 0.5, end: 0.75, text: '甲' },
    { start: 0.75, end: 1, text: '乙' },
    { start: 1, end: 1.25, text: '丙' },
    { start: 1.25, end: 1.5, text: '丁' },
  ]);
  const fallback = plan.captionWordsForShot('甲乙', { start: 0, end: 2 }, 2);
  assert.deepEqual(fallback.map(({ start, end, text }) => ({ start, end, text })), [
    { start: 0, end: 1, text: '甲' },
    { start: 1, end: 2, text: '乙' },
  ]);
});

test('structured graphics text enters its own semantic and canvas graphics track', () => {
  const timeline = plan.buildTimeline([
    cloneShot(0, { line: 'narration', analysis: { graphicsText: 'screen title', graphicsStyle: 'card' } }),
  ], plan.normalizeCloneOptions({}));
  assert.equal(timeline.clips.find((clip) => clip.track === 'graphics')?.text, 'screen title');
  assert.equal(timeline.clips.find((clip) => clip.track === 'graphics')?.graphicsStyle, 'card');
  assert.equal(timeline.tracks.find((track) => track.kind === 'graphics')?.clips[0]?.text, 'screen title');
  assert.equal(timeline.tracks.find((track) => track.kind === 'graphics')?.clips[0]?.graphicsStyle, 'card');
});

test('visual events stay inside the shot and compile into independent timed tracks', () => {
  const shots = plan.normalizeShots({ shots: [{
    start: 2,
    end: 5,
    visual: 'host with timed card',
    analysis: {
      events: [
        { id: 'title', kind: 'graphics', start: 0.4, end: 1.6, text: 'title', style: 'card' },
        { id: 'broll', kind: 'broll', start: 1.5, end: 9, prompt: 'product close-up' },
        { id: 'invalid', kind: 'graphics', start: 2, end: 2.01, text: 'too short' },
      ],
    },
  }] }, { durationSeconds: 5, maxShots: 4 });
  const semanticShot = shots.find((shot) => shot.analysis?.events);
  assert.ok(semanticShot);
  assert.deepEqual(semanticShot.analysis.events.map((event) => [event.id, event.start, event.end]), [
    ['title', 0.4, 1.6],
    ['broll', 1.5, 3],
    ['invalid', 2, 2.05],
  ]);
  const timeline = plan.buildTimeline(shots.map((shot, index) => ({ ...shot, index, line: '', status: 'pending' })), plan.normalizeCloneOptions({}));
  const graphics = timeline.tracks.find((track) => track.kind === 'graphics')?.clips || [];
  assert.deepEqual(graphics.map((clip) => [clip.eventId, clip.start, clip.duration, clip.text]), [
    ['title', 2.4, 1.2, 'title'],
    ['invalid', 4, 0.05, 'too short'],
  ]);
  const broll = timeline.tracks.find((track) => track.kind === 'broll')?.clips || [];
  assert.deepEqual(broll.map((clip) => [clip.eventId, clip.start, clip.duration, clip.text]), [['broll', 3.5, 1.5, 'product close-up']]);
});

test('repeated visual structures become reusable Blueprint components and clip instances', () => {
  const shots = [
    cloneShot(0, { line: '甲', preserveReferenceFrame: true, analysis: { role: 'graphic', layout: { mode: 'card', primary: { x: 0.06, y: 0.06, width: 0.88, height: 0.88 } } } }),
    cloneShot(1, { line: '乙', preserveReferenceFrame: true, analysis: { role: 'graphic', layout: { mode: 'card', primary: { x: 0.06, y: 0.06, width: 0.88, height: 0.88 } } } }),
    cloneShot(2, { imageUrl: '/api/storage/file?name=scene.png', analysis: { role: 'broll', motion: 'zoom in' } }),
  ];
  const components = plan.buildBlueprintComponents(shots);
  assert.equal(components.length, 2);
  assert.deepEqual(components[0].shotIndexes, [0, 1]);
  const timeline = plan.buildTimeline(shots, plan.normalizeCloneOptions({}));
  assert.equal(timeline.components?.[0].id, components[0].id);
  assert.equal(timeline.clips.find((clip) => clip.id === 'clone-video-0')?.componentId, components[0].id);
  assert.equal(timeline.tracks.find((track) => track.kind === 'video')?.clips[1].componentId, components[0].id);
  assert.equal(timeline.tracks.find((track) => track.kind === 'caption')?.clips[0].componentId, components[0].id, 'semantic text tracks keep the component link');
});

test('Blueprint variants override component instances while reusing unaffected media', () => {
  const shots = [
    cloneShot(0, { visual: 'host', line: '原文一', prompt: 'host close-up', videoUrl: '/host.mp4', audioUrl: '/voice-0.wav', analysis: { role: 'performance', motionPath: 'zoom in' } }),
    cloneShot(1, { visual: 'card', line: '原文二', prompt: 'card', imageUrl: '/card.png', audioUrl: '/voice-1.wav', preserveReferenceFrame: true, analysis: { role: 'graphic', layout: { mode: 'card' } } }),
    cloneShot(2, { visual: 'host', line: '原文三', prompt: 'host close-up', videoUrl: '/host-2.mp4', audioUrl: '/voice-2.wav', analysis: { role: 'performance', motionPath: 'zoom in' } }),
  ];
  const blueprint = {
    version: 1,
    sourceVideo: { name: 'ref.mp4', url: '/ref.mp4', seconds: 3 },
    assets: [],
    shots,
    components: plan.buildBlueprintComponents(shots),
    createdAt: 'now',
    updatedAt: 'now',
  };
  const performance = blueprint.components.find((component) => component.role === 'performance');
  const variant = plan.buildBlueprintVariantPlan(blueprint, {
    id: 'cta-blue',
    name: '蓝色 CTA',
    overrides: [{ componentId: performance.id, line: '统一新文案', graphicsStyle: 'blue-card' }],
  }, plan.normalizeCloneOptions({ aspect: '9:16' }));
  assert.deepEqual(variant.shots.map((shot) => shot.line), ['统一新文案', '原文二', '统一新文案']);
  assert.deepEqual(variant.generationShotIndexes, []);
  assert.deepEqual(variant.voiceShotIndexes, [0, 2]);
  assert.deepEqual(variant.reusedShotIndexes, [0, 1, 2]);
  assert.equal(variant.timeline.components.length, 2);
});

test('Blueprint variants mark only changed visual components for regeneration', () => {
  const shots = [
    cloneShot(0, { visual: 'product', prompt: 'old product', imageUrl: '/old.png', preserveReferenceFrame: true, analysis: { role: 'product' } }),
    cloneShot(1, { visual: 'host', prompt: 'host', videoUrl: '/host.mp4', analysis: { role: 'performance' } }),
  ];
  const blueprint = {
    version: 1,
    sourceVideo: { name: 'ref.mp4', url: '/ref.mp4', seconds: 2 },
    assets: [],
    shots,
    components: plan.buildBlueprintComponents(shots),
    createdAt: 'now',
    updatedAt: 'now',
  };
  const product = blueprint.components.find((component) => component.role === 'product');
  const variant = plan.buildBlueprintVariantPlan(blueprint, {
    id: 'new-product',
    name: '新产品',
    overrides: [{ componentId: product.id, prompt: 'new product hero', regenerate: true }],
  }, plan.normalizeCloneOptions({}));
  assert.deepEqual(variant.generationShotIndexes, [0]);
  assert.deepEqual(variant.reusedShotIndexes, [1]);
  assert.equal(variant.shots[0].preserveReferenceFrame, false);
  assert.equal(variant.shots[1].videoUrl, '/host.mp4');
});

test('Blueprint variants can overlay preserved reference shots and clear stale voice media', () => {
  const shots = [
    cloneShot(0, {
      line: 'old caption',
      audioUrl: '/old-voice.wav',
      audioSeconds: 1.2,
      preserveReferenceFrame: true,
      referenceFrameUrl: '/reference-frame.jpg',
      analysis: { role: 'graphic' },
    }),
  ];
  const blueprint = {
    version: 1,
    sourceVideo: { name: 'ref.mp4', url: '/ref.mp4', seconds: 1 },
    assets: [],
    shots,
    components: plan.buildBlueprintComponents(shots),
    createdAt: 'now',
    updatedAt: 'now',
  };
  const variant = plan.buildBlueprintVariantPlan(blueprint, {
    id: 'overlay',
    name: 'overlay',
    overrides: [{
      componentId: blueprint.components[0].id,
      line: '',
      graphicsText: 'new card',
      allowReferenceOverlays: true,
    }],
  }, plan.normalizeCloneOptions({}));
  assert.equal(variant.shots[0].line, '');
  assert.equal(variant.shots[0].audioUrl, undefined);
  assert.equal(variant.shots[0].audioSeconds, undefined);
  assert.equal(variant.shots[0].allowReferenceOverlays, true);
  assert.deepEqual(variant.generationShotIndexes, []);
  assert.deepEqual(variant.voiceShotIndexes, []);
  assert.equal(variant.timeline.clips.find((clip) => clip.track === 'graphics')?.text, 'new card');
});

test('structured graphics position enters the editable caption transform', () => {
  const timeline = plan.buildTimeline([
    cloneShot(0, { line: 'narration', analysis: { graphicsText: 'screen title', graphicsPosition: 'top-right' } }),
  ], plan.normalizeCloneOptions({}));
  const graphics = timeline.clips.find((clip) => clip.track === 'graphics');
  assert.equal(graphics?.x, 0.72);
  assert.equal(graphics?.y, 1);
});

test('鏡頭方向會把參考結構編譯成統一的生成提示', () => {
  const direction = plan.cloneShotDirection({
    visual: '主持人拿起產品',
    line: '展示產品',
    prompt: '自然產品展示',
    analysis: {
      camera: '中近景，正面視角',
      composition: '主體位於畫面中央，右側留白',
      motion: '緩慢推近',
      visualStyle: '柔和暖色，生活方式广告',
      layout: { mode: 'picture-in-picture', primary: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } },
      graphicsText: '新品上市',
    },
  }, '厨房用品');
  assert.match(direction, /相机|机位/u);
  assert.match(direction, /构图/u);
  assert.match(direction, /运动/u);
  assert.match(direction, /视觉风格/u);
  assert.match(direction, /picture-in-picture/u);
  assert.match(direction, /后期|文字/u);
  assert.match(direction, /保持参考镜头/u);
});

test('visual bible enters every generated shot direction', () => {
  const direction = plan.cloneShotDirection({
    visual: 'product close-up',
    line: 'show the product',
    prompt: 'natural product demo',
    analysis: {},
  }, '', {
    subjectIdentity: 'same presenter and wardrobe',
    productIdentity: 'same package shape and logo placement',
    palette: 'warm cream and muted green',
    continuityRules: 'keep the same visual identity across cuts',
    negativeConstraints: 'no extra watermark',
  });
  assert.match(direction, /same presenter and wardrobe/u);
  assert.match(direction, /same package shape/u);
  assert.match(direction, /warm cream/u);
  assert.match(direction, /same visual identity/u);
  assert.match(direction, /no extra watermark/u);
});

test('generated voice word alignment takes precedence over reference transcript timing', () => {
  const words = plan.captionWordsForShot('one two three', {
    start: 10,
    end: 13,
    audioWords: [
      { start: 0.1, end: 0.35, text: 'one' },
      { start: 0.7, end: 1.05, text: 'two' },
      { start: 1.4, end: 1.8, text: 'three' },
    ],
  }, 2, {
    text: 'old words',
    segments: [],
    words: [{ start: 10, end: 12.9, text: 'old words' }],
    model: 'reference',
  });
  assert.deepEqual(words.map((word) => [word.text, word.start, word.end]), [
    ['one ', 0.1, 0.35],
    ['two ', 0.7, 1.05],
    ['three', 1.4, 1.8],
  ]);
});

test('structured graphics bounds enter the editable card geometry', () => {
  const timeline = plan.buildTimeline([
    cloneShot(0, { line: 'narration', analysis: { graphicsText: 'screen title', graphicsBounds: { x: 0.12, y: 0.08, width: 0.64, height: 0.11 } } }),
  ], plan.normalizeCloneOptions({}));
  const graphics = timeline.clips.find((clip) => clip.track === 'graphics');
  assert.deepEqual(graphics?.textBox, { x: 0.12, y: 0.08, width: 0.64, height: 0.11 });
  assert.deepEqual(timeline.tracks.find((track) => track.kind === 'graphics')?.clips[0]?.textBox, { x: 0.12, y: 0.08, width: 0.64, height: 0.11 });
});

test('structured transitions enter editable video clips with direction and duration', () => {
  const timeline = plan.buildTimeline([
    cloneShot(0, { line: 'first', videoUrl: '/api/storage/video?name=a.mp4' }),
    cloneShot(1, { line: 'second', videoUrl: '/api/storage/video?name=b.mp4', analysis: { transitionType: 'wipe', transitionDuration: 0.6, transition: 'wipe right' } }),
  ], plan.normalizeCloneOptions({}));
  const clip = timeline.clips.find((item) => item.id === 'clone-video-1');
  assert.equal(clip?.transitionIn, 'wipe');
  assert.equal(clip?.transitionDuration, 0.6);
  assert.equal(clip?.transitionDirection, 'right');
  assert.equal(timeline.tracks.find((track) => track.kind === 'video')?.clips[1]?.transitionIn, 'wipe');
});

test('reference motion enters the editable clip as a normalized path', () => {
  const timeline = plan.buildTimeline([
    cloneShot(0, { line: 'push', videoUrl: '/api/storage/video?name=a.mp4', analysis: { motionPath: 'slow push in' } }),
  ], plan.normalizeCloneOptions({}));
  assert.equal(timeline.clips.find((item) => item.track === 'video')?.motionPath, 'zoom-in');
});

test('explicit composition becomes a bounded editable layout', () => {
  const timeline = plan.buildTimeline([
    cloneShot(0, { line: '', imageUrl: '/api/storage/file?name=scene.png', analysis: {
      composition: 'card layout',
      layout: {
        mode: 'card',
        backgroundColor: '#101014',
        padding: 0.06,
        radius: 0.06,
        primary: { x: 0.06, y: 0.06, width: 0.88, height: 0.88, radius: 0.06 },
      },
    } }),
  ], plan.normalizeCloneOptions({}));
  const video = timeline.clips.find((clip) => clip.track === 'video');
  assert.equal(video?.layout?.mode, 'card');
  assert.deepEqual(timeline.tracks.find((track) => track.kind === 'video')?.clips[0]?.layout?.primary, {
    x: 0.06, y: 0.06, width: 0.88, height: 0.88, radius: 0.06,
  });
});

test('图形/转场镜头没有生成素材时仍绑定原参考视频轨道', () => {
  const timeline = plan.buildTimeline([
    cloneShot(0, { start: 0.5, end: 2, preserveReferenceFrame: true }),
    cloneShot(1, { start: 2, end: 3, imageUrl: '/api/storage/file?name=scene.png' }),
  ], plan.normalizeCloneOptions({ aspect: '16:9' }));
  const clips = timeline.clips.filter((clip) => clip.track === 'video');
  assert.deepEqual(clips.map((clip) => [clip.type, clip.sourceOffset]), [['video', 0.5], ['image', 0]]);
  const videoTrack = timeline.tracks.find((track) => track.kind === 'video');
  assert.equal(videoTrack.clips[0].source, 'reference-video');
  assert.equal(videoTrack.clips[1].source, 'generated-media');
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
