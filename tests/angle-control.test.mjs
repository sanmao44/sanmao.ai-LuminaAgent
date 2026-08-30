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

test('compiles numeric camera state into explicit visual semantics and edit constraints', () => {
  const target = camera({ yaw: 51.6, pitch: 22.1, focal: 62, distance: 0.9, frameX: 2.1, frameY: -47.7 });
  const prompt = angle.compileAngleTargetPrompt('', target, {
    hasGuideReference: true,
    output: { width: 720, height: 1280, aspectRatio: '9:16' },
  });
  assert.equal(angle.relativeViewYaw(target), 51.6);
  assert.equal(angle.angleName(target.yaw), '右前');
  assert.match(prompt, /TASK/);
  assert.match(prompt, /IMAGE ROLES/);
  assert.match(prompt, /图1是 SOURCE IMAGE/);
  assert.match(prompt, /图2是 TARGET CAMERA GUIDE/);
  assert.match(prompt, /CAMERA MOTION/);
  assert.match(prompt, /只移动 CAMERA/);
  assert.match(prompt, /人物保持同一世界空间姿态/);
  assert.match(prompt, /TARGET VIEW/);
  assert.match(prompt, /水平机位：相对人物固定解剖正面约 51\.6°/);
  assert.match(prompt, /strong three-quarter, near-profile view/);
  assert.match(prompt, /当前 Pitch 22\.1°，视觉语义为轻微低机位仰拍/);
  assert.match(prompt, /目标焦距约 62mm/);
  assert.match(prompt, /目标距离约 0\.9×/);
  assert.match(prompt, /FRAMING/);
  assert.match(prompt, /CHANGE ONLY/);
  assert.match(prompt, /PRESERVE/);
  assert.match(prompt, /保持人物身份、脸部可识别特征/);
  assert.match(prompt, /OUTPUT/);
  assert.match(prompt, /720×1280/);
  assert.match(prompt, /脸部、胸腔和肩部要呈明显右侧前遮挡关系/);
  assert.match(prompt, /不得保留原图正面平铺轮廓/);
  assert.doesNotMatch(prompt, /-16\.4°|subject-relative|RECONSTRUCTION/);
});

test('exposes stable semantic buckets for yaw, pitch, lens and distance', () => {
  assert.match(angle.yawSemanticLabel(0), /正面/);
  assert.match(angle.yawSemanticLabel(15), /轻微三分之四/);
  assert.match(angle.yawSemanticLabel(35), /明显三分之四/);
  assert.match(angle.yawSemanticLabel(60), /强三分之四/);
  assert.match(angle.yawSemanticLabel(90), /侧面/);
  assert.match(angle.yawSemanticLabel(125), /后方三分之四/);
  assert.match(angle.yawSemanticLabel(180), /背面/);
  assert.match(angle.pitchSemanticLabel(0), /平视/);
  assert.match(angle.pitchSemanticLabel(-18), /高机位俯拍/);
  assert.match(angle.pitchSemanticLabel(18), /低机位仰拍/);
  assert.match(angle.focalSemanticLabel(24), /广角/);
  assert.match(angle.focalSemanticLabel(50), /自然标准透视/);
  assert.match(angle.focalSemanticLabel(85), /轻微长焦/);
  assert.match(angle.focalSemanticLabel(135), /长焦透视压缩/);
  assert.match(angle.distanceSemanticLabel(0.8), /主体占画面比例很高/);
  assert.match(angle.distanceSemanticLabel(1.4), /主体偏满画面/);
  assert.match(angle.distanceSemanticLabel(4), /环境占比更明显/);
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

  assert.match(angle.compileAngleTargetPrompt('', camera({ yaw: 0 })), /水平机位：相对人物固定解剖正面约 0°/);
  assert.match(angle.compileAngleTargetPrompt('', camera({ yaw: 60 })), /strong three-quarter, near-profile view/);
  assert.match(angle.compileAngleTargetPrompt('', camera({ yaw: 60 }), { hasGuideReference: true }), /明显右侧前遮挡关系/);
  assert.match(angle.compileAngleTargetPrompt('', camera({ yaw: -90 })), /水平机位：相对人物固定解剖正面约 -90°/);
  assert.match(angle.compileAngleTargetPrompt('', camera({ yaw: 180 })), /水平机位：相对人物固定解剖正面约 180°/);
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
  assert.match(prompt, /起始机位：图1当前视角（已记录的起始机位）/);
  assert.match(prompt, /起始机位：图1当前视角/);
  assert.match(prompt, /相对调整为 Yaw 2°、Pitch -4°、焦距 12mm、距离 -1\.3×/);
});

test('migrates legacy subject rotation into the final yaw once', () => {
  const migrated = angle.normalizeAngleState({ yaw: 51.6, subjectYaw: 68, pitch: 22.1 });
  assert.equal(migrated.yaw, -16.4);
  assert.equal('subjectYaw' in migrated, false);
  assert.equal(angle.normalizeAngleState(migrated).yaw, -16.4);
});

test('default parameters stay concise and optional parameters are dynamic', () => {
  const defaultPrompt = angle.compileAngleTargetPrompt('', camera({ yaw: 30 }), { hasGuideReference: true });
  assert.match(defaultPrompt, /水平机位：相对人物固定解剖正面约 30°/);
  assert.match(defaultPrompt, /目标焦距约 50mm/);
  assert.match(defaultPrompt, /目标距离约 2\.2×/);

  const prompt = angle.compileAngleTargetPrompt('保持原有表情', camera({ yaw: 51.6, pitch: 22.1, focal: 62, distance: 0.9, roll: 17, frameX: 2.1, frameY: -47.7 }), {
    hasGuideReference: true,
    output: { width: 720, height: 1280, aspectRatio: '9:16' },
  });
  assert.match(prompt, /最终画面由程序后处理顺时针倾斜约17°，生成阶段保持画面水平/);
  assert.match(prompt, /补充要求：保持原有表情/);
  assert.equal(prompt.match(/保持原有表情/g)?.length, 1);
  assert.doesNotMatch(prompt, /向右|向下|画面偏移|720x1280/);
  assert.doesNotMatch(prompt, /recorded start|Subject yaw|relative-view change|Δ|RECONSTRUCTION REQUIREMENTS|Do not crop/);
});

test('compiled prompt keeps one authoritative reconstruction instruction', () => {
  const prompt = angle.compileAngleTargetPrompt('', camera({ yaw: 51.6, pitch: 22.1, focal: 62, distance: 0.9, frameX: 2.1, frameY: -47.7 }), {
    hasGuideReference: true,
    output: { width: 720, height: 1280, aspectRatio: '9:16' },
  });
  assert.equal(prompt.match(/只移动 CAMERA/g)?.length, 1);
  assert.equal(prompt.match(/CHANGE ONLY/g)?.length, 1);
  assert.equal(prompt.match(/PRESERVE/g)?.length, 1);
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
