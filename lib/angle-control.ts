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

function relativeYawViewDescription(yaw: number) {
  const angle = roundAngleRecordValue(effectiveAngle(yaw));
  const magnitude = Math.abs(angle);
  const side = angle >= 0 ? "subject's right" : "subject's left";
  if (magnitude <= 5) return 'direct frontal view, centered on the anatomical front of the face and chest';
  if (magnitude < 25) return `near-frontal view from the ${side}, with the face and chest still predominantly frontal`;
  if (magnitude < 70) return `front three-quarter view from the ${side}, showing the front plus the ${side} geometry`;
  if (magnitude <= 110) return `true side/profile view from the ${side}, with side geometry dominant`;
  if (magnitude < 160) return `rear three-quarter view from the ${side}, with back geometry dominant`;
  return 'direct or near-direct rear view, with the anatomical back dominant';
}

function pitchViewDescription(pitch: number) {
  if (pitch > 2) return 'a low-angle camera below the subject looking upward, showing underside-facing geometry rather than the top of the head';
  if (pitch < -2) return 'a high-angle camera above the subject looking downward, showing top-facing geometry';
  return 'an eye-level camera approximately level with the subject';
}

function rollViewDescription(roll: number) {
  if (roll > 2) return 'clockwise camera roll';
  if (roll < -2) return 'counterclockwise camera roll';
  return 'level frame with no visible camera roll';
}

function focalViewDescription(focal: number) {
  if (focal <= 35) return 'wide-angle perspective with visibly stronger near/far size exaggeration';
  if (focal >= 85) return 'telephoto perspective with a narrow field of view and flatter depth compression';
  return 'normal perspective with a moderate field of view';
}

function distanceViewDescription(distance: number) {
  if (distance <= 1.4) return 'close camera distance with stronger perspective';
  if (distance >= 3.5) return 'far camera distance with flatter perspective';
  return 'medium camera distance with natural perspective';
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

function compactYawDescription(yaw: number) {
  const angle = relativeViewYaw({ yaw });
  const magnitude = Math.abs(angle);
  if (magnitude <= 2) return '人物正前方';
  const side = angle > 0 ? '右' : '左';
  if (magnitude < 67.5) return `人物${side}前方约${recordNumber(magnitude)}°`;
  if (magnitude <= 112.5) return `人物${side}侧约${recordNumber(magnitude)}°`;
  if (magnitude < 157.5) return `人物${side}后方约${recordNumber(magnitude)}°`;
  return `人物后方约${recordNumber(magnitude)}°`;
}

function compactPitchDescription(pitch: number) {
  const angle = roundAngleRecordValue(pitch);
  if (Math.abs(angle) <= 2) return '平视机位';
  return angle > 0 ? `低机位仰拍约${recordNumber(Math.abs(angle))}°` : `高机位俯拍约${recordNumber(Math.abs(angle))}°`;
}

function compactOpticsDescription(target: AngleCameraState) {
  const clauses: string[] = [];
  if (Math.abs(target.focal - ANGLE_DEFAULTS.focal) > 0.0001) clauses.push(`约${recordNumber(target.focal)}mm镜头`);
  if (Math.abs(target.distance - ANGLE_DEFAULTS.distance) > 0.0001) clauses.push(`约${recordNumber(target.distance)}×距离`);
  return clauses.length ? `，用${clauses.join('、')}` : '';
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
  const referenceLine = options?.hasGuideReference
    ? cameraStart
      ? '以图1作为人物、场景和光照的唯一视觉参考；图1当前视角对应已记录的起始机位。图2是水平的灰模机位/构图导引，只约束最终相机位置、可见面和裁切，不复制灰模外观或倾斜画面。'
      : '以图1作为人物、场景和光照的唯一视觉参考；图2是水平的灰模机位/构图导引，只约束最终相机位置、可见面和裁切，不复制灰模外观或倾斜画面。'
    : '以图1作为人物和场景的唯一参考；按当前相机机位重新拍摄，不保留原始二维投影。';
  const cameraLine = `${cameraStart ? '把相机从已记录的起始机位移动到' : '把相机移到'}${compactYawDescription(yaw)}、${compactPitchDescription(target.pitch)}的位置${compactOpticsDescription(target)}重新拍摄同一个人物和同一个场景。`;
  const changeLine = options?.hasGuideReference
    ? `这是一张从新机位真实重新拍摄的画面：人物和整个场景都必须按目标机位重建。按图2执行人物在画框内的位置、比例与裁切；按目标 yaw、pitch、焦段和距离改变脸部、身体、前景、中景、背景的透视、可见面、相对位移与遮挡关系。禁止复用图1的二维投影、整图旋转、只改裁切或把原始正面背景贴回去。镜头变化优先于逐像素身份稳定；大角度绕拍时允许少量细节漂移，以保证明显的侧面/背面与环境视差。${compactPerspectiveGuard(yaw)}`
    : '这是一张从新机位真实重新拍摄的画面：人物和整个场景都必须随相机改变透视、可见面和遮挡关系；禁止复用原始二维投影、整图旋转或只改裁切。镜头变化优先于逐像素身份稳定。';
  const roll = compactRollDescription(target.roll);
  return [referenceLine, cameraLine, changeLine, roll, userNote ? `补充要求：${userNote}` : ''].filter(Boolean).join('\n');
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
