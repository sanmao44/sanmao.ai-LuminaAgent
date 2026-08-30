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
  assert.match(prompt, /ONLY THE CAMERA MOVES/);
  assert.match(prompt, /same world-space pose/);
  assert.match(prompt, /TARGET VIEW/);
  assert.match(prompt, /HORIZONTAL VIEW · three_quarter · strong/);
  assert.match(prompt, /anatomical RIGHT side/);
  assert.match(prompt, /approximately 51\.6 degrees/);
  assert.match(prompt, /VERTICAL VIEW · low_angle · slight/);
  assert.match(prompt, /below the SUBJECT's eye level and looks UPWARD/);
  assert.match(prompt, /approximately 22\.1 degrees/);
  assert.match(prompt, /approximately 62mm-equivalent/);
  assert.match(prompt, /final camera distance 0\.9×/);
  assert.match(prompt, /FRAMING/);
  assert.match(prompt, /PRIORITY/);
  assert.match(prompt, /CHANGE ONLY/);
  assert.match(prompt, /PRESERVE/);
  assert.match(prompt, /保持人物身份、脸部特征/);
  assert.match(prompt, /Preserve all 3D world-space relationships/);
  assert.match(prompt, /Do NOT preserve the original 2D projection/);
  assert.match(prompt, /Occlusion, overlap, visible surfaces and screen position may change naturally/);
  assert.match(prompt, /OUTPUT/);
  assert.match(prompt, /720×1280/);
  assert.doesNotMatch(prompt, /当前 Pitch|起始机位|相对调整为|subject-relative|RECONSTRUCTION/);
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
  assert.equal(angle.buildAngleTargetSemantic(camera({ pitch: -8 })).vertical_view.class, 'eye_level');
  assert.equal(angle.buildAngleTargetSemantic(camera({ pitch: 8 })).vertical_view.class, 'eye_level');
  assert.equal(angle.buildAngleTargetSemantic(camera({ pitch: -8.1 })).vertical_view.class, 'high_angle');
  assert.equal(angle.buildAngleTargetSemantic(camera({ pitch: 8.1 })).vertical_view.class, 'low_angle');
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

  assert.match(angle.compileAngleTargetPrompt('', camera({ yaw: 0 })), /HORIZONTAL VIEW · frontal · near/);
  assert.match(angle.compileAngleTargetPrompt('', camera({ yaw: 60 })), /strong right three-quarter view/);
  assert.match(angle.compileAngleTargetPrompt('', camera({ yaw: 60 }), { hasGuideReference: true }), /anatomical RIGHT side/);
  assert.match(angle.compileAngleTargetPrompt('', camera({ yaw: -90 })), /anatomical LEFT side/);
  assert.match(angle.compileAngleTargetPrompt('', camera({ yaw: 180 })), /physically behind the stationary SUBJECT/);
});

test('keeps the 180-degree wrap deterministic', () => {
  assert.equal(angle.effectiveAngle(180), 180);
  assert.equal(angle.effectiveAngle(-180), 180);
  assert.equal(angle.effectiveAngle(540), 180);
  assert.equal(angle.relativeViewYaw(camera({ yaw: -180 })), 180);
});

test('records relative camera adjustments without putting them in the model prompt', () => {
  const start = camera({ yaw: 72.9, pitch: 26.1, focal: 35, distance: 2.2, frameX: 4, frameY: -8 });
  const target = camera({ yaw: 51.6, pitch: 22.1, focal: 62, distance: 0.9, frameX: 12, frameY: -20 });
  assert.deepEqual(angle.deriveAngleDelta(start, target), {
    yaw: -21.3,
    pitch: -4,
    roll: 0,
    focal: 27,
    distance: -1.3,
    frameX: 8,
    frameY: -12,
  });
  assert.equal(target.yaw, 51.6);
  const prompt = angle.compileAngleTargetPrompt('', target, { hasGuideReference: true, cameraStart: start });
  assert.match(prompt, /approximately 51\.6 degrees/);
  assert.match(prompt, /approximately 62mm-equivalent/);
  assert.match(prompt, /final camera distance 0\.9×/);
  assert.doesNotMatch(prompt, /72\.9|26\.1|35mm|相对调整为|起始机位/);
});

test('keeps the reported 43-degree high-angle scenario free of delta conflicts', () => {
  const start = camera({ yaw: 0, pitch: 0, focal: 50, distance: 1 });
  const target = camera({ yaw: 43.4, pitch: -37.8, focal: 50, distance: 1.2 });
  const prompt = angle.compileAngleTargetPrompt('', target, { hasGuideReference: true, cameraStart: start });
  assert.match(prompt, /approximately 43\.4 degrees/);
  assert.match(prompt, /ABOVE the SUBJECT's eye level and looks DOWNWARD toward the subject by approximately 37\.8 degrees/);
  assert.match(prompt, /approximately 50mm-equivalent/);
  assert.match(prompt, /final camera distance 1\.2×/);
  assert.doesNotMatch(prompt, /0\.2×|当前 Pitch|-37\.8|相对调整为|起始机位/);
});

test('migrates legacy subject rotation into the final yaw once', () => {
  const migrated = angle.normalizeAngleState({ yaw: 51.6, subjectYaw: 68, pitch: 22.1 });
  assert.equal(migrated.yaw, -16.4);
  assert.equal('subjectYaw' in migrated, false);
  assert.equal(angle.normalizeAngleState(migrated).yaw, -16.4);
});

test('default parameters stay concise and optional parameters are dynamic', () => {
  const defaultPrompt = angle.compileAngleTargetPrompt('', camera({ yaw: 30 }), { hasGuideReference: true });
  assert.match(defaultPrompt, /clear, obvious right three-quarter view/);
  assert.match(defaultPrompt, /approximately 50mm-equivalent/);
  assert.match(defaultPrompt, /final camera distance 2\.2×/);

  const prompt = angle.compileAngleTargetPrompt('保持原有表情', camera({ yaw: 51.6, pitch: 22.1, focal: 62, distance: 0.9, roll: 17, frameX: 2.1, frameY: -47.7 }), {
    hasGuideReference: true,
    output: { width: 720, height: 1280, aspectRatio: '9:16' },
  });
  assert.match(prompt, /最终画面由程序后处理顺时针倾斜约17°，生成阶段保持画面水平/);
  assert.match(prompt, /OPTIONAL USER NOTE（不得覆盖上述机位和姿态约束）：保持原有表情/);
  assert.equal(prompt.match(/保持原有表情/g)?.length, 1);
  assert.doesNotMatch(prompt, /向右|向下|画面偏移|720x1280/);
  assert.doesNotMatch(prompt, /recorded start|Subject yaw|relative-view change|Δ|RECONSTRUCTION REQUIREMENTS|Do not crop|当前 Pitch|相对调整为/);
});

test('compiled prompt keeps one authoritative reconstruction instruction', () => {
  const prompt = angle.compileAngleTargetPrompt('', camera({ yaw: 51.6, pitch: 22.1, focal: 62, distance: 0.9, frameX: 2.1, frameY: -47.7 }), {
    hasGuideReference: true,
    output: { width: 720, height: 1280, aspectRatio: '9:16' },
  });
  assert.equal(prompt.match(/ONLY THE CAMERA MOVES/g)?.length, 1);
  assert.equal(prompt.match(/CHANGE ONLY/g)?.length, 1);
  assert.equal(prompt.match(/PRESERVE/g)?.length, 1);
  assert.equal(prompt.match(/51\.6/g)?.length, 1);
  assert.equal(prompt.match(/22\.1/g)?.length, 1);
  assert.equal(prompt.match(/62mm/g)?.length, 1);
  assert.equal(prompt.match(/0\.9×/g)?.length, 1);
});

test('builds one reusable semantic target for prompt and audit payload', () => {
  const target = camera({ yaw: -42, pitch: -40, roll: 17, focal: 50, distance: 1.2, frameX: 3, frameY: -4 });
  const semantic = angle.buildAngleTargetSemantic(target, { width: 720, height: 1280, aspectRatio: '9:16' });
  assert.deepEqual({
    camera_motion: semantic.camera_motion,
    subject_motion: semantic.subject_motion,
    horizontal: [semantic.horizontal_view.class, semantic.horizontal_view.strength, semantic.horizontal_view.side, semantic.horizontal_view.angle_deg],
    vertical: [semantic.vertical_view.class, semantic.vertical_view.direction, semantic.vertical_view.angle_deg],
    perspective: [semantic.perspective.focal_length_mm, semantic.perspective.distance_multiplier],
    roll: [semantic.roll.generation, semantic.roll.postprocess_degrees],
  }, {
    camera_motion: 'orbit_only',
    subject_motion: 'none',
    horizontal: ['three_quarter', 'clear', 'anatomical_left', 42],
    vertical: ['high_angle', 'downward', 40],
    perspective: [50, 1.2],
    roll: ['level', 17],
  });
  const payload = angle.buildAnglePayload(target, 'gpt-image-2', null, { width: 720, height: 1280, aspectRatio: '9:16' });
  assert.deepEqual(payload.camera.semantic_target, semantic);
  assert.equal(payload.camera_start, undefined);
  assert.equal(payload.camera_delta, undefined);
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
