import type { ClientReferenceImage } from '@/lib/types';

export type SubjectType = 'unknown' | 'person' | 'character' | 'product' | 'object' | 'vehicle' | 'building' | 'interior' | 'landscape' | 'street' | 'scene';
export type ViewMode = 'object-orbit' | 'camera-view';
export type LightingState = {
  enabled: boolean;
  azimuth: number;
  elevation: number;
  intensity: number;
  softness: number;
  temperature: number;
  fill: number;
  anchor: 'camera' | 'reference';
};
export type ViewpointOptions = {
  version: 2;
  subjectType: SubjectType;
  mode: ViewMode;
  modeSource: 'auto' | 'manual';
  changeView: boolean;
  guide: boolean;
  lighting: LightingState;
};

export const SUBJECT_OPTIONS: { value: SubjectType; label: string }[] = [
  { value: 'unknown', label: '通用' }, { value: 'person', label: '人物' },
  { value: 'character', label: '角色' }, { value: 'product', label: '商品' },
  { value: 'object', label: '物体' }, { value: 'vehicle', label: '车辆' },
  { value: 'building', label: '建筑' }, { value: 'interior', label: '室内' },
  { value: 'landscape', label: '风景' }, { value: 'street', label: '街道' },
  { value: 'scene', label: '复杂场景' },
];
export const LIGHTING_DEFAULTS: LightingState = {
  enabled: false, azimuth: -45, elevation: 35, intensity: 1, softness: 0.6,
  temperature: 5500, fill: 0.3, anchor: 'camera',
};
export const LIGHTING_PRESETS = [
  { name: '柔和正光', azimuth: 0, elevation: 25, softness: 0.85, temperature: 5500, fill: 0.6, intensity: 1 },
  { name: '左侧塑形', azimuth: -60, elevation: 35, softness: 0.35, temperature: 5500, fill: 0.15, intensity: 1 },
  { name: '右侧塑形', azimuth: 60, elevation: 35, softness: 0.35, temperature: 5500, fill: 0.15, intensity: 1 },
  { name: '逆光轮廓', azimuth: 160, elevation: 20, softness: 0.25, temperature: 6000, fill: 0.2, intensity: 1.4 },
  { name: '落日光', azimuth: -70, elevation: 12, softness: 0.2, temperature: 3200, fill: 0.2, intensity: 1.2 },
  { name: '阴天漫射', azimuth: 0, elevation: 70, softness: 1, temperature: 6500, fill: 0.85, intensity: 0.8 },
];
export const REFERENCE_VIEW_PRESETS: AnglePreset[] = [
  { id: 'reference', label: '原图视角', yaw: 0, pitch: 0 },
  { id: 'left-front', label: '左转 45°', yaw: -45, pitch: 0 },
  { id: 'right-front', label: '右转 45°', yaw: 45, pitch: 0 },
  { id: 'left', label: '左转 90°', yaw: -90, pitch: 0 },
  { id: 'right', label: '右转 90°', yaw: 90, pitch: 0 },
  { id: 'rear-left', label: '左转 135°', yaw: -135, pitch: 0 },
  { id: 'rear-right', label: '右转 135°', yaw: 135, pitch: 0 },
  { id: 'rear', label: '反向 180°', yaw: 180, pitch: 0 },
];

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
  /** Missing on legacy, anatomical-coordinate records. Never reinterpret those as relative angles. */
  viewpoint?: ViewpointOptions;
};

export type LegacyAngleCameraInput = Partial<AngleCameraState> & {
  /** Removed in the final-camera workflow; retained only for read-time migration. */
  subjectYaw?: number;
};

export type AngleGenerationInput = {
  reference: ClientReferenceImage;
  guideReference?: ClientReferenceImage;
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

export type AngleTargetSemantic = {
  difficulty: {
    level: AngleTargetDifficulty;
    yaw_abs_deg: number;
    pitch_abs_deg: number;
    reason: 'small_reprojection' | 'moderate_reprojection' | 'large_reprojection';
  };
  camera_motion: 'orbit_only' | 'camera_view' | 'none';
  subject_motion: 'none';
  horizontal_view: {
    class: 'frontal' | 'three_quarter' | 'profile' | 'rear_three_quarter' | 'rear';
    strength: 'near' | 'slight' | 'clear' | 'strong' | 'dominant';
    side: 'front' | 'anatomical_right' | 'anatomical_left' | 'back' | 'reference_right' | 'reference_left';
    angle_deg: number;
    instruction: string;
  };
  vertical_view: {
    class: 'eye_level' | 'low_angle' | 'high_angle';
    strength: 'level' | 'slight' | 'clear';
    direction: 'level' | 'upward' | 'downward';
    angle_deg: number;
    instruction: string;
  };
  perspective: {
    focal_length_mm: number;
    focal_class: 'wide' | 'moderately_wide' | 'normal' | 'short_telephoto' | 'telephoto';
    focal_instruction: string;
    distance_multiplier: number;
    distance_class: 'close' | 'relatively_close' | 'medium' | 'far' | 'environmental';
    distance_instruction: string;
  };
  framing: {
    aspect_ratio?: string;
    width?: number;
    height?: number;
    frame_offset_x_pct: number;
    frame_offset_y_pct: number;
  };
  roll: {
    generation: 'level';
    postprocess_degrees: number;
  };
};

export type AngleTargetDifficulty = 'low' | 'medium' | 'high';

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

export const VIEWPOINT_LIMITS: Record<AngleNumericKey, readonly [number, number]> = {
  yaw: [-180, 180], pitch: [-60, 60], roll: [-45, 45], focal: [14, 200],
  distance: [0.55, 11], frameX: [-50, 50], frameY: [-50, 50],
};

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
  const legacySubjectYaw = !raw.viewpoint && typeof raw.subjectYaw === 'number' && Number.isFinite(raw.subjectYaw) ? raw.subjectYaw : 0;
  const rawYaw = typeof raw.yaw === 'number' ? raw.yaw : ANGLE_DEFAULTS.yaw;
  const next = { ...ANGLE_DEFAULTS, ...raw, yaw: rawYaw - legacySubjectYaw };
  const normalized: AngleCameraState = {
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
  if (raw.viewpoint?.version === 2) {
    normalized.viewpoint = normalizeViewpointOptions(raw.viewpoint);
    normalized.yaw = effectiveAngle(normalized.yaw);
    for (const key of ['pitch', 'focal', 'distance', 'frameX', 'frameY', 'roll'] as const) {
      const [min, max] = VIEWPOINT_LIMITS[key];
      normalized[key] = bounded(next[key], ANGLE_DEFAULTS[key], min, max);
    }
  }
  return normalized;
}

function bounded(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

export function defaultViewMode(subjectType: SubjectType): ViewMode {
  return ['building', 'interior', 'landscape', 'street', 'scene'].includes(subjectType) ? 'camera-view' : 'object-orbit';
}

export function normalizeViewpointOptions(input?: Partial<Omit<ViewpointOptions, 'lighting'>> & { lighting?: Partial<LightingState> }): ViewpointOptions {
  const light = input?.lighting || {};
  const subjectType = SUBJECT_OPTIONS.some((option) => option.value === input?.subjectType) ? input!.subjectType! : 'unknown';
  return {
    version: 2,
    subjectType,
    mode: input?.mode === 'camera-view' || input?.mode === 'object-orbit' ? input.mode : defaultViewMode(subjectType),
    modeSource: input?.modeSource === 'manual' ? 'manual' : 'auto',
    changeView: input?.changeView !== false,
    guide: input?.guide === true,
    lighting: {
      enabled: light.enabled === true,
      azimuth: bounded(light.azimuth, LIGHTING_DEFAULTS.azimuth, -180, 180),
      elevation: bounded(light.elevation, LIGHTING_DEFAULTS.elevation, 0, 90),
      intensity: bounded(light.intensity, LIGHTING_DEFAULTS.intensity, 0.1, 2),
      softness: bounded(light.softness, LIGHTING_DEFAULTS.softness, 0, 1),
      temperature: bounded(light.temperature, LIGHTING_DEFAULTS.temperature, 2500, 10000),
      fill: bounded(light.fill, LIGHTING_DEFAULTS.fill, 0, 1),
      anchor: light.anchor === 'reference' ? 'reference' : 'camera',
    },
  };
}

/** Strict request boundary; stored settings use the tolerant normalizer instead. */
export function readViewpointOptions(value: unknown): ViewpointOptions | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('camera.viewpoint must be an object');
  const raw = value as Record<string, unknown>;
  if (raw.version !== 2) throw new Error('Unsupported viewpoint version');
  if (raw.subjectType !== undefined && !SUBJECT_OPTIONS.some((option) => option.value === raw.subjectType)) throw new Error('Invalid subject type');
  if (raw.mode !== undefined && raw.mode !== 'object-orbit' && raw.mode !== 'camera-view') throw new Error('Invalid view mode');
  if (raw.modeSource !== undefined && raw.modeSource !== 'auto' && raw.modeSource !== 'manual') throw new Error('Invalid mode source');
  for (const name of ['changeView', 'guide']) {
    if (raw[name] !== undefined && typeof raw[name] !== 'boolean') throw new Error(`camera.viewpoint.${name} must be boolean`);
  }
  if (raw.lighting !== undefined) {
    if (!raw.lighting || typeof raw.lighting !== 'object' || Array.isArray(raw.lighting)) throw new Error('Invalid lighting');
    const light = raw.lighting as Record<string, unknown>;
    if (light.enabled !== undefined && typeof light.enabled !== 'boolean') throw new Error('lighting.enabled must be boolean');
    if (light.anchor !== undefined && light.anchor !== 'camera' && light.anchor !== 'reference') throw new Error('Invalid lighting anchor');
    for (const [name, min, max] of [['azimuth', -180, 180], ['elevation', 0, 90], ['intensity', 0.1, 2], ['softness', 0, 1], ['temperature', 2500, 10000], ['fill', 0, 1]] as const) {
      const number = light[name];
      if (number !== undefined && (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max)) throw new Error(`lighting.${name} must be between ${min} and ${max}`);
    }
  }
  return normalizeViewpointOptions(raw as Partial<ViewpointOptions>);
}

export function createViewpointCamera(input?: Partial<AngleCameraState> | null): AngleCameraState {
  // Legacy absolute angles cannot identify the source camera. Start a fresh relative view.
  return normalizeAngleState(input?.viewpoint?.version === 2
    ? input
    : { ...ANGLE_DEFAULTS, modelId: input?.modelId || 'auto', viewpoint: normalizeViewpointOptions() });
}

export function referenceViewLabel(yaw: number) {
  const angle = effectiveAngle(yaw);
  if (Math.abs(angle) < 0.1) return '原图观察方向';
  if (angle === 180) return '相对原图反向观察';
  return `相对原图向${angle > 0 ? '右' : '左'} ${recordNumber(Math.abs(angle))}°`;
}

export function lightingDirectionLabel(light: LightingState) {
  const angle = effectiveAngle(light.azimuth);
  const side = angle < 0 ? '左' : '右';
  const magnitude = Math.abs(angle);
  const horizontal = magnitude < 15 ? '正前方' : magnitude < 75 ? `${side}前方` : magnitude < 105 ? `${side}侧` : magnitude < 165 ? `${side}后方` : '后方逆光';
  return `${horizontal} · 高度 ${recordNumber(light.elevation)}°`;
}

/** Shared reference-frame light direction for the preview and request audit. */
export function lightingDirection(light: LightingState, cameraYaw: number) {
  const yaw = (light.azimuth + (light.anchor === 'camera' ? cameraYaw : 0)) * Math.PI / 180;
  const elevation = light.elevation * Math.PI / 180;
  return { x: Math.sin(yaw) * Math.cos(elevation), y: Math.sin(elevation), z: Math.cos(yaw) * Math.cos(elevation) };
}

export function focalLengthToFov(focal: number) {
  const safeFocal = Math.max(1, Number(focal) || ANGLE_DEFAULTS.focal);
  return (2 * Math.atan(36 / (2 * safeFocal)) * 180) / Math.PI;
}

/** Yaw is now directly relative to the subject's fixed anatomical front. */
export function relativeViewYaw(camera: Pick<AngleCameraState, 'yaw'>) {
  return roundAngleRecordValue(effectiveAngle(camera.yaw));
}

/** Returns the direction in which the subject's anatomical front projects on screen. */
export function screenFacingDirection(yaw: number) {
  const angle = effectiveAngle(yaw);
  if (Math.abs(angle) <= 10) return '画面近乎正面';
  return angle > 0 ? '人物正面朝画面左侧' : '人物正面朝画面右侧';
}

/** One-click visual calibration for the common left/right reference mismatch. */
export function flipHorizontalYaw(yaw: number) {
  const angle = effectiveAngle(yaw);
  return roundAngleRecordValue(angle === 180 ? 180 : -angle);
}

/**
 * Estimates how much unseen 3D structure the image model must infer. This is
 * a user-facing difficulty hint, not a claim that the rendered angle is
 * physically measurable from the source image.
 */
export function angleTargetDifficulty(camera: Pick<AngleCameraState, 'yaw' | 'pitch'>): AngleTargetDifficulty {
  const yaw = Math.abs(effectiveAngle(camera.yaw));
  const pitch = Math.abs(roundAngleRecordValue(camera.pitch));
  if (yaw >= 60 || pitch >= 30 || yaw + pitch >= 75) return 'high';
  if (yaw >= 30 || pitch >= 15 || yaw + pitch >= 40) return 'medium';
  return 'low';
}

function targetDifficultySemantic(camera: Pick<AngleCameraState, 'yaw' | 'pitch'>): AngleTargetSemantic['difficulty'] {
  const yaw = Math.abs(effectiveAngle(camera.yaw));
  const pitch = Math.abs(roundAngleRecordValue(camera.pitch));
  const level = angleTargetDifficulty(camera);
  return {
    level,
    yaw_abs_deg: roundAngleRecordValue(yaw),
    pitch_abs_deg: roundAngleRecordValue(pitch),
    reason: level === 'high' ? 'large_reprojection' : level === 'medium' ? 'moderate_reprojection' : 'small_reprojection',
  };
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

function horizontalTargetSemantic(yaw: number): AngleTargetSemantic['horizontal_view'] {
  const angle = relativeViewYaw({ yaw });
  const magnitude = Math.abs(angle);
  const side = angle >= 0 ? 'anatomical_right' : 'anatomical_left';
  const sideLabel = angle >= 0 ? 'RIGHT' : 'LEFT';
  const sidePhrase = angle >= 0 ? 'the SUBJECT\'s anatomical RIGHT side' : 'the SUBJECT\'s anatomical LEFT side';
  if (magnitude <= 10) {
    return {
      class: 'frontal',
      strength: 'near',
      side: 'front',
      angle_deg: magnitude,
      instruction: `The CAMERA is physically in front of the stationary SUBJECT, centered on the anatomical front, at approximately ${recordNumber(magnitude)} degrees.`,
    };
  }
  if (magnitude <= 25) {
    return {
      class: 'three_quarter',
      strength: 'slight',
      side,
      angle_deg: magnitude,
      instruction: `The CAMERA is physically located toward ${sidePhrase}, approximately ${recordNumber(magnitude)} degrees around from the frontal direction. Produce a slight ${sideLabel.toLowerCase()} three-quarter view.`,
    };
  }
  if (magnitude <= 45) {
    return {
      class: 'three_quarter',
      strength: 'clear',
      side,
      angle_deg: magnitude,
      instruction: `The CAMERA is physically located toward ${sidePhrase}, approximately ${recordNumber(magnitude)} degrees around from the frontal direction. Produce a clear, obvious ${sideLabel.toLowerCase()} three-quarter view, not a frontal or near-frontal portrait.`,
    };
  }
  if (magnitude <= 70) {
    return {
      class: 'three_quarter',
      strength: 'strong',
      side,
      angle_deg: magnitude,
      instruction: `The CAMERA is physically located toward ${sidePhrase}, approximately ${recordNumber(magnitude)} degrees around from the frontal direction. Produce a strong ${sideLabel.toLowerCase()} three-quarter view approaching profile; the side geometry must be visibly dominant.`,
    };
  }
  if (magnitude <= 105) {
    return {
      class: 'profile',
      strength: 'dominant',
      side,
      angle_deg: magnitude,
      instruction: `The CAMERA is physically located on ${sidePhrase}, approximately ${recordNumber(magnitude)} degrees around from the frontal direction. Produce a true ${sideLabel.toLowerCase()} profile or near-profile view with side geometry dominant.`,
    };
  }
  if (magnitude <= 150) {
    return {
      class: 'rear_three_quarter',
      strength: 'strong',
      side,
      angle_deg: magnitude,
      instruction: `The CAMERA is physically located toward ${sidePhrase} and toward the back, approximately ${recordNumber(magnitude)} degrees around from the frontal direction. Produce a clear ${sideLabel.toLowerCase()} rear three-quarter view with back geometry dominant.`,
    };
  }
  return {
    class: 'rear',
    strength: 'dominant',
    side: 'back',
    angle_deg: magnitude,
    instruction: `The CAMERA is physically behind the stationary SUBJECT, approximately ${recordNumber(magnitude)} degrees around from the frontal direction. The anatomical back must be dominant; do not turn the SUBJECT to reveal a frontal face.`,
  };
}

function verticalTargetSemantic(pitch: number): AngleTargetSemantic['vertical_view'] {
  const angle = roundAngleRecordValue(pitch);
  const magnitude = Math.abs(angle);
  if (angle > 8) {
    return {
      class: 'low_angle',
      strength: angle >= 30 ? 'clear' : 'slight',
      direction: 'upward',
      angle_deg: magnitude,
      instruction: `The CAMERA is below the SUBJECT's eye level and looks UPWARD toward the subject by approximately ${recordNumber(magnitude)} degrees.`,
    };
  }
  if (angle < -8) {
    return {
      class: 'high_angle',
      strength: angle <= -30 ? 'clear' : 'slight',
      direction: 'downward',
      angle_deg: magnitude,
      instruction: `The CAMERA is clearly ABOVE the SUBJECT's eye level and looks DOWNWARD toward the subject by approximately ${recordNumber(magnitude)} degrees.`,
    };
  }
  return {
    class: 'eye_level',
    strength: 'level',
    direction: 'level',
    angle_deg: magnitude,
    instruction: 'The CAMERA is approximately level with the SUBJECT\'s eye line, with no intentional high-angle or low-angle view.',
  };
}

function focalClass(focal: number): AngleTargetSemantic['perspective']['focal_class'] {
  const value = Math.max(0.1, Number(focal) || ANGLE_DEFAULTS.focal);
  if (value <= 28) return 'wide';
  if (value <= 40) return 'moderately_wide';
  if (value <= 65) return 'normal';
  if (value <= 105) return 'short_telephoto';
  return 'telephoto';
}

function distanceClass(distance: number): AngleTargetSemantic['perspective']['distance_class'] {
  const value = Math.max(0.05, Number(distance) || ANGLE_DEFAULTS.distance);
  if (value <= 1) return 'close';
  if (value <= 1.8) return 'relatively_close';
  if (value <= 3) return 'medium';
  if (value <= 5) return 'far';
  return 'environmental';
}

export function generationCamera(camera: AngleCameraState): AngleCameraState {
  return camera.viewpoint && !camera.viewpoint.changeView
    ? normalizeAngleState({ ...camera, ...ANGLE_DEFAULTS, modelId: camera.modelId, viewpoint: camera.viewpoint })
    : normalizeAngleState(camera);
}

export function buildAngleTargetSemantic(camera: Pick<AngleCameraState, 'yaw' | 'pitch' | 'roll' | 'focal' | 'distance' | 'frameX' | 'frameY' | 'viewpoint'>, output?: Pick<AngleOutputSpec, 'aspectRatio' | 'width' | 'height'>): AngleTargetSemantic {
  const target = generationCamera(normalizeAngleState(camera));
  const focal = Math.max(0.1, Number(target.focal) || ANGLE_DEFAULTS.focal);
  const distance = Math.max(0.05, Number(target.distance) || ANGLE_DEFAULTS.distance);
  const horizontal = horizontalTargetSemantic(target.yaw);
  const vertical = verticalTargetSemantic(target.pitch);
  if (target.viewpoint) {
    const yaw = effectiveAngle(target.yaw);
    horizontal.side = Math.abs(yaw) < 0.1 ? 'front' : yaw >= 0 ? 'reference_right' : 'reference_left';
    horizontal.instruction = Math.abs(yaw) < 0.1
      ? 'Keep the horizontal camera direction of the reference image.'
      : `Move the CAMERA approximately ${recordNumber(Math.abs(yaw))} degrees to the ${yaw > 0 ? 'RIGHT' : 'LEFT'} relative to the reference camera viewpoint, not the subject's assumed front.`;
    vertical.instruction = Math.abs(target.pitch) < 0.1
      ? 'Keep the camera elevation of the reference image.'
      : `Move the camera ${target.pitch < 0 ? 'HIGHER, looking DOWNWARD' : 'LOWER, looking UPWARD'} by approximately ${recordNumber(Math.abs(target.pitch))} degrees relative to the reference viewpoint.`;
  }
  return {
    difficulty: targetDifficultySemantic(target),
    camera_motion: target.viewpoint?.changeView === false ? 'none' : target.viewpoint?.mode === 'camera-view' ? 'camera_view' : 'orbit_only',
    subject_motion: 'none',
    horizontal_view: horizontal,
    vertical_view: vertical,
    perspective: {
      focal_length_mm: Math.round(focal),
      focal_class: focalClass(focal),
      focal_instruction: focalViewDescription(focal),
      distance_multiplier: Number((target.viewpoint ? distance / ANGLE_DEFAULTS.distance : distance).toFixed(3)),
      distance_class: distanceClass(distance),
      distance_instruction: distanceViewDescription(distance),
    },
    framing: {
      ...(output ? { aspect_ratio: output.aspectRatio, width: output.width, height: output.height } : {}),
      frame_offset_x_pct: Number(target.frameX.toFixed(1)),
      frame_offset_y_pct: Number(target.frameY.toFixed(1)),
    },
    roll: {
      generation: 'level',
      postprocess_degrees: Number(effectiveAngle(target.roll).toFixed(1)),
    },
  };
}

const SUBJECT_CONSISTENCY: Record<SubjectType, string> = {
  unknown: 'Preserve the recognizable primary content, identity, structure, proportions, materials, colors, layout and spatial relationships.',
  person: 'Preserve the same person: identity, facial structure, hairstyle, skin tone, clothing, accessories, body proportions and world-space pose.',
  character: 'Preserve the same character: recognizable design, face, hair, costume, accessories, proportions, materials and world-space pose.',
  product: 'Preserve the exact same product: geometry, construction, materials, textures, colors, logos, branding and design details. Do not substitute another product.',
  object: 'Preserve the same object: shape, geometry, proportions, construction, materials, colors and distinguishing details.',
  vehicle: 'Preserve the exact same vehicle model, body shape, proportions, wheels, lights, windows, paint and trim. Do not substitute another vehicle.',
  building: 'Preserve the same building: architecture, facade, windows, entrances, materials, proportions, site and surrounding context.',
  interior: 'Preserve the same interior: room geometry, walls, windows, doors, furniture arrangement, materials and major objects.',
  landscape: 'Preserve the same landscape: terrain, vegetation, landmarks, structures and environmental identity.',
  street: 'Preserve the same street: roads, buildings, landmarks, major objects and their spatial relationships.',
  scene: 'Preserve the same environment, major subjects, recognizable landmarks, structures and spatial relationships.',
};

export function buildLightingPrompt(light: LightingState) {
  if (!light.enabled) return 'Preserve the original world-space illumination, light sources and shadow relationships unless the USER REQUEST explicitly asks to change them.';
  const angle = effectiveAngle(light.azimuth);
  const magnitude = Math.abs(angle);
  const side = angle < 0 ? 'LEFT' : 'RIGHT';
  const direction = magnitude < 15 ? 'FRONT' : magnitude < 75 ? `FRONT-${side}` : magnitude < 105 ? side : magnitude < 165 ? `REAR-${side}` : 'REAR (backlighting)';
  return [
    `RELIGHT the same content. Replace the original dominant lighting with a key light from ${direction}, approximately ${recordNumber(magnitude)} degrees ${angle < 0 ? 'left' : 'right'} of ${light.anchor === 'camera' ? 'the FINAL camera horizontal bearing' : 'the ORIGINAL reference camera horizontal bearing, fixed in the scene even when the camera moves'}.`,
    `Light source elevation: ${recordNumber(light.elevation)} degrees above the scene's horizontal plane. ${light.elevation <= 20 ? 'Use low grazing light and longer plausible cast shadows.' : light.elevation >= 65 ? 'Use overhead illumination with shorter ground shadows.' : 'Use elevated directional illumination with coherent cast shadows.'}`,
    `Key light strength: ${recordNumber(light.intensity)}x relative creative exposure, ${light.intensity < 0.7 ? 'subdued' : light.intensity > 1.3 ? 'strong' : 'balanced'}. Preserve highlight detail; do not change material colors to simulate exposure.`,
    `Source softness: ${Math.round(light.softness * 100)}%. ${light.softness < 0.3 ? 'Small hard source, crisp shadow edges.' : light.softness > 0.7 ? 'Large diffuse source, soft broad shadow transitions.' : 'Moderately soft source with readable shadow boundaries.'}`,
    `Approximate key color temperature: ${Math.round(light.temperature)}K, ${light.temperature < 4200 ? 'warm light' : light.temperature > 6500 ? 'cool light' : 'neutral daylight'}. Keep intrinsic surface colors recognizable.`,
    `Ambient fill: ${Math.round(light.fill * 100)}% of key strength. ${light.fill < 0.25 ? 'Deep shadow contrast with readable detail.' : light.fill > 0.65 ? 'Lifted shadows and low contrast.' : 'Balanced light-to-shadow contrast.'}`,
    'Recompute illumination, highlights, reflections, contact shadows and cast shadows coherently on the subject AND surrounding surfaces. Shadows fall away from the light and respect geometry and occlusion; do not paint a flat gradient or keep contradictory original shadows.',
    'Do not introduce a visible lamp, sun, light diagram or extra object. Lighting values are creative targets, not measured photometric reconstruction.',
  ].join('\n');
}

export function buildReferenceViewpointPrompt(note: string, input: AngleCameraState, options?: { hasGuideReference?: boolean; output?: Pick<AngleOutputSpec, 'aspectRatio' | 'width' | 'height'> }) {
  const camera = generationCamera(input);
  const view = normalizeViewpointOptions(camera.viewpoint);
  const hasGuideReference = view.changeView && view.guide && options?.hasGuideReference === true;
  const semantic = buildAngleTargetSemantic(camera, options?.output);
  const magnitude = Math.max(Math.abs(camera.yaw), Math.abs(camera.pitch));
  const distance = camera.distance / ANGLE_DEFAULTS.distance;
  return [
    `TASK\n${view.changeView ? 'Reconstruct a new camera view of the SAME content shown in Image 1.' : 'Relight or edit Image 1 while keeping its camera viewpoint, perspective, framing, composition and all object positions unchanged.'}`,
    [
      'REFERENCE IDENTITY',
      'Image 1 is the ORIGINAL primary reference, not an intermediate generated view.',
      SUBJECT_CONSISTENCY[view.subjectType],
      'Do not redesign or replace recognizable content. An explicit user-requested redesign is an exception only for the requested attributes.',
      hasGuideReference ? 'Image 2 is an OPTIONAL abstract CAMERA COMPOSITION guide only. Never copy its proxy geometry, identity, materials, lighting, background or render style. Where proxy shape conflicts with Image 1, preserve Image 1.' : '',
    ].filter(Boolean).join('\n'),
    view.changeView ? [
      'CAMERA VIEWPOINT',
      'All angles are RELATIVE to the original reference camera. Zero means the reference view, NOT an assumed anatomical or product front.',
      view.mode === 'object-orbit'
        ? 'Orbit the CAMERA around the stationary primary subject. Keep subject pose and surrounding objects fixed in world space; change visibility, overlap and perspective naturally.'
        : 'Move the CAMERA within the same physical environment and redirect its view toward overlapping scene landmarks. Do not rotate the room, furniture, landscape or entire scene as an object.',
      semantic.horizontal_view.instruction,
      semantic.vertical_view.instruction,
      'This is a camera change, not a head turn, subject rotation, mirror flip, flat image rotation, crop or perspective warp.',
    ].join('\n') : '',
    view.changeView ? [
      'DISTANCE AND FRAMING',
      Math.abs(distance - 1) < 0.02
        ? 'Keep a natural camera distance and framing comparable to Image 1.'
        : `Use approximately ${Number(distance.toFixed(3))}x the reference camera distance: ${distance < 1 ? view.mode === 'camera-view' ? 'move closer into the environment, with tighter framing' : 'move closer to the subject, with tighter framing' : 'pull the camera back and reveal more surrounding context'}.`,
      camera.focal === 50 ? 'Use a natural perspective consistent with the reference.' : `Use approximately ${recordNumber(camera.focal)}mm-equivalent lens language: ${focalViewDescription(camera.focal)}.`,
      camera.frameX || camera.frameY ? `Place the primary subject ${recordNumber(Math.abs(camera.frameX))}% ${camera.frameX < 0 ? 'left' : 'right'} and ${recordNumber(Math.abs(camera.frameY))}% ${camera.frameY < 0 ? 'down' : 'up'} of frame center.` : 'Keep composition natural without unnecessary recentering.',
      hasGuideReference ? 'Use Image 2 only to assist target camera perspective and approximate framing; its generic silhouette is not a shape constraint.' : '',
    ].filter(Boolean).join('\n') : '',
    `LIGHTING\n${buildLightingPrompt(view.lighting)}`,
    note.trim() ? `USER REQUEST\n${note.trim()}\nApply these explicit edits while respecting the selected camera and lighting targets; otherwise preserve the reference content.` : '',
    view.changeView ? [
      'RECONSTRUCTION',
      magnitude <= 30 ? 'Make only the necessary camera change; maintain extremely high consistency with the reference.' : magnitude <= 90 ? 'Preserve visible identity and structural details while reconstructing newly visible surfaces.' : 'This view exposes substantial areas absent from the reference. Infer unseen surfaces conservatively from visible structural and design cues. Avoid unnecessary new details.',
      'Produce one coherent image with plausible geometry, occlusion and spatial continuity. Do not force an originally visible face or facade to remain visible from behind.',
    ].join('\n') : '',
    [
      'OUTPUT',
      options?.output ? `Output frame: ${options.output.width} x ${options.output.height}.` : '',
      !view.changeView ? 'Preserve the original image orientation. Do not level, rotate or crop the frame.' : compactRollDescription(camera.roll) || 'Generate a level frame without additional image roll.',
      'Return the finished image only, without diagrams, labels, text overlays or comparison panels.',
    ].filter(Boolean).join('\n'),
  ].filter(Boolean).join('\n\n');
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
  return horizontalTargetSemantic(yaw).instruction;
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

/** Shared provider prompt describing one authoritative final camera state. */
export function compileAngleTargetPrompt(note: string, camera: AngleCameraState, options?: { hasGuideReference?: boolean; output?: Pick<AngleOutputSpec, 'aspectRatio' | 'width' | 'height'>; cameraStart?: AngleCameraState | null }) {
  if (camera.viewpoint?.version === 2) return buildReferenceViewpointPrompt(note, camera, options);
  const target = normalizeAngleState(camera);
  const semantic = buildAngleTargetSemantic(target, options?.output);
  const userNote = note.trim();
  const referenceBlock = options?.hasGuideReference
    ? [
      'IMAGE ROLES',
      '图1是 SOURCE IMAGE：只从图1读取人物身份、脸部特征、发型、服装、姿态、场景、光照、色彩、材质与视觉风格。',
      '图2是 TARGET CAMERA GUIDE：把图2当作相机与构图标注，只读取目标相机位置、水平视角、上下视角、透视、主体比例、画面位置与裁切。',
      '图2中的中性轮廓、灰模或网格不是第二个人物；不要复制其外观、材质、灯光、背景或渲染风格。',
    ].join('\n')
    : [
      'IMAGE ROLES',
      '图1是 SOURCE IMAGE，也是人物身份、场景、光照、色彩、材质与视觉风格的唯一参考。',
      '按目标相机重新拍摄，不要复用图1的原始二维投影。',
    ].join('\n');
  const roll = compactRollDescription(semantic.roll.postprocess_degrees);
  const frameLine = options?.hasGuideReference
    ? semantic.framing.aspect_ratio && semantic.framing.width && semantic.framing.height
      ? `按图2匹配主体在画框中的比例、位置与裁切；目标输出比例为 ${semantic.framing.aspect_ratio}（${semantic.framing.width}×${semantic.framing.height}）。`
      : '按图2匹配主体在画框中的比例、位置与裁切。'
    : semantic.framing.aspect_ratio && semantic.framing.width && semantic.framing.height
      ? `保持主体在画面中的比例、位置与裁切合理；目标输出比例为 ${semantic.framing.aspect_ratio}（${semantic.framing.width}×${semantic.framing.height}）。`
      : '保持主体在画面中的比例、位置与裁切合理，并随目标相机调整。';
  const blocks = [
    'TASK\n从同一个时刻、同一个人物和同一个场景重新拍摄一张目标机位画面。',
    referenceBlock,
    [
      'PRIORITY',
      '1. Match the target CAMERA viewpoint from the final semantic target and Image 2.',
      '2. Keep the SUBJECT frozen in the same 3D world-space pose and relationships.',
      '3. Preserve identity and appearance where they are physically visible from the target camera.',
    ].join('\n'),
    [
      'CAMERA MOTION',
      `camera_motion: ${semantic.camera_motion}`,
      `subject_motion: ${semantic.subject_motion}`,
      'ONLY THE CAMERA MOVES.',
      'The SUBJECT remains frozen in the same world-space pose; do not rotate the head, torso or body, reposition the hands, or create a new pose.',
      'Preserve all 3D world-space relationships. Do NOT preserve the original 2D projection.',
      'Occlusion, overlap, visible surfaces and screen position may change naturally when required by the new camera viewpoint.',
    ].join('\n'),
    [
      'TARGET VIEW',
      `HORIZONTAL VIEW · ${semantic.horizontal_view.class} · ${semantic.horizontal_view.strength}`,
      semantic.horizontal_view.instruction,
      `VERTICAL VIEW · ${semantic.vertical_view.class} · ${semantic.vertical_view.strength}`,
      semantic.vertical_view.instruction,
    ].join('\n'),
    [
      'PERSPECTIVE',
      `LENS · approximately ${semantic.perspective.focal_length_mm}mm-equivalent · ${semantic.perspective.focal_instruction}.`,
      `DISTANCE · final camera distance ${semantic.perspective.distance_multiplier}× · ${semantic.perspective.distance_instruction}.`,
      'Treat lens and distance as visual perspective and subject-scale targets, not as a request for physically exact camera simulation.',
    ].join('\n'),
    `FRAMING\n${frameLine} 不要只裁切原图来制造角度；需要让人物、前景、中景和背景按照目标机位产生合理的透视、可见面、相对位移与遮挡关系。`,
    [
      'CHANGE ONLY',
      options?.hasGuideReference ? '只改变最终目标 CAMERA 视角，以及匹配图2所必需的透视、主体比例、位置和裁切。' : '只改变最终目标 CAMERA 视角，以及为匹配目标构图所必需的透视、主体比例、位置和裁切。',
      '禁止通过整图旋转、只改裁切、转动 SUBJECT、改变 Pose，或把原始二维投影贴回去伪造机位变化。',
    ].join('\n'),
    [
      'PRESERVE',
      '保持人物身份、脸部特征、发型、服装、配饰、身体比例、世界空间姿态、表情、场景、重要物体、光照方向、色彩、材质与视觉风格。',
      `允许换机位自然改变可见表面、遮挡、重叠和画面位置；不要为了保持正脸或原始投影而重设计人物${options?.hasGuideReference ? '，不要复制图2灰模外观' : ''}。`,
    ].join('\n'),
    [
      'OUTPUT',
      `生成一张连贯的基础水平画面；${roll || '生成阶段保持水平，Roll 不在导引图或模型阶段执行。'}`,
      userNote ? `OPTIONAL USER NOTE（不得覆盖上述机位和姿态约束）：${userNote}` : '',
    ].filter(Boolean).join('\n'),
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

export function buildAnglePayload(camera: AngleCameraState, modelLabel?: string, cameraStart?: AngleCameraState | null, output?: Pick<AngleOutputSpec, 'aspectRatio' | 'width' | 'height'>) {
  if (camera.viewpoint?.version === 2) {
    const target = generationCamera(camera);
    return {
      model: { id: target.modelId, label: modelLabel || target.modelId },
      camera: {
        ...compactCameraPayload(target),
        elevation_deg: -target.pitch,
        coordinate_system: 'reference-relative-v2',
        viewpoint: target.viewpoint,
        semantic_target: buildAngleTargetSemantic(target, output),
      },
      lighting_direction: lightingDirection(target.viewpoint!.lighting, target.yaw),
      instruction: 'reference_viewpoint_reconstruction',
    };
  }
  const rawState = normalizeAngleState(camera);
  const state = { ...rawState, yaw: effectiveAngle(rawState.yaw), pitch: effectiveAngle(rawState.pitch), roll: effectiveAngle(rawState.roll) };
  const startState = cameraStart ? normalizeAngleState(cameraStart) : null;
  const delta = startState ? deriveAngleDelta(startState, rawState) : null;
  const semanticTarget = buildAngleTargetSemantic(rawState, output);
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
      semantic_target: semanticTarget,
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
