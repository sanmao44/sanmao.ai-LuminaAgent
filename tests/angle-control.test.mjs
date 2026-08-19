import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/angle-control.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const angle = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function camera(values = {}) {
  return angle.normalizeAngleState({
    yaw: 0,
    pitch: 0,
    roll: 0,
    focal: 50,
    distance: 2.2,
    frameX: 0,
    frameY: 0,
    ...values,
  });
}

test('uses current yaw directly in the concise Chinese prompt', () => {
  const target = camera({ yaw: 51.6, pitch: 22.1, focal: 62, distance: 0.9, frameX: 2.1, frameY: -47.7 });
  const prompt = angle.compileAngleTargetPrompt('', target, {
    hasGuideReference: true,
    output: { width: 720, height: 1280, aspectRatio: '9:16' },
  });
  assert.equal(angle.relativeViewYaw(target), 51.6);
  assert.equal(angle.angleName(target.yaw), '右前');
  assert.match(prompt, /图1作为人物、场景和光照的唯一视觉参考/);
  assert.match(prompt, /图2是水平的灰模机位\/构图导引/);
  assert.match(prompt, /人物右前方约51\.6°/);
  assert.match(prompt, /低机位仰拍约22\.1°/);
  assert.match(prompt, /约62mm镜头/);
  assert.match(prompt, /约0\.9×距离/);
  assert.match(prompt, /人物和整个场景都必须按目标机位重建/);
  assert.match(prompt, /前景、中景、背景的透视、可见面、相对位移与遮挡关系/);
  assert.match(prompt, /禁止复用图1的二维投影、整图旋转、只改裁切/);
  assert.match(prompt, /镜头变化优先于逐像素身份稳定/);
  assert.match(prompt, /脸部、胸腔和肩部要呈明显右侧前遮挡关系/);
  assert.match(prompt, /不得保留原图正面平铺轮廓/);
  assert.doesNotMatch(prompt, /-16\.4°|subject-relative|RECONSTRUCTION|IMAGE 1|IMAGE 2/);
});

test('classifies direct, three-quarter, side and rear views on both sides', () => {
  assert.deepEqual([
    angle.angleName(0),
    angle.angleName(30),
    angle.angleName(60),
    angle.angleName(90),
    angle.angleName(180),
    angle.angleName(-30),
    angle.angleName(-60),
    angle.angleName(-90),
  ], ['正面', '右前', '右前', '右侧', '背面', '左前', '左前', '左侧']);

  assert.match(angle.compileAngleTargetPrompt('', camera({ yaw: 0 })), /人物正前方、平视机位/);
  assert.match(angle.compileAngleTargetPrompt('', camera({ yaw: 60 })), /人物右前方约60°/);
  assert.match(angle.compileAngleTargetPrompt('', camera({ yaw: 60 }), { hasGuideReference: true }), /明显右侧前遮挡关系/);
  assert.match(angle.compileAngleTargetPrompt('', camera({ yaw: -90 })), /人物左侧约90°/);
  assert.match(angle.compileAngleTargetPrompt('', camera({ yaw: 180 })), /人物后方约180°/);
});

test('keeps the 180-degree wrap deterministic', () => {
  assert.equal(angle.effectiveAngle(180), 180);
  assert.equal(angle.effectiveAngle(-180), 180);
  assert.equal(angle.effectiveAngle(540), 180);
  assert.equal(angle.relativeViewYaw(camera({ yaw: -180 })), 180);
});

test('records relative camera adjustments without changing the viewport state', () => {
  const start = camera({ yaw: 179, pitch: 26.1, focal: 50, distance: 2.2, frameX: 4, frameY: -8 });
  const target = camera({ yaw: -179, pitch: 22.1, focal: 62, distance: 0.9, frameX: 12, frameY: -20 });
  assert.deepEqual(angle.deriveAngleDelta(start, target), {
    yaw: 2,
    pitch: -4,
    roll: 0,
    focal: 12,
    distance: -1.3,
    frameX: 8,
    frameY: -12,
  });
  assert.equal(target.yaw, -179);
  const prompt = angle.compileAngleTargetPrompt('', target, { hasGuideReference: true, cameraStart: start });
  assert.match(prompt, /图1当前视角对应已记录的起始机位/);
  assert.match(prompt, /从已记录的起始机位移动到/);
  assert.equal(prompt.split('\n').length, 3);
});

test('migrates legacy subject rotation into the final yaw once', () => {
  const migrated = angle.normalizeAngleState({ yaw: 51.6, subjectYaw: 68, pitch: 22.1 });
  assert.equal(migrated.yaw, -16.4);
  assert.equal('subjectYaw' in migrated, false);
  assert.equal(angle.normalizeAngleState(migrated).yaw, -16.4);
});

test('default parameters stay concise and optional parameters are dynamic', () => {
  const defaultPrompt = angle.compileAngleTargetPrompt('', camera({ yaw: 30 }), { hasGuideReference: true });
  assert.match(defaultPrompt, /人物右前方约30°/);
  assert.doesNotMatch(defaultPrompt, /50mm|2\.2×距离/);

  const prompt = angle.compileAngleTargetPrompt('保持原有表情', camera({ yaw: 51.6, pitch: 22.1, focal: 62, distance: 0.9, roll: 17, frameX: 2.1, frameY: -47.7 }), {
    hasGuideReference: true,
    output: { width: 720, height: 1280, aspectRatio: '9:16' },
  });
  assert.match(prompt, /最终画面由程序后处理顺时针倾斜约17°，生成阶段保持画面水平/);
  assert.match(prompt, /补充要求：保持原有表情/);
  assert.equal(prompt.match(/保持原有表情/g)?.length, 1);
  assert.doesNotMatch(prompt, /向右|向下|画面偏移|720x1280|720×1280/);
  assert.doesNotMatch(prompt, /recorded start|Subject yaw|relative-view change|Δ|RECONSTRUCTION REQUIREMENTS|Do not crop/);
});

test('compiled prompt keeps one authoritative reconstruction instruction', () => {
  const prompt = angle.compileAngleTargetPrompt('', camera({ yaw: 51.6, pitch: 22.1, focal: 62, distance: 0.9, frameX: 2.1, frameY: -47.7 }), {
    hasGuideReference: true,
    output: { width: 720, height: 1280, aspectRatio: '9:16' },
  });
  assert.equal(prompt.match(/人物和整个场景都必须按目标机位重建/g)?.length, 1);
  assert.equal(prompt.split('\n').length, 3);
  assert.equal(prompt.match(/51\.6/g)?.length, 1);
  assert.equal(prompt.match(/22\.1/g)?.length, 1);
});

test('camera payload contains only the final camera state', () => {
  const payload = angle.buildAnglePayload(camera({ yaw: 51.6, pitch: 22.1, focal: 62, distance: 0.9, frameX: 2.1, frameY: -47.7 }), 'gpt-image-2-lite');
  assert.equal(payload.camera.yaw_deg, 51.6);
  assert.equal(payload.camera.pitch_deg, 22.1);
  assert.equal(payload.camera.focal_length_mm, 62);
  assert.equal(payload.instruction, 'final_camera_reconstruction');
  assert.equal('subject_yaw_deg' in payload.camera, false);
  assert.equal('change' in payload, false);
});

test('camera payload keeps recorded start and relative delta for audit', () => {
  const start = camera({ yaw: 72.9, pitch: 26.1 });
  const target = camera({ yaw: 51.6, pitch: 22.1, focal: 62, distance: 0.9 });
  const payload = angle.buildAnglePayload(target, 'gpt-image-2-lite', start);
  assert.equal(payload.camera.yaw_deg, 51.6);
  assert.equal(payload.camera_start.yaw_deg, 72.9);
  assert.equal(payload.camera_delta.yaw_deg, -21.3);
  assert.equal(payload.camera_delta.pitch_deg, -4);
  assert.equal(payload.camera_delta.focal_length_mm, 12);
  assert.equal(payload.camera_delta.distance, -1.3);
});

test('warns only for Lite at final absolute yaw of at least 30 degrees', () => {
  assert.equal(angle.shouldWarnLiteForAngle('gpt-image-2-lite', 29.9), false);
  assert.equal(angle.shouldWarnLiteForAngle('gpt-image-2-lite', 30), true);
  assert.equal(angle.shouldWarnLiteForAngle('gpt-image-2-lite', -60), true);
  assert.equal(angle.shouldWarnLiteForAngle('gpt-image-2', 60), false);
});
