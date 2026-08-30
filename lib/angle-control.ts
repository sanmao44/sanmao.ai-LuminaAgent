import type { ClientReferenceImage } from '@/lib/types';

export type AngleCameraState = {
  yaw: number;
  pitch: number;
  roll: number;
  focal: number;
  distance: number;
  frameX: number;
  frameY: number;
  compositionLock: boolean;
  modelId: string;
};

export type LegacyAngleCameraInput = Partial<AngleCameraState> & {
  /** Removed in the final-camera workflow; retained only for read-time migration. */
  subjectYaw?: number;
};

export type AngleGenerationInput = {
  reference: ClientReferenceImage;
  guideReference: ClientReferenceImage;
  output: AngleOutputSpec;
  camera: AngleCameraState;
  /** The camera state aligned to the original reference before adjustments. */
  cameraStart?: AngleCameraState | null;
  note: string;
  prompt: string;
};

export type AngleOutputSpec = {
  aspectRatio: string;
  width: number;
  height: number;
  referenceWidth: number;
  referenceHeight: number;
};

export type AnglePreset = {
  id: string;
  label: string;
  yaw: number;
  pitch: number;
};

export const ANGLE_DEFAULTS: AngleCameraState = {
  yaw: 0,
  pitch: 0,
  roll: 0,
  focal: 50,
  distance: 2.2,
  frameX: 0,
  frameY: 0,
  compositionLock: false,
  modelId: 'auto',
};

export const ANGLE_PRESETS: AnglePreset[] = [
  { id: 'front', label: '正面', yaw: 0, pitch: 0 },
  { id: 'left-front', label: '左前', yaw: -30, pitch: 0 },
  { id: 'right-front', label: '右前', yaw: 30, pitch: 0 },
  { id: 'left-side', label: '左侧', yaw: -60, pitch: 0 },
  { id: 'right-side', label: '右侧', yaw: 60, pitch: 0 },
  { id: 'right-back', label: '右后', yaw: 120, pitch: 0 },
  { id: 'back', label: '背面', yaw: 180, pitch: 0 },
  { id: 'overhead', label: '俯拍', yaw: 0, pitch: -25 },
  { id: 'low-angle', label: '仰拍', yaw: 0, pitch: 25 },
];

export type AngleNumericKey = 'yaw' | 'pitch' | 'roll' | 'focal' | 'distance' | 'frameX' | 'frameY';

export type AngleCameraDelta = Pick<Record<AngleNumericKey, number>, AngleNumericKey>;

/**
 * The 3D viewport is DCC-style and intentionally has no artificial angular
 * limit. Only values that would make a camera invalid are held above zero.
 */
export function clampAngleValue<K extends AngleNumericKey>(key: K, value: number) {
  const fallback = ANGLE_DEFAULTS[key];
  if (!Number.isFinite(value)) return fallback;
  if (key === 'focal') return Math.max(0.1, value);
  if (key === 'distance') return Math.max(0.05, value);
  return value;
}

/** Converts an unlimited viewport rotation to its equivalent render angle. */
export function effectiveAngle(value: number) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
}

function roundAngleRecordValue(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Old records used world camera yaw plus a separately rotated subject root.
 * Their visible camera-to-subject yaw was cameraYaw - subjectYaw. Migrating
 * while reading keeps the same view, then drops subjectYaw permanently.
 */
export function normalizeAngleState(input?: LegacyAngleCameraInput): AngleCameraState {
  const raw = input || {};
  const legacySubjectYaw = typeof raw.subjectYaw === 'number' && Number.isFinite(raw.subjectYaw) ? raw.subjectYaw : 0;
  const rawYaw = typeof raw.yaw === 'number' ? raw.yaw : ANGLE_DEFAULTS.yaw;
  const next = { ...ANGLE_DEFAULTS, ...raw, yaw: rawYaw - legacySubjectYaw };
  return {
    yaw: clampAngleValue('yaw', next.yaw),
    pitch: clampAngleValue('pitch', next.pitch),
    roll: clampAngleValue('roll', next.roll),
    focal: clampAngleValue('focal', next.focal),
    distance: Math.round(clampAngleValue('distance', next.distance) * 10) / 10,
    frameX: clampAngleValue('frameX', next.frameX),
    frameY: clampAngleValue('frameY', next.frameY),
    compositionLock: Boolean(next.compositionLock),
    modelId: typeof next.modelId === 'string' && next.modelId ? next.modelId : 'auto',
  };
}

export function focalLengthToFov(focal: number) {
  const safeFocal = Math.max(1, Number(focal) || ANGLE_DEFAULTS.focal);
  return (2 * Math.atan(36 / (2 * safeFocal)) * 180) / Math.PI;
}

/** Yaw is now directly relative to the subject's fixed anatomical front. */
export function relativeViewYaw(camera: Pick<AngleCameraState, 'yaw'>) {
  return roundAngleRecordValue(effectiveAngle(camera.yaw));
}

/**
 * Returns the shortest camera adjustment from a recorded start state to the
 * current target state.  In particular, 179° → -179° is +2°, not -358°.
 * Non-angular camera values use the ordinary target-minus-start difference.
 */
export function deriveAngleDelta(start: AngleCameraState, target: AngleCameraState): AngleCameraDelta {
  const startState = normalizeAngleState(start);
  const targetState = normalizeAngleState(target);
  return {
    yaw: roundAngleRecordValue(effectiveAngle(targetState.yaw - startState.yaw)),
    pitch: roundAngleRecordValue(targetState.pitch - startState.pitch),
    roll: roundAngleRecordValue(targetState.roll - startState.roll),
    focal: roundAngleRecordValue(targetState.focal - startState.focal),
    distance: roundAngleRecordValue(targetState.distance - startState.distance),
    frameX: roundAngleRecordValue(targetState.frameX - startState.frameX),
    frameY: roundAngleRecordValue(targetState.frameY - startState.frameY),
  };
}

function recordNumber(value: number) {
  return String(roundAngleRecordValue(value));
}

/**
 * Convert the numeric camera controls into visual language that image models
 * tend to follow more reliably than a bare camera specification.  Positive
 * yaw remains the subject's right, matching the existing UI and persisted
 * records.  Positive pitch remains the legacy low-angle direction; the
 * compiler translates that convention into plain-language elevation below.
 */
export function yawSemanticLabel(yaw: number) {
  const angle = relativeViewYaw({ yaw });
  const magnitude = Math.abs(angle);
  const side = angle >= 0 ? '右' : '左';
  if (magnitude <= 10) return '正面视角（近乎正面）';
  if (magnitude <= 25) return `人物${side}前方轻微三分之四视角`;
  if (magnitude <= 45) return `人物${side}前方明显三分之四视角`;
  if (magnitude <= 70) return `人物${side}前方强三分之四、接近侧面视角`;
  if (magnitude <= 105) return `人物${side}侧面视角`;
  if (magnitude <= 150) return `人物${side}后方三分之四视角`;
  return '人物背面视角';
}

/** Positive pitch is intentionally kept as the existing low-angle direction. */
export function pitchSemanticLabel(pitch: number) {
  const angle = roundAngleRecordValue(pitch);
  if (angle >= 45) return '明显低机位仰拍';
  if (angle > 8) return '轻微低机位仰拍';
  if (angle > -8) return '平视机位';
  if (angle > -45) return '轻微高机位俯拍';
  return '明显高机位俯拍';
}

export function focalSemanticLabel(focal: number) {
  const value = Math.max(0.1, Number(focal) || ANGLE_DEFAULTS.focal);
  if (value <= 28) return '广角透视，近处和远处的大小差异更明显';
  if (value <= 40) return '中广角环境透视';
  if (value <= 65) return '自然标准透视，畸变较少';
  if (value <= 105) return '轻微长焦透视压缩';
  return '长焦透视压缩，空间更扁平';
}

export function distanceSemanticLabel(distance: number) {
  const value = Math.max(0.05, Number(distance) || ANGLE_DEFAULTS.distance);
  if (value <= 1) return '近距离，主体占画面比例很高';
  if (value <= 1.8) return '较近距离，主体偏满画面';
  if (value <= 3) return '中等距离，主体比例自然';
  if (value <= 5) return '较远距离，环境占比更明显';
  return '远距离，环境广角构图';
}

export function cameraSemanticSummary(camera: Pick<AngleCameraState, 'yaw' | 'pitch' | 'focal' | 'distance'>) {
  return {
    yaw: yawSemanticLabel(camera.yaw),
    pitch: pitchSemanticLabel(camera.pitch),
    focal: focalSemanticLabel(camera.focal),
    distance: distanceSemanticLabel(camera.distance),
  };
}

function relativeYawViewDescription(yaw: number) {
  const angle = relativeViewYaw({ yaw });
  const magnitude = Math.abs(angle);
  const side = angle >= 0 ? "subject's right" : "subject's left";
  if (magnitude <= 10) return 'nearly frontal, centered on the anatomical front of the face and chest';
  if (magnitude <= 25) return `slight three-quarter view from the ${side}`;
  if (magnitude <= 45) return `clear three-quarter view from the ${side}`;
  if (magnitude <= 70) return `strong three-quarter, near-profile view from the ${side}`;
  if (magnitude <= 105) return `side/profile view from the ${side}, with side geometry dominant`;
  if (magnitude <= 150) return `rear three-quarter view from the ${side}, with back geometry dominant`;
  return 'direct or near-direct rear view, with the anatomical back dominant';
}

function pitchViewDescription(pitch: number) {
  if (pitch > 8) return 'a low-angle camera below the subject looking upward, showing underside-facing geometry rather than the top of the head';
  if (pitch < -8) return 'a high-angle camera above the subject looking downward, showing top-facing geometry';
  return 'an eye-level camera approximately level with the subject';
}

function rollViewDescription(roll: number) {
  if (roll > 2) return 'clockwise camera roll';
  if (roll < -2) return 'counterclockwise camera roll';
  return 'level frame with no visible camera roll';
}

function focalViewDescription(focal: number) {
  if (focal <= 28) return 'wide-angle perspective with visibly stronger near/far size exaggeration';
  if (focal <= 40) return 'moderately wide environmental perspective';
  if (focal <= 65) return 'natural normal-lens perspective with minimal distortion';
  if (focal <= 105) return 'short-telephoto perspective with mild compression';
  return 'telephoto perspective with a narrow field of view and flatter depth compression';
}

function distanceViewDescription(distance: number) {
  if (distance <= 1) return 'close camera distance with a very large subject occupancy';
  if (distance <= 1.8) return 'relatively close camera distance with a full, prominent subject';
  if (distance <= 3) return 'medium camera distance with natural subject scale';
  if (distance <= 5) return 'far camera distance with more environment in frame';
  return 'very far camera distance for an environmental wide shot';
}

function subjectReprojectionDescription(yaw: number, pitch: number) {
  const horizontal = yaw > 2 && yaw < 90
    ? 'reproject the subject from the front-right direction with the face and anatomical front still visible'
    : yaw <= -2 && yaw > -90
      ? 'reproject the subject from the front-left direction with the face and anatomical front still visible'
      : yaw >= 90
        ? 'reproject the subject from the right side toward the back according to the exact yaw'
        : yaw <= -90
          ? 'reproject the subject from the left side toward the back according to the exact yaw'
          : 'reproject the subject from the anatomical front';
  const vertical = pitch < -2
    ? 'show top-facing geometry caused by a camera above the subject'
    : pitch > 2
      ? 'show underside-facing geometry caused by a camera below the subject'
      : 'keep an eye-level vertical projection';
  return `${horizontal}; ${vertical}`;
}

function frontVisibilityDescription(yaw: number) {
  if (Math.abs(yaw) < 90) return 'the face and anatomical front/chest remain visible and the back must not dominate';
  if (Math.abs(yaw) > 92) return 'back-facing geometry may dominate according to the requested yaw';
  return 'preserve a true anatomical side view without crossing accidentally into front or rear view';
}

function compactRollDescription(roll: number) {
  const angle = effectiveAngle(roll);
  if (Math.abs(angle) <= 0.0001) return '';
  return `最终画面由程序后处理${angle > 0 ? '顺时针' : '逆时针'}倾斜约${recordNumber(Math.abs(angle))}°，生成阶段保持画面水平`;
}

function compactPerspectiveGuard(yaw: number) {
  const angle = effectiveAngle(yaw);
  const magnitude = Math.abs(angle);
  if (magnitude < 45 || magnitude > 135) return '';
  if (magnitude <= 80) return `此时脸部、胸腔和肩部要呈明显${angle > 0 ? '右' : '左'}侧前遮挡关系，不得保留原图正面平铺轮廓。`;
  if (magnitude <= 112.5) return `此时脸部、胸腔和肩部要呈明显${angle > 0 ? '右' : '左'}侧面遮挡关系，不得保留原图正面平铺轮廓。`;
  return '此时脸部、胸腔和肩部要呈现图2要求的后侧遮挡关系，不得保留原图正面平铺轮廓。';
}

/** Shared provider prompt describing one authoritative final camera state. */
export function compileAngleTargetPrompt(note: string, camera: AngleCameraState, options?: { hasGuideReference?: boolean; output?: Pick<AngleOutputSpec, 'aspectRatio' | 'width' | 'height'>; cameraStart?: AngleCameraState | null }) {
  const target = normalizeAngleState(camera);
  const yaw = relativeViewYaw(target);
  const cameraStart = options?.cameraStart ? normalizeAngleState(options.cameraStart) : null;
  const userNote = note.trim();
  const delta = cameraStart ? deriveAngleDelta(cameraStart, target) : null;
  const referenceBlock = options?.hasGuideReference
    ? [
      'IMAGE ROLES',
      '图1是 SOURCE IMAGE：只从图1读取人物身份、脸部特征、发型、服装、姿态、场景、光照、色彩、材质与视觉风格。',
      '图2是 TARGET CAMERA GUIDE：只读取目标相机位置、水平视角、上下视角、透视、主体比例、画面位置与裁切。',
      '不要复制图2的灰模、网格、材质、灯光、背景或渲染风格；不要把图2当作人物外观参考。',
    ].join('\n')
    : [
      'IMAGE ROLES',
      '图1是 SOURCE IMAGE，也是人物身份、场景、光照、色彩、材质与视觉风格的唯一参考。',
      '按目标相机重新拍摄，不要复用图1的原始二维投影。',
    ].join('\n');
  const startBlock = cameraStart
    ? `起始机位：图1当前视角（已记录的起始机位）；目标是从该机位移动到最终机位。相对调整为 Yaw ${recordNumber(delta?.yaw || 0)}°、Pitch ${recordNumber(delta?.pitch || 0)}°、焦距 ${recordNumber(delta?.focal || 0)}mm、距离 ${recordNumber(delta?.distance || 0)}×。`
    : '没有单独的起始机位记录；以图1当前视角作为相对参考。';
  const roll = compactRollDescription(target.roll);
  const frameLine = options?.hasGuideReference
    ? options.output
      ? `按图2匹配主体在画框中的比例、位置与裁切；目标输出比例为 ${options.output.aspectRatio}（${options.output.width}×${options.output.height}）。`
      : '按图2匹配主体在画框中的比例、位置与裁切。'
    : options?.output
      ? `保持主体在画面中的比例、位置与裁切合理；目标输出比例为 ${options.output.aspectRatio}（${options.output.width}×${options.output.height}）。`
      : '保持主体在画面中的比例、位置与裁切合理，并随目标相机调整。';
  const blocks = [
    'TASK\n从同一个时刻、同一个人物和同一个场景重新拍摄一张目标机位画面。',
    referenceBlock,
    [
      'CAMERA MOTION',
      '只移动 CAMERA，不要让 SUBJECT 转身、转头、扭转躯干、改变姿态或重新摆 pose 来伪造机位变化。',
      '人物保持同一世界空间姿态，像同一瞬间从另一台相机拍摄；镜头变化优先于逐像素复制。',
      startBlock,
    ].join('\n'),
    [
      'TARGET VIEW',
      `水平机位：相对人物固定解剖正面约 ${recordNumber(yaw)}°；视觉语义为 ${relativeYawViewDescription(yaw)}。${compactPerspectiveGuard(yaw)}`,
      `上下机位：当前 Pitch ${recordNumber(target.pitch)}°，视觉语义为${pitchSemanticLabel(target.pitch)}；${target.pitch > 8 ? '相机位于主体视线下方并向上看。' : target.pitch < -8 ? '相机位于主体视线上方并向下看。' : '相机大致与主体视线齐平。'}`,
    ].join('\n'),
    [
      'PERSPECTIVE',
      `目标焦距约 ${recordNumber(target.focal)}mm；${focalSemanticLabel(target.focal)}。把焦距当作视觉透视目标，不要求精确模拟物理镜头。`,
      `目标距离约 ${recordNumber(target.distance)}×；${distanceSemanticLabel(target.distance)}。`,
    ].join('\n'),
    `FRAMING\n${frameLine} 不要只裁切原图来制造角度；需要让人物、前景、中景和背景按照目标机位产生合理的透视、可见面、相对位移与遮挡关系。`,
    [
      'CHANGE ONLY',
      options?.hasGuideReference ? '只改变目标相机视角，以及匹配图2所必需的透视、主体比例、位置和裁切。' : '只改变目标相机视角，以及为匹配目标构图所必需的透视、主体比例、位置和裁切。',
      '禁止整图旋转、只改裁切、把原始正面背景贴回去，或保留与目标机位冲突的二维投影。',
    ].join('\n'),
    [
      'PRESERVE',
      '保持人物身份、脸部可识别特征、发型、服装、配饰、身体比例、世界空间姿态、表情、场景、重要物体关系、光照方向、色彩、材质与视觉风格。',
      `不要添加无关物体，不要删除重要物体，不要重新设计人物${options?.hasGuideReference ? '，不要复制灰模外观' : ''}。`,
    ].join('\n'),
    `OUTPUT\n生成一张连贯的基础水平画面；${roll || '生成阶段保持水平。'}${userNote ? `\n补充要求：${userNote}` : ''}`,
  ];
  return blocks.join('\n');
}

export function angleName(yaw: number) {
  const normalized = ((yaw % 360) + 360) % 360;
  if (normalized < 22.5 || normalized >= 337.5) return '正面';
  if (normalized < 67.5) return '右前';
  if (normalized < 112.5) return '右侧';
  if (normalized < 157.5) return '右后';
  if (normalized < 202.5) return '背面';
  if (normalized < 247.5) return '左后';
  if (normalized < 292.5) return '左侧';
  return '左前';
}

export function shouldWarnLiteForAngle(modelIdentity: string | null | undefined, yaw: number) {
  return /gpt-image-2-lite/i.test(modelIdentity || '') && Math.abs(effectiveAngle(yaw)) >= 30;
}

function compactCameraPayload(state: AngleCameraState) {
  return {
    yaw_deg: Number(effectiveAngle(state.yaw).toFixed(1)),
    pitch_deg: Number(effectiveAngle(state.pitch).toFixed(1)),
    roll_deg: Number(effectiveAngle(state.roll).toFixed(1)),
    focal_length_mm: Math.round(state.focal),
    distance: Number(state.distance.toFixed(1)),
    frame_offset_x_pct: Number(state.frameX.toFixed(1)),
    frame_offset_y_pct: Number(state.frameY.toFixed(1)),
  };
}

export function buildAnglePayload(camera: AngleCameraState, modelLabel?: string, cameraStart?: AngleCameraState | null) {
  const rawState = normalizeAngleState(camera);
  const state = { ...rawState, yaw: effectiveAngle(rawState.yaw), pitch: effectiveAngle(rawState.pitch), roll: effectiveAngle(rawState.roll) };
  const startState = cameraStart ? normalizeAngleState(cameraStart) : null;
  const delta = startState ? deriveAngleDelta(startState, rawState) : null;
  return {
    model: { id: state.modelId, label: modelLabel || state.modelId },
    camera: {
      yaw_deg: Number(state.yaw.toFixed(1)),
      yaw_convention: 'subject-relative camera orbit: 0° front; positive yaw moves toward the subject\'s right; +90° exact right side; +180° back; negative yaw moves toward the subject\'s left',
      yaw_reference_axis: 'the subject root stays fixed; camera yaw is the final visible camera-to-subject relationship',
      horizontal_view: relativeYawViewDescription(state.yaw),
      pitch_deg: Number(state.pitch.toFixed(1)),
      vertical_view: pitchViewDescription(state.pitch),
      roll_deg: Number(state.roll.toFixed(1)),
      roll_view: rollViewDescription(state.roll),
      roll_pipeline: 'render a level base frame; apply the exact requested roll deterministically after generation',
      subject_view: subjectReprojectionDescription(state.yaw, state.pitch),
      front_visibility: frontVisibilityDescription(state.yaw),
      focal_length_mm: Math.round(state.focal),
      focal_view: focalViewDescription(state.focal),
      distance: Number(state.distance.toFixed(1)),
      distance_view: distanceViewDescription(state.distance),
      horizontal_fov_deg: Number(focalLengthToFov(state.focal).toFixed(1)),
      composition_lock: state.compositionLock,
      frame_offset_x_pct: Number(state.frameX.toFixed(1)),
      frame_offset_y_pct: Number(state.frameY.toFixed(1)),
    },
    ...(startState ? {
      camera_start: compactCameraPayload(startState),
      camera_delta: {
        yaw_deg: delta?.yaw ?? 0,
        pitch_deg: delta?.pitch ?? 0,
        roll_deg: delta?.roll ?? 0,
        focal_length_mm: delta?.focal ?? 0,
        distance: delta?.distance ?? 0,
        frame_offset_x_pct: delta?.frameX ?? 0,
        frame_offset_y_pct: delta?.frameY ?? 0,
        convention: 'target minus recorded start; yaw uses the shortest signed wrap-around',
      },
    } : {}),
    instruction: 'final_camera_reconstruction',
  };
}

/** Backward-compatible name for callers that already use the one-camera API. */
export function compileAnglePrompt(note: string, camera: AngleCameraState) {
  return compileAngleTargetPrompt(note, camera);
}
