'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MutableRefObject, PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ClientReferenceImage, RegistryModel } from '@/lib/types';
import type { GalleryItem } from '@/lib/client-history';
import ModelPicker from '@/components/ModelPicker';
import { getLastModelCall, recordModelCall } from '@/lib/model-preferences';
import { selectAutomaticModel } from '@/lib/model-selection';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';
import { ANGLE_DEFAULTS, angleName, buildAnglePayload, buildAngleTargetSemantic, cameraSemanticSummary, clampAngleValue, compileAngleTargetPrompt, createViewpointCamera, defaultViewMode, flipHorizontalYaw, generationCamera, LIGHTING_DEFAULTS, LIGHTING_PRESETS, lightingDirection, lightingDirectionLabel, normalizeAngleState, normalizeViewpointOptions, REFERENCE_VIEW_PRESETS, referenceViewLabel, resetViewpointCamera, shouldWarnLiteForAngle, SUBJECT_OPTIONS, type AngleCameraState, type AngleGenerationInput, type AngleNumericKey, type AngleOutputSpec, type LightingState, type ViewMode, type ViewpointOptions } from '@/lib/angle-control';

type AngleConsoleProps = {
  theme: 'light' | 'dark';
  reference: ClientReferenceImage | null;
  initialCamera?: AngleCameraState | null;
  initialCameraStart?: AngleCameraState | null;
  initialOutput?: AngleOutputSpec | null;
  initialNote?: string;
  /** Render the console as a canvas-owned workbench without touching global settings. */
  embedded?: boolean;
  onDraftChange?: (draft: AngleConsoleDraft) => void;
  models: RegistryModel[];
  defaultProviderId?: string | null;
  defaultProviderName?: string;
  defaultModelId?: string | null;
  results: GalleryItem[];
  busy: boolean;
  onReferenceFiles: (files: File[] | FileList) => void;
  onExit: () => void;
  onRemoveReference: () => void;
  onBrowseHistory: () => void;
  onGenerate: (input: AngleGenerationInput) => void | Promise<void>;
  onOpenResult: (item: GalleryItem) => void;
  openResultId?: string | null;
  suppressAutoOpenId?: string | null;
  onResultOpened?: (id: string) => void;
  onDownloadResult: (item: GalleryItem) => void | Promise<void>;
  onDownloadShare: (item: GalleryItem) => void | Promise<void>;
  onNotify: (message: string) => void;
};

export type AngleConsoleDraft = {
  camera: AngleCameraState;
  cameraStart: AngleCameraState | null;
  subjectType: ViewpointOptions['subjectType'];
  cameraMode: ViewMode;
  lighting: LightingState;
  angleNote: string;
  angleGuide: boolean;
  output: AngleOutputSpec;
};

type HumanMode = 'default' | 'natural' | 'outline' | 'gray' | 'custom' | 'object' | 'scene';
type ResultMode = 'single' | 'swipe' | 'split';
type CameraPatch = Partial<AngleCameraState>;
type GuideFramingLevel = 'unknown' | 'ready' | 'unavailable';
type GuideFramingStatus = {
  level: GuideFramingLevel;
  title: string;
  detail: string;
  visibleRatio?: number;
  subjectHeightRatio?: number;
  crop?: { left: number; right: number; top: number; bottom: number };
};
type OutputFrameRect = { left: number; top: number; width: number; height: number };
type GuideCaptureApi = { capture: (output: AngleOutputSpec) => Promise<ClientReferenceImage | null> };
type ThreePreviewRuntime = {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  miniRenderer: THREE.WebGLRenderer;
  guideRenderer: THREE.WebGLRenderer;
  orbitCamera: THREE.PerspectiveCamera;
  overviewCamera: THREE.PerspectiveCamera;
  virtualCamera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  helper: THREE.CameraHelper;
  camRig: THREE.Group;
  grid: THREE.GridHelper;
  floor: THREE.Mesh;
  subject: THREE.Group;
  defaultSubject: THREE.Object3D | null;
  customSubject: THREE.Object3D | null;
  proxy: THREE.Group;
  sceneProxy: THREE.Group;
  keyLight: THREE.DirectionalLight;
  fillLight: THREE.DirectionalLight;
  ambientLight: THREE.HemisphereLight;
  lightMarker: THREE.Mesh;
};

type AngleMenuOption<T extends string> = {
  value: T;
  label: string;
  hint?: string;
};

type AngleMenuProps<T extends string> = {
  label: string;
  value: T;
  options: AngleMenuOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  showLabel?: boolean;
};

const PREVIEW_OBJECT_OPTIONS: AngleMenuOption<HumanMode>[] = [
  { value: 'object', label: '通用主体', hint: '适合商品、车辆和建筑' },
  { value: 'scene', label: '复杂场景', hint: '适合室内、街景和风景' },
  { value: 'gray', label: '人物轮廓', hint: '只显示中性人体比例' },
  { value: 'default', label: '人物模型', hint: '用于人物姿态导引' },
  { value: 'custom', label: '导入 GLB', hint: '载入自定义三维参考' },
];

const LIGHT_ANCHOR_OPTIONS: AngleMenuOption<LightingState['anchor']>[] = [
  { value: 'camera', label: '跟随当前相机', hint: '光位随视角一起移动' },
  { value: 'reference', label: '固定在原图方向', hint: '保持原图世界方向' },
];

function AngleMenu<T extends string>({ label, value, options, onChange, ariaLabel, className = '', disabled = false, showLabel = false }: AngleMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)));
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const selected = options.find((option) => option.value === value) || options[0];
  const menuId = `angle-menu-${label.replace(/\s+/g, '-')}`;

  function updatePosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const gap = 6;
    const width = Math.min(window.innerWidth - margin * 2, Math.max(rect.width, 220));
    const availableAbove = Math.max(0, rect.top - margin - gap);
    const availableBelow = Math.max(0, window.innerHeight - rect.bottom - margin - gap);
    const openAbove = availableAbove > availableBelow && availableAbove >= 160;
    const maxHeight = Math.max(112, Math.min(320, openAbove ? availableAbove : availableBelow));
    const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - width - margin));
    setMenuStyle({
      visibility: 'visible',
      left: Math.round(left),
      width: Math.round(width),
      maxHeight: Math.round(maxHeight),
      top: openAbove ? 'auto' : Math.round(rect.bottom + gap),
      bottom: openAbove ? Math.round(window.innerHeight - rect.top + gap) : 'auto',
    });
  }

  useEffect(() => {
    const nextIndex = Math.max(0, options.findIndex((option) => option.value === value));
    setActiveIndex(nextIndex);
  }, [options, value]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      updatePosition();
      optionRefs.current[activeIndex]?.focus();
    });
    const handleViewportChange = () => updatePosition();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('pointerdown', handleOutsidePointer);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('pointerdown', handleOutsidePointer);
    };
  }, [activeIndex, open]);

  function choose(nextValue: T, index: number) {
    onChange(nextValue);
    setActiveIndex(index);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!options.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (activeIndex + direction + options.length) % options.length;
      setActiveIndex(nextIndex);
      optionRefs.current[nextIndex]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0 : options.length - 1;
      setActiveIndex(nextIndex);
      optionRefs.current[nextIndex]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option.value, activeIndex);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  const menu = open && typeof document !== 'undefined' ? createPortal(
    <div
      ref={menuRef}
      className="angle-select-menu"
      style={menuStyle}
      id={menuId}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={`${menuId}-option-${activeIndex}`}
      onKeyDown={handleMenuKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="angle-select-menu-scroll">
        {options.map((option, index) => (
          <div
            ref={(node) => { optionRefs.current[index] = node; }}
            role="option"
            tabIndex={0}
            id={`${menuId}-option-${index}`}
            aria-selected={option.value === value}
            className={`angle-select-option ${option.value === value ? 'active' : ''}`}
            key={option.value}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => choose(option.value, index)}
          >
            <span><b>{option.label}</b>{option.hint && <small>{option.hint}</small>}</span>
            {option.value === value && <i aria-hidden="true">✓</i>}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  ) : null;

  return <div className={`angle-select ${className}`} ref={rootRef}>
    <button
      ref={triggerRef}
      type="button"
      className={`angle-select-trigger ${open ? 'open' : ''}`}
      onClick={() => { if (!disabled) setOpen((current) => !current); }}
      onKeyDown={handleTriggerKeyDown}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={menuId}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      <span className="angle-select-trigger-copy">{showLabel && <small>{label}</small>}<b>{selected?.label || '请选择'}</b></span>
      <i aria-hidden="true" />
    </button>
    {menu}
  </div>;
}

const DEFAULT_HUMAN_URL = '/models/sanmao-default-soldier.glb';
const SUBJECT_CENTER = new THREE.Vector3(0, 1.08, 0);

const ANGLE_VIEWED_RESULTS_KEY = 'sanmao-angle-viewed-results';

function readViewedAngleResultIds() {
  try {
    const value = JSON.parse(localStorage.getItem(ANGLE_VIEWED_RESULTS_KEY) || '[]');
    return new Set<string>(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

function saveViewedAngleResultIds(ids: Set<string>) {
  try {
    localStorage.setItem(ANGLE_VIEWED_RESULTS_KEY, JSON.stringify(Array.from(ids).slice(-100)));
  } catch {}
}

const GUIDE_FRAMING_PENDING: GuideFramingStatus = {
  level: 'unknown',
  title: '正在准备输出画幅',
  detail: '空间代理和输出相机准备完成后，可生成可选构图导引图。',
};

function guideFramingLabel(level: GuideFramingLevel) {
  if (level === 'ready') return '输出画幅已就绪';
  if (level === 'unavailable') return '导引图不可用';
  return '正在准备输出画幅';
}

function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : Math.abs(a); }

function angleOutputFromDimensions(width: number, height: number): AngleOutputSpec {
  const referenceWidth = Math.max(1, Math.round(width));
  const referenceHeight = Math.max(1, Math.round(height));
  const ratio = referenceWidth / referenceHeight;
  let outputWidth = ratio >= 1 ? 1280 : Math.round((1280 * ratio) / 16) * 16;
  let outputHeight = ratio >= 1 ? Math.round((1280 / ratio) / 16) * 16 : 1280;
  outputWidth = Math.max(256, Math.min(1280, outputWidth));
  outputHeight = Math.max(256, Math.min(1280, outputHeight));
  const divisor = gcd(outputWidth, outputHeight) || 1;
  return { aspectRatio: `${outputWidth / divisor}:${outputHeight / divisor}`, width: outputWidth, height: outputHeight, referenceWidth, referenceHeight };
}

function fitOutputFrame(width: number, height: number, aspect: number): OutputFrameRect {
  const inset = Math.max(16, Math.min(30, Math.min(width, height) * 0.055));
  const availableWidth = Math.max(1, width - inset * 2);
  const availableHeight = Math.max(1, height - inset * 2);
  let frameWidth = availableWidth;
  let frameHeight = frameWidth / aspect;
  if (frameHeight > availableHeight) {
    frameHeight = availableHeight;
    frameWidth = frameHeight * aspect;
  }
  return { left: (width - frameWidth) / 2, top: (height - frameHeight) / 2, width: frameWidth, height: frameHeight };
}

function cameraBasis(state: AngleCameraState, aspect: number) {
  const yaw = THREE.MathUtils.degToRad(state.yaw);
  const pitch = THREE.MathUtils.degToRad(state.pitch);
  const radius = 5.4 * Math.max(1, aspect) * (state.distance / 2.2);
  const horizontal = radius * Math.cos(pitch);
  const offset = new THREE.Vector3(Math.sin(yaw) * horizontal, -Math.sin(pitch) * radius, Math.cos(yaw) * horizontal);
  const forward = offset.clone().normalize().multiplyScalar(-1);
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const verticalSpan = 2 * radius * Math.tan(THREE.MathUtils.degToRad(focalLengthToFovForPreview(state.focal, aspect)) / 2);
  return { radius, offset, right, up, verticalSpan, horizontalSpan: verticalSpan * aspect };
}

function focalLengthToFovForPreview(focal: number, aspect: number) {
  return (2 * Math.atan((35 / Math.max(1, aspect)) / (2 * Math.max(0.1, focal))) * 180) / Math.PI;
}

function targetFromFrameOffset(state: AngleCameraState, aspect: number) {
  const basis = cameraBasis(state, aspect);
  return SUBJECT_CENTER.clone()
    .addScaledVector(basis.right, -(state.frameX / 100) * basis.horizontalSpan)
    .addScaledVector(basis.up, -(state.frameY / 100) * basis.verticalSpan);
}

function frameOffsetFromTarget(state: AngleCameraState, target: THREE.Vector3, aspect: number) {
  const basis = cameraBasis(state, aspect);
  const offset = target.clone().sub(SUBJECT_CENTER);
  return {
    frameX: roundViewportValue(-(offset.dot(basis.right) / Math.max(0.0001, basis.horizontalSpan)) * 100),
    frameY: roundViewportValue(-(offset.dot(basis.up) / Math.max(0.0001, basis.verticalSpan)) * 100),
  };
}

function unwrapOrbitYaw(previousYaw: number, measuredYaw: number) {
  const previousEquivalent = ((previousYaw + 180) % 360 + 360) % 360 - 180;
  let delta = measuredYaw - previousEquivalent;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return previousYaw + delta;
}

function roundViewportValue(value: number, precision = 1) {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

function AngleNumberInput({ value, step, min, max, label, disabled, onCommit }: { value: number; step: number; min: number; max: number; label: string; disabled?: boolean; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(() => String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const next = Number(draft);
    const bounded = draft.trim() && Number.isFinite(next) ? Math.max(min, Math.min(max, next)) : value;
    setDraft(String(bounded));
    onCommit(bounded);
  };
  return <input className="angle-number" type="number" inputMode="decimal" min={min} max={max} step={step} disabled={disabled} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} aria-label={`${label}数值`} title={`${label} (${min} ~ ${max})`}/>;
}

function cssColor(value: string | undefined, fallback: string) {
  const raw = value?.trim();
  if (!raw) return new THREE.Color(fallback);
  try { return new THREE.Color(raw); } catch { return new THREE.Color(fallback); }
}

function createMannequin(scene: THREE.Scene, mode: 'natural' | 'outline' | 'gray' = 'natural') {
  const group = new THREE.Group();
  const isNeutral = mode === 'gray';
  const palettes: Record<'natural' | 'outline' | 'gray', number[]> = {
    natural: [0x8d6bff, 0xb9c8e8, 0xe3b38d, 0x222b3d],
    outline: [0x6f9de2, 0xb9d0f0, 0x8fb0d8, 0x1d2a3d],
    gray: [0x858b92, 0xa7adb3, 0xc8cdd1, 0x555b62],
  };
  const palette = palettes[mode];
  const materials = [
    new THREE.MeshStandardMaterial({ color: palette[0], roughness: 0.56 }),
    new THREE.MeshStandardMaterial({ color: palette[1], roughness: 0.64 }),
    new THREE.MeshStandardMaterial({ color: palette[2], roughness: 0.72 }),
    new THREE.MeshStandardMaterial({ color: palette[3], roughness: 0.74 }),
  ];
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number], scale: [number, number, number] = [1, 1, 1]) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const capsule = (a: [number, number, number], b: [number, number, number], radius: number, material: THREE.Material) => {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const length = direction.length();
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 8, 16), material);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  add(new THREE.SphereGeometry(1, 32, 22), materials[0], [0, 1.42, 0], [0.42, 0.5, 0.26]);
  add(new THREE.SphereGeometry(1, 28, 20), materials[1], [0, 1.08, -0.01], [0.32, 0.23, 0.22]);
  add(new THREE.SphereGeometry(1, 28, 20), materials[3], [0, 0.86, 0], [0.34, 0.2, 0.23]);
  add(new THREE.CylinderGeometry(0.1, 0.12, 0.22, 20), materials[2], [0, 1.76, 0]);
  add(new THREE.SphereGeometry(1, 32, 24), materials[2], [0, 2.03, 0.01], [0.26, 0.31, 0.25]);
  add(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, 1.52), materials[3], [0, 2.1, -0.01], [0.27, 0.26, 0.25]);
  if (isNeutral) {
    // The default guide is intentionally a composition proxy, not a second
    // person. A small +Z chest marker communicates the mannequin's anatomical
    // front without adding eyes, a face, clothing or pose cues.
    const frontMarker = add(new THREE.ConeGeometry(0.055, 0.16, 4), materials[1], [0, 1.48, 0.29]);
    frontMarker.rotation.x = Math.PI / 2;
    frontMarker.name = 'anatomical-front-marker';
  } else {
    // Direction-first anatomy: +Z is the mannequin's front. Detailed modes
    // remain available for operators who need a clearer human reference.
    add(new THREE.BoxGeometry(0.28, 0.22, 0.035), materials[1], [0, 2.02, 0.235]);
    const nose = add(new THREE.ConeGeometry(0.045, 0.13, 4), materials[2], [0, 2.05, 0.305]);
    nose.rotation.x = Math.PI / 2;
    add(new THREE.SphereGeometry(1, 20, 14), materials[1], [0, 1.86, 0.15], [0.14, 0.065, 0.09]);
    add(new THREE.SphereGeometry(0.025, 12, 8), materials[3], [-0.075, 2.06, 0.23]);
    add(new THREE.SphereGeometry(0.025, 12, 8), materials[3], [0.075, 2.06, 0.23]);
    add(new THREE.SphereGeometry(1, 28, 20), materials[2], [0, 1.43, 0.205], [0.29, 0.34, 0.075]);
    add(new THREE.CapsuleGeometry(0.035, 0.3, 6, 12), materials[1], [0, 1.43, 0.275]);
    add(new THREE.SphereGeometry(1, 24, 16), materials[1], [0, 0.93, 0.19], [0.255, 0.13, 0.065]);
    add(new THREE.SphereGeometry(1, 24, 16), materials[3], [0, 1.35, -0.235], [0.28, 0.31, 0.055]);
  }

  const leftShoulder: [number, number, number] = [-0.34, 1.55, 0];
  const rightShoulder: [number, number, number] = [0.34, 1.55, 0];
  const leftElbow: [number, number, number] = [-0.46, 1.2, 0.02];
  const rightElbow: [number, number, number] = [0.46, 1.2, 0.02];
  const leftWrist: [number, number, number] = [-0.42, 0.9, 0.04];
  const rightWrist: [number, number, number] = [0.42, 0.9, 0.04];
  add(new THREE.SphereGeometry(0.12, 18, 14), materials[0], leftShoulder);
  add(new THREE.SphereGeometry(0.12, 18, 14), materials[0], rightShoulder);
  capsule(leftShoulder, leftElbow, 0.09, materials[0]);
  capsule(rightShoulder, rightElbow, 0.09, materials[0]);
  add(new THREE.SphereGeometry(0.09, 16, 12), materials[1], leftElbow);
  add(new THREE.SphereGeometry(0.09, 16, 12), materials[1], rightElbow);
  capsule(leftElbow, leftWrist, 0.075, materials[2]);
  capsule(rightElbow, rightWrist, 0.075, materials[2]);

  const leftHip: [number, number, number] = [-0.17, 0.8, 0];
  const rightHip: [number, number, number] = [0.17, 0.8, 0];
  const leftKnee: [number, number, number] = [-0.18, 0.43, 0.01];
  const rightKnee: [number, number, number] = [0.18, 0.43, 0.01];
  const leftAnkle: [number, number, number] = [-0.18, 0.12, 0.02];
  const rightAnkle: [number, number, number] = [0.18, 0.12, 0.02];
  capsule(leftHip, leftKnee, 0.12, materials[3]);
  capsule(rightHip, rightKnee, 0.12, materials[3]);
  add(new THREE.SphereGeometry(0.115, 18, 14), materials[3], leftKnee);
  add(new THREE.SphereGeometry(0.115, 18, 14), materials[3], rightKnee);
  capsule(leftKnee, leftAnkle, 0.1, materials[3]);
  capsule(rightKnee, rightAnkle, 0.1, materials[3]);
  add(new THREE.SphereGeometry(1, 24, 16), materials[3], [-0.18, 0.08, 0.08], [0.14, 0.09, 0.23]);
  add(new THREE.SphereGeometry(1, 24, 16), materials[3], [0.18, 0.08, 0.08], [0.14, 0.09, 0.23]);

  group.userData.mannequinMaterials = materials;
  group.userData.anatomicalFrontAxis = '+Z';
  scene.add(group);
  return group;
}

function activeSubject(runtime: ThreePreviewRuntime) {
  if (runtime.proxy.visible) return runtime.proxy;
  if (runtime.sceneProxy.visible) return runtime.sceneProxy;
  if (runtime.customSubject?.visible) return runtime.customSubject;
  if (runtime.defaultSubject?.visible) return runtime.defaultSubject;
  return runtime.subject.visible ? runtime.subject : null;
}

function createViewProxy(scene: THREE.Scene, environment: boolean) {
  const group = new THREE.Group();
  const box = (size: [number, number, number], position: [number, number, number], color: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: 0.58 }));
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  if (environment) {
    box([1.3, 1.3, 1.1], [-0.9, 0.65, 0], 0xc7d3d0);
    box([0.8, 2.1, 0.8], [0.75, 1.05, -0.8], 0xc4ccd7);
    box([0.6, 0.6, 0.6], [0.9, 0.3, 0.8], 0xcbac78);
  } else {
    box([1.25, 1.8, 0.9], [0, 0.9, 0], 0xc7d3d0);
    box([0.48, 0.09, 0.03], [0, 1.52, 0.46], 0x32786e);
    box([0.08, 0.7, 0.03], [-0.4, 0.6, 0.46], 0xcbac78);
  }
  scene.add(group);
  return group;
}

function normalizeLoadedSubject(subject: THREE.Object3D, baseYaw = 0) {
  subject.rotation.y = baseYaw;
  subject.updateMatrixWorld(true);
  const initialBox = new THREE.Box3().setFromObject(subject);
  const initialSize = initialBox.getSize(new THREE.Vector3());
  subject.scale.multiplyScalar(2.15 / Math.max(initialSize.y, 0.01));
  subject.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(subject);
  const center = scaledBox.getCenter(new THREE.Vector3());
  subject.position.x -= center.x;
  subject.position.z -= center.z;
  subject.position.y -= scaledBox.min.y;
  subject.userData.baseYaw = baseYaw;
  subject.updateMatrixWorld(true);
}

function assessGuideFraming(runtime: ThreePreviewRuntime): GuideFramingStatus {
  const subject = activeSubject(runtime);
  if (!subject) return { level: 'unavailable', title: '空间代理尚未准备好', detail: '通用主体、场景代理或 GLB 加载完成后才能生成构图导引。' };

  runtime.scene.updateMatrixWorld(true);
  runtime.virtualCamera.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(subject);
  if (box.isEmpty()) return { level: 'unavailable', title: '无法读取空间代理', detail: '请重新载入空间预览对象。' };

  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z), new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z), new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z), new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z), new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];
  const projected = corners.map((corner) => corner.project(runtime.virtualCamera));
  if (projected.some((corner) => !Number.isFinite(corner.x) || !Number.isFinite(corner.y))) {
    return { level: 'unavailable', title: '当前相机投影无效', detail: '请执行全部重置后重试。' };
  }
  const minX = Math.min(...projected.map((corner) => corner.x));
  const maxX = Math.max(...projected.map((corner) => corner.x));
  const minY = Math.min(...projected.map((corner) => corner.y));
  const maxY = Math.max(...projected.map((corner) => corner.y));
  const width = maxX - minX;
  const height = maxY - minY;
  const visibleWidth = Math.max(0, Math.min(maxX, 1) - Math.max(minX, -1));
  const visibleHeight = Math.max(0, Math.min(maxY, 1) - Math.max(minY, -1));
  const visibleRatio = width > 0 && height > 0 ? Math.max(0, Math.min(100, (visibleWidth * visibleHeight) / (width * height) * 100)) : 0;
  const crop = {
    left: width > 0 ? Math.max(0, (-1 - minX) / width * 100) : 0,
    right: width > 0 ? Math.max(0, (maxX - 1) / width * 100) : 0,
    top: height > 0 ? Math.max(0, (maxY - 1) / height * 100) : 0,
    bottom: height > 0 ? Math.max(0, (-1 - minY) / height * 100) : 0,
  };
  const subjectHeightRatio = Math.max(0, Math.min(200, (height / 2) * 100));
  const roundedVisible = Math.round(visibleRatio);
  const roundedHeight = Math.round(subjectHeightRatio);
  return {
    level: 'ready',
    title: roundedVisible >= 99 ? '主体全部位于输出框内' : `主体包围框可见约 ${roundedVisible}%`,
    detail: `${roundedVisible >= 99 ? '可以继续拉近取近景' : '这是主动裁切预览'}；主体约占输出高度 ${roundedHeight}%，框内画面将作为可选构图参考图。`,
    visibleRatio,
    subjectHeightRatio,
    crop,
  };
}

function ThreeCameraPreview({ camera, output, theme, humanMode, customHumanFile, captureApiRef, miniHostRef, interaction = 'camera', onCameraChange, onFramingStatus, onNotify }: { camera: AngleCameraState; output: AngleOutputSpec; theme: 'light' | 'dark'; humanMode: HumanMode; customHumanFile: File | null; captureApiRef: MutableRefObject<GuideCaptureApi | null>; miniHostRef: MutableRefObject<HTMLDivElement | null>; interaction?: 'camera' | 'light'; onCameraChange: (patch: CameraPatch) => void; onFramingStatus: (status: GuideFramingStatus) => void; onNotify: (message: string) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef(camera);
  const outputRef = useRef(output);
  const humanModeRef = useRef(humanMode);
  const callbackRef = useRef(onCameraChange);
  const framingCallbackRef = useRef(onFramingStatus);
  const reportFramingRef = useRef<(() => void) | null>(null);
  const runtimeRef = useRef<ThreePreviewRuntime | null>(null);
  const lightDragRef = useRef<{ x: number; y: number; viewpoint: ViewpointOptions } | null>(null);
  const syncingRef = useRef(false);
  const gestureActiveRef = useRef(false);
  const pendingPatchRef = useRef<CameraPatch | null>(null);
  const changeAnimationRef = useRef(0);
  const [fallback, setFallback] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [frameRect, setFrameRect] = useState<OutputFrameRect>({ left: 20, top: 20, width: 100, height: 100 });
  const frameRectRef = useRef(frameRect);

  useEffect(() => { cameraRef.current = camera; }, [camera]);
  useEffect(() => { outputRef.current = output; }, [output]);
  useEffect(() => { humanModeRef.current = humanMode; }, [humanMode]);
  useEffect(() => { callbackRef.current = onCameraChange; }, [onCameraChange]);
  useEffect(() => { framingCallbackRef.current = onFramingStatus; }, [onFramingStatus]);

  useEffect(() => {
    const host = hostRef.current;
    const miniHost = miniHostRef.current;
    if (!host || !miniHost) return;
    let animationFrame = 0;
    let resizeObserver: ResizeObserver | null = null;
    try {
      const scene = new THREE.Scene();
      const orbitCamera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      host.appendChild(renderer.domElement);

      const miniRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      miniRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      miniRenderer.shadowMap.enabled = true;
      miniRenderer.shadowMap.type = THREE.PCFShadowMap;
      miniRenderer.outputColorSpace = THREE.SRGBColorSpace;
      miniRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      miniRenderer.toneMappingExposure = 1.05;
      miniHost.appendChild(miniRenderer.domElement);
      const guideRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      guideRenderer.setPixelRatio(1);
      guideRenderer.outputColorSpace = THREE.SRGBColorSpace;
      guideRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      guideRenderer.toneMappingExposure = 1.05;

      const hemi = new THREE.HemisphereLight(0xe3ecff, 0x172034, 1.55);
      scene.add(hemi);
      const key = new THREE.DirectionalLight(0xfff6ec, 2.8);
      key.position.set(3.8, 5.4, 4.8);
      key.castShadow = true;
      key.shadow.mapSize.set(768, 768);
      key.shadow.camera.left = -6;
      key.shadow.camera.right = 6;
      key.shadow.camera.top = 6;
      key.shadow.camera.bottom = -6;
      key.shadow.normalBias = 0.03;
      key.target.position.copy(SUBJECT_CENTER);
      scene.add(key.target);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xaec8ff, 1.15);
      fill.position.set(-3.4, 2.7, 3.3);
      scene.add(fill);
      const lightMarker = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd181 }));
      scene.add(lightMarker);

      const floor = new THREE.Mesh(new THREE.CircleGeometry(5.7, 96), new THREE.MeshStandardMaterial({ color: 0x101b2a, roughness: 0.9, metalness: 0.03 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.005;
      floor.receiveShadow = true;
      scene.add(floor);
      const grid = new THREE.GridHelper(8, 20, 0x6f8fbe, 0x283b57);
      grid.position.y = 0.02;
      const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
      gridMaterials.forEach((material) => {
        material.transparent = true;
        material.opacity = 0.52;
      });
      scene.add(grid);
      const subject = createMannequin(scene, humanModeRef.current === 'outline' ? 'outline' : humanModeRef.current === 'natural' ? 'natural' : 'gray');
      subject.visible = ['gray', 'natural', 'outline'].includes(humanModeRef.current);
      const proxy = createViewProxy(scene, false);
      proxy.visible = humanModeRef.current === 'object';
      const sceneProxy = createViewProxy(scene, true);
      sceneProxy.visible = humanModeRef.current === 'scene';

      const virtualCamera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
      const helper = new THREE.CameraHelper(virtualCamera);
      const helperMaterial = helper.material as THREE.LineBasicMaterial;
      helperMaterial.transparent = true;
      helperMaterial.opacity = 0.8;
      scene.add(helper);
      const camRig = new THREE.Group();
      scene.add(camRig);
      const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.2), new THREE.MeshStandardMaterial({ color: 0xd8e5f5, roughness: 0.4, metalness: 0.18 }));
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.092, 0.15, 24), new THREE.MeshStandardMaterial({ color: 0x26384e, roughness: 0.35, metalness: 0.28 }));
      lens.rotation.x = Math.PI / 2;
      lens.position.z = -0.09;
      camRig.add(camBody, lens);

      const controls = new OrbitControls(orbitCamera, renderer.domElement);
      controls.target.set(0, 1.08, 0);
      controls.enableDamping = true;
      controls.dampingFactor = 0.075;
      // Keep dragging within the same bounds as the controls and request.
      controls.enablePan = false;
      controls.screenSpacePanning = true;
      controls.panSpeed = 0.82;
      controls.minDistance = 1.35;
      controls.maxDistance = 27;
      controls.minPolarAngle = Math.PI / 6;
      controls.maxPolarAngle = Math.PI * 5 / 6;
      controls.zoomToCursor = false;
      controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
      controls.mouseButtons.RIGHT = THREE.MOUSE.DOLLY;

      const preventContextMenu = (event: MouseEvent) => event.preventDefault();
      const setNavigationKeyMode = (event: KeyboardEvent, active: boolean) => {
        const target = event.target as HTMLElement | null;
        if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
        if (event.key === '1') {
          controls.mouseButtons.LEFT = active ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
          event.preventDefault();
        } else if (event.key === '2') {
          controls.mouseButtons.LEFT = active ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
          event.preventDefault();
        } else if (event.key === '3') {
          controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
          event.preventDefault();
        }
      };
      const onNavigationKeyDown = (event: KeyboardEvent) => setNavigationKeyMode(event, true);
      const onNavigationKeyUp = (event: KeyboardEvent) => setNavigationKeyMode(event, false);
      renderer.domElement.addEventListener('contextmenu', preventContextMenu);
      window.addEventListener('keydown', onNavigationKeyDown);
      window.addEventListener('keyup', onNavigationKeyUp);

      const overviewCamera = new THREE.PerspectiveCamera(36, 1.3, 0.1, 50);
      overviewCamera.position.set(4, 4.1, 4.4);
      overviewCamera.lookAt(0, 1, 0);

      runtimeRef.current = { scene, renderer, miniRenderer, guideRenderer, orbitCamera, overviewCamera, virtualCamera, controls, helper, camRig, grid, floor, subject, defaultSubject: null, customSubject: null, proxy, sceneProxy, keyLight: key, fillLight: fill, ambientLight: hemi, lightMarker };
      const reportFraming = () => {
        const runtime = runtimeRef.current;
        if (runtime) framingCallbackRef.current(assessGuideFraming(runtime));
      };
      reportFramingRef.current = reportFraming;
      const neutralGuideMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa3af, roughness: 0.82, metalness: 0.02 });

      captureApiRef.current = {
        capture: async (captureOutput) => {
          const runtime = runtimeRef.current;
          const guideSubject = runtime ? activeSubject(runtime) : null;
          if (!runtime || !guideSubject) return null;
          const state = cameraRef.current;
          const aspect = captureOutput.width / captureOutput.height;
          const target = targetFromFrameOffset(state, aspect);
          const basis = cameraBasis(state, aspect);
          const guideCamera = new THREE.PerspectiveCamera(40, aspect, 0.05, 100);
          guideCamera.position.copy(target).add(basis.offset);
          guideCamera.setFocalLength(state.focal);
          guideCamera.lookAt(target);
          // Reference 2 always remains level. Roll is a deterministic
          // finished-image operation after the model has reconstructed the
          // scene, so it must not be requested from the model a second time.
          guideCamera.updateProjectionMatrix();
          guideCamera.updateMatrixWorld(true);
          const savedBackground = scene.background;
          const savedOverride = scene.overrideMaterial;
          const savedVisibility = [floor.visible, grid.visible, helper.visible, camRig.visible, lightMarker.visible];
          const savedLights = { key: key.intensity, keyPosition: key.position.clone(), keyColor: key.color.clone(), fill: fill.intensity, hemi: hemi.intensity };
          floor.visible = false;
          grid.visible = false;
          helper.visible = false;
          camRig.visible = false;
          lightMarker.visible = false;
          scene.background = new THREE.Color(0xe9edf2);
          scene.overrideMaterial = neutralGuideMaterial;
          key.position.set(3.8, 5.4, 4.8);
          key.color.setHex(0xffffff);
          key.intensity = 2.8;
          fill.intensity = 0.5;
          hemi.intensity = 1;
          try {
            guideRenderer.setSize(captureOutput.width, captureOutput.height, false);
            guideRenderer.render(scene, guideCamera);
            const dataUrl = guideRenderer.domElement.toDataURL('image/webp', 0.9);
            return { id: `angle-guide-${crypto.randomUUID()}`, kind: 'image', name: `中性构图导引-${captureOutput.width}x${captureOutput.height}.webp`, url: dataUrl, dataUrl };
          } finally {
            scene.background = savedBackground;
            scene.overrideMaterial = savedOverride;
            [floor.visible, grid.visible, helper.visible, camRig.visible, lightMarker.visible] = savedVisibility;
            key.intensity = savedLights.key;
            key.position.copy(savedLights.keyPosition);
            key.color.copy(savedLights.keyColor);
            fill.intensity = savedLights.fill;
            hemi.intensity = savedLights.hemi;
          }
        },
      };

      const syncVirtualCamera = (state: AngleCameraState, target: THREE.Vector3) => {
        virtualCamera.position.copy(orbitCamera.position);
        virtualCamera.aspect = outputRef.current.width / outputRef.current.height;
        virtualCamera.setFocalLength(state.focal);
        virtualCamera.lookAt(target);
        virtualCamera.rotateZ(THREE.MathUtils.degToRad(state.roll));
        virtualCamera.updateProjectionMatrix();
        virtualCamera.updateMatrixWorld(true);
        camRig.position.copy(virtualCamera.position);
        camRig.quaternion.copy(virtualCamera.quaternion);
        camRig.updateMatrixWorld(true);
        helper.update();
      };

      const syncFromState = () => {
        const state = cameraRef.current;
        const aspect = outputRef.current.width / outputRef.current.height;
        const target = targetFromFrameOffset(state, aspect);
        const basis = cameraBasis(state, aspect);
        syncingRef.current = true;
        controls.target.copy(target);
        orbitCamera.position.copy(target).add(basis.offset);
        orbitCamera.setFocalLength(state.focal);
        orbitCamera.updateProjectionMatrix();
        orbitCamera.lookAt(target);
        orbitCamera.rotateZ(THREE.MathUtils.degToRad(state.roll));
        orbitCamera.updateMatrixWorld(true);
    controls.enablePan = false;
        controls.update();
        syncingRef.current = false;
        syncVirtualCamera(state, target);
      };

      const makeControlsPatch = () => {
        const state = cameraRef.current;
        const target = controls.target;
        const vector = orbitCamera.position.clone().sub(target);
        const radius = Math.max(0.001, vector.length());
        const nextState = {
          ...state,
          yaw: roundViewportValue(unwrapOrbitYaw(state.yaw, THREE.MathUtils.radToDeg(Math.atan2(vector.x, vector.z)))),
          pitch: roundViewportValue(clampAngleValue('pitch', -THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(vector.y / radius, -1, 1))))),
          distance: roundViewportValue(clampAngleValue('distance', (radius / (5.4 * Math.max(1, outputRef.current.width / outputRef.current.height))) * 2.2), 3),
        };
        return { ...nextState, ...frameOffsetFromTarget(nextState, target, outputRef.current.width / outputRef.current.height) };
      };

      const onControlsChange = () => {
        if (syncingRef.current) return;
        const patch = makeControlsPatch();
        pendingPatchRef.current = patch;
        syncVirtualCamera({ ...cameraRef.current, ...patch }, controls.target);
        reportFraming();
        if (!changeAnimationRef.current) {
          changeAnimationRef.current = window.requestAnimationFrame(() => {
            changeAnimationRef.current = 0;
            if (pendingPatchRef.current) callbackRef.current(pendingPatchRef.current);
          });
        }
      };
      const onControlsStart = () => { gestureActiveRef.current = true; setHasInteracted(true); };
      const onControlsEnd = () => {
        const patch = makeControlsPatch();
        pendingPatchRef.current = patch;
        callbackRef.current(patch);
        window.requestAnimationFrame(() => { gestureActiveRef.current = false; });
      };
      controls.addEventListener('change', onControlsChange);
      controls.addEventListener('start', onControlsStart);
      controls.addEventListener('end', onControlsEnd);

      const resize = () => {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        renderer.setSize(width, height, false);
        const miniWidth = Math.max(1, miniHost.clientWidth);
        const miniHeight = Math.max(1, miniHost.clientHeight);
        miniRenderer.setSize(miniWidth, miniHeight, false);
        orbitCamera.aspect = width / height;
        orbitCamera.updateProjectionMatrix();
        virtualCamera.aspect = outputRef.current.width / outputRef.current.height;
        virtualCamera.updateProjectionMatrix();
        const nextFrameRect = fitOutputFrame(width, height, virtualCamera.aspect);
        frameRectRef.current = nextFrameRect;
        setFrameRect(nextFrameRect);
        overviewCamera.aspect = miniWidth / miniHeight;
        overviewCamera.updateProjectionMatrix();
        reportFraming();
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      resize();
      syncFromState();
      reportFraming();

      const render = () => {
        animationFrame = window.requestAnimationFrame(render);
        controls.update();
        orbitCamera.lookAt(controls.target);
        orbitCamera.rotateZ(THREE.MathUtils.degToRad(cameraRef.current.roll));
        orbitCamera.updateMatrixWorld(true);
        // The main 3D viewport is intentionally clean. The virtual camera and
        // its frustum are rendered by a separate renderer inside CAMERA MAP.
        helper.visible = false;
        camRig.visible = false;
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, host.clientWidth, host.clientHeight);
        renderer.clear();
        const rect = frameRectRef.current;
        const scissorX = Math.round(rect.left);
        const scissorY = Math.round(host.clientHeight - rect.top - rect.height);
        const scissorWidth = Math.max(1, Math.round(rect.width));
        const scissorHeight = Math.max(1, Math.round(rect.height));
        renderer.setScissorTest(true);
        renderer.setViewport(scissorX, scissorY, scissorWidth, scissorHeight);
        renderer.setScissor(scissorX, scissorY, scissorWidth, scissorHeight);
        renderer.clearDepth();
        renderer.render(scene, virtualCamera);
        renderer.setScissorTest(false);
        helper.visible = true;
        camRig.visible = true;
        miniRenderer.render(scene, overviewCamera);
      };
      render();

      return () => {
        reportFramingRef.current = null;
        window.cancelAnimationFrame(animationFrame);
        resizeObserver?.disconnect();
        if (changeAnimationRef.current) window.cancelAnimationFrame(changeAnimationRef.current);
        controls.removeEventListener('change', onControlsChange);
        controls.removeEventListener('start', onControlsStart);
        controls.removeEventListener('end', onControlsEnd);
        renderer.domElement.removeEventListener('contextmenu', preventContextMenu);
        window.removeEventListener('keydown', onNavigationKeyDown);
        window.removeEventListener('keyup', onNavigationKeyUp);
        controls.dispose();
        scene.traverse((object) => {
          const mesh = object as THREE.Mesh;
          mesh.geometry?.dispose?.();
          const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
          materials.forEach((material) => material.dispose());
        });
        renderer.dispose();
        miniRenderer.dispose();
        guideRenderer.dispose();
        neutralGuideMaterial.dispose();
        renderer.domElement.remove();
        miniRenderer.domElement.remove();
        captureApiRef.current = null;
        runtimeRef.current = null;
      };
    } catch (error) {
      console.warn('Angle console 3D preview unavailable:', error);
      setFallback(true);
      framingCallbackRef.current({ level: 'unavailable', title: '空间预览不可用', detail: '仍可使用数值控制生成；发送构图导引需要 WebGL。' });
      return undefined;
    }
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.subject.visible = humanMode === 'natural' || humanMode === 'outline' || humanMode === 'gray';
    runtime.proxy.visible = humanMode === 'object';
    runtime.sceneProxy.visible = humanMode === 'scene';
    if (runtime.defaultSubject) runtime.defaultSubject.visible = humanMode === 'default';
    if (runtime.customSubject) runtime.customSubject.visible = humanMode === 'custom';
    const materials = (runtime.subject.userData.mannequinMaterials || []) as THREE.MeshStandardMaterial[];
    const palettes: Record<'natural' | 'outline' | 'gray', number[]> = {
      natural: [0x8d6bff, 0xb9c8e8, 0xe3b38d, 0x222b3d],
      outline: [0x6f9de2, 0xb9d0f0, 0x8fb0d8, 0x1d2a3d],
      gray: [0x858b92, 0xa7adb3, 0xc8cdd1, 0x555b62],
    };
    const palette = palettes[humanMode === 'natural' || humanMode === 'outline' ? humanMode : 'gray'];
    materials.forEach((material, index) => material.color.setHex(palette[index] || palette[0]));
    window.requestAnimationFrame(() => reportFramingRef.current?.());
  }, [humanMode]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || humanMode !== 'default' || runtime.defaultSubject) return;
    let cancelled = false;
    new GLTFLoader().load(DEFAULT_HUMAN_URL, (gltf) => {
      if (cancelled || runtimeRef.current !== runtime) return;
      const subject = gltf.scene;
      normalizeLoadedSubject(subject, -Math.PI / 2);
      runtime.defaultSubject = subject;
      runtime.scene.add(subject);
      subject.visible = humanModeRef.current === 'default';
      reportFramingRef.current?.();
    }, undefined, () => {
      if (!cancelled) framingCallbackRef.current({ level: 'unavailable', title: '人物 GLB 加载失败', detail: '请选择通用主体、人物轮廓或重新导入 GLB。' });
    });
    return () => { cancelled = true; };
  }, [humanMode]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !customHumanFile) return;
    let cancelled = false;
    const objectUrl = URL.createObjectURL(customHumanFile);
    const loader = new GLTFLoader();
    loader.load(objectUrl, (gltf) => {
      if (cancelled || runtimeRef.current !== runtime) return;
      runtime.customSubject?.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        materials.forEach((material) => material.dispose());
      });
      if (runtime.customSubject) runtime.scene.remove(runtime.customSubject);
      const subject = gltf.scene;
      normalizeLoadedSubject(subject);
      subject.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
      });
      runtime.scene.add(subject);
      runtime.customSubject = subject;
      subject.visible = humanModeRef.current === 'custom';
      window.requestAnimationFrame(() => reportFramingRef.current?.());
    }, undefined, () => onNotify('GLB 导入失败，请确认文件格式有效。'));
    return () => { cancelled = true; URL.revokeObjectURL(objectUrl); };
  }, [customHumanFile]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.controls.enabled = interaction === 'camera' && camera.viewpoint?.changeView !== false;
    runtime.controls.enablePan = false;
  }, [interaction, camera.viewpoint?.changeView]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const selectedLight = normalizeViewpointOptions(camera.viewpoint).lighting;
    const light = selectedLight.enabled ? selectedLight : { ...LIGHTING_DEFAULTS, anchor: 'reference' as const };
    const direction = lightingDirection(light, camera.yaw);
    runtime.keyLight.position.set(direction.x * 5, SUBJECT_CENTER.y + direction.y * 5, direction.z * 5);
    runtime.keyLight.intensity = light.enabled ? 2.8 * light.intensity : 2.8;
    const temperatureColor = light.temperature < 5500
      ? new THREE.Color(0xffb66a).lerp(new THREE.Color(0xffffff), (light.temperature - 2500) / 3000)
      : new THREE.Color(0xffffff).lerp(new THREE.Color(0xaccaff), (light.temperature - 5500) / 4500);
    runtime.keyLight.color.copy(light.enabled ? temperatureColor : new THREE.Color(0xffffff));
    runtime.keyLight.shadow.radius = 1 + light.softness * 6;
    runtime.ambientLight.intensity = light.enabled ? 0.12 + light.fill * 1.8 : 1;
    runtime.fillLight.intensity = light.enabled ? light.fill * light.intensity : 0.5;
    runtime.lightMarker.position.set(direction.x * 2.4, SUBJECT_CENTER.y + direction.y * 2.4, direction.z * 2.4);
    runtime.lightMarker.visible = light.enabled;
    (runtime.lightMarker.material as THREE.MeshBasicMaterial).color.copy(temperatureColor);
  }, [camera.viewpoint?.lighting, camera.yaw]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || gestureActiveRef.current) return;
    const aspect = output.width / output.height;
    runtime.controls.minDistance = 1.35 * Math.max(1, aspect);
    runtime.controls.maxDistance = 27 * Math.max(1, aspect);
    const target = targetFromFrameOffset(camera, aspect);
    const basis = cameraBasis(camera, aspect);
    if (changeAnimationRef.current) {
      window.cancelAnimationFrame(changeAnimationRef.current);
      changeAnimationRef.current = 0;
    }
    pendingPatchRef.current = null;
    syncingRef.current = true;
    runtime.controls.target.copy(target);
    runtime.controls.enablePan = false;
    runtime.orbitCamera.position.copy(target).add(basis.offset);
    runtime.orbitCamera.setFocalLength(camera.focal);
    runtime.orbitCamera.updateProjectionMatrix();
    runtime.orbitCamera.lookAt(target);
    runtime.orbitCamera.rotateZ(THREE.MathUtils.degToRad(camera.roll));
    runtime.orbitCamera.updateMatrixWorld(true);
    runtime.controls.update();
    runtime.virtualCamera.position.copy(runtime.orbitCamera.position);
    runtime.virtualCamera.aspect = aspect;
    runtime.virtualCamera.setFocalLength(camera.focal);
    runtime.virtualCamera.lookAt(target);
    runtime.virtualCamera.rotateZ(THREE.MathUtils.degToRad(camera.roll));
    runtime.virtualCamera.updateProjectionMatrix();
    runtime.virtualCamera.updateMatrixWorld(true);
    runtime.camRig.position.copy(runtime.virtualCamera.position);
    runtime.camRig.quaternion.copy(runtime.virtualCamera.quaternion);
    runtime.helper.update();
    const releaseSyncFrame = window.requestAnimationFrame(() => {
      syncingRef.current = false;
      reportFramingRef.current?.();
    });
    return () => window.cancelAnimationFrame(releaseSyncFrame);
  }, [camera, output.height, output.width]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const nextFrameRect = fitOutputFrame(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight), output.width / output.height);
    frameRectRef.current = nextFrameRect;
    setFrameRect(nextFrameRect);
    window.requestAnimationFrame(() => reportFramingRef.current?.());
  }, [output.height, output.width]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const host = hostRef.current;
    if (!runtime || !host || typeof window === 'undefined') return;
    const styles = getComputedStyle(host.closest('.angle-page') || document.documentElement);
    const panel = cssColor(styles.getPropertyValue('--angle-stage-deep'), theme === 'dark' ? '#161820' : '#efeff8');
    const accent = cssColor(styles.getPropertyValue('--angle-accent'), theme === 'dark' ? '#8c7fff' : '#6357e8');
    const muted = cssColor(styles.getPropertyValue('--angle-muted'), theme === 'dark' ? '#858e9e' : '#8b92a2');
    const floorMaterial = runtime.floor.material as THREE.MeshStandardMaterial;
    const gridMaterials = Array.isArray(runtime.grid.material) ? runtime.grid.material : [runtime.grid.material];
    const helperMaterial = runtime.helper.material as THREE.LineBasicMaterial;
    runtime.scene.background = panel;
    floorMaterial.color.copy(panel).multiplyScalar(theme === 'dark' ? 0.58 : 0.96);
    gridMaterials.forEach((material) => {
      const lineMaterial = material as THREE.LineBasicMaterial;
      lineMaterial.color.copy(accent);
      lineMaterial.opacity = theme === 'dark' ? 0.55 : 0.34;
    });
    helperMaterial.color.copy(accent);
    const bodyMaterial = runtime.camRig.children[0] as THREE.Mesh;
    const lensMaterial = runtime.camRig.children[1] as THREE.Mesh;
    (bodyMaterial.material as THREE.MeshStandardMaterial).color.copy(muted).lerp(accent, 0.32);
    (lensMaterial.material as THREE.MeshStandardMaterial).color.copy(panel).lerp(accent, 0.22);
  }, [theme]);

  return <div className={`angle-three-host ${interaction === 'light' ? 'is-light-control' : ''}`} ref={hostRef}
    onPointerDown={(event) => {
      if (interaction !== 'light') return;
      event.currentTarget.setPointerCapture(event.pointerId);
      lightDragRef.current = { x: event.clientX, y: event.clientY, viewpoint: normalizeViewpointOptions(cameraRef.current.viewpoint) };
    }}
    onPointerMove={(event) => {
      const drag = lightDragRef.current;
      if (!drag) return;
      const light = drag.viewpoint.lighting;
      const viewpoint = normalizeViewpointOptions({ ...drag.viewpoint, lighting: { ...light, enabled: true, azimuth: Math.max(-180, Math.min(180, light.azimuth + (event.clientX - drag.x) * 0.6)), elevation: Math.max(0, Math.min(90, light.elevation - (event.clientY - drag.y) * 0.4)) } });
      callbackRef.current({ viewpoint });
    }}
    onPointerUp={(event) => { lightDragRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { lightDragRef.current = null; }}>
    {fallback && <div className="angle-three-fallback"><strong>空间预览不可用</strong><span>数值控制仍可生成</span></div>}
    <div className="angle-output-mask" aria-hidden><i style={{ left: 0, top: 0, right: 0, height: frameRect.top }}/><i style={{ left: 0, top: frameRect.top + frameRect.height, right: 0, bottom: 0 }}/><i style={{ left: 0, top: frameRect.top, width: frameRect.left, height: frameRect.height }}/><i style={{ left: frameRect.left + frameRect.width, right: 0, top: frameRect.top, height: frameRect.height }}/></div>
    <div className="angle-output-frame" style={{ left: frameRect.left, top: frameRect.top, width: frameRect.width, height: frameRect.height }}><span>导引画框 {output.width}×{output.height}</span></div>
    <div className={`angle-three-loading ${hasInteracted ? 'is-muted' : ''}`}>{interaction === 'light' ? lightingDirectionLabel(normalizeViewpointOptions(camera.viewpoint).lighting) : referenceViewLabel(camera.yaw)}</div>
  </div>;
}

export default function AngleConsole({ theme, reference, initialCamera, initialCameraStart, initialOutput, initialNote, embedded = false, onDraftChange, models, defaultProviderId, defaultProviderName, defaultModelId, results, busy, onReferenceFiles, onExit, onRemoveReference, onBrowseHistory, onGenerate, onOpenResult, openResultId, suppressAutoOpenId, onResultOpened, onDownloadResult, onDownloadShare, onNotify }: AngleConsoleProps) {
  const [camera, setCamera] = useState<AngleCameraState>(() => createViewpointCamera());
  const [cameraStart, setCameraStart] = useState<AngleCameraState | null>(null);
  const [note, setNote] = useState('');
  const [humanMode, setHumanMode] = useState<HumanMode>('object');
  const [customHumanFile, setCustomHumanFile] = useState<File | null>(null);
  const [panelTab, setPanelTab] = useState<'controls' | 'backend'>('controls');
  const [controlTab, setControlTab] = useState<'camera' | 'lighting' | 'composition'>('camera');
  const [interactionMode, setInteractionMode] = useState<'camera' | 'light'>('camera');
  const [resultMode, setResultMode] = useState<ResultMode>('single');
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  useBodyScrollLock(resultModalOpen || helpOpen);
  const [viewedResult, setViewedResult] = useState<GalleryItem | null>(null);
  const [resultNoticeId, setResultNoticeId] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [comparePosition, setComparePosition] = useState(50);
  const [framingStatus, setFramingStatus] = useState<GuideFramingStatus>(GUIDE_FRAMING_PENDING);
  const [angleOutput, setAngleOutput] = useState<AngleOutputSpec>(() => initialOutput || angleOutputFromDimensions(1, 1));
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const humanInputRef = useRef<HTMLInputElement | null>(null);
  const helpDialogRef = useRef<HTMLElement | null>(null);
  const compareStageRef = useRef<HTMLDivElement | null>(null);
  const compareDragRef = useRef(false);
  const latestResultIdRef = useRef<string | null>(null);
  const angleConsoleMountedRef = useRef(false);
  const viewedResultIdsRef = useRef<Set<string>>(new Set());
  const guideCaptureApiRef = useRef<GuideCaptureApi | null>(null);
  const cameraMapHostRef = useRef<HTMLDivElement | null>(null);
  const preferenceRestoredRef = useRef(false);
  const previousReferenceIdRef = useRef<string | null | undefined>(reference?.id);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!helpOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = helpDialogRef.current;
    const closeButton = dialog?.querySelector<HTMLElement>('[data-angle-help-close]');
    closeButton?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [helpOpen]);

  const modelOptions = useMemo(() => models.filter((model) => model.enabled && model.published && model.capabilities.includes('edit')), [models]);
  const resolvedModel = camera.modelId === 'auto'
    ? selectAutomaticModel(modelOptions, defaultProviderId, defaultModelId)
    : modelOptions.find((model) => model.id === camera.modelId);
  const modelLabel = resolvedModel?.displayName || '自动选择改图模型';
  const payload = useMemo(() => buildAnglePayload(camera, modelLabel, cameraStart, angleOutput), [angleOutput, camera, cameraStart, modelLabel]);
  const liteLargeAngleWarning = Boolean(resolvedModel && shouldWarnLiteForAngle(`${resolvedModel.rawId} ${resolvedModel.displayName}`, camera.yaw));
  const viewpoint = useMemo(() => normalizeViewpointOptions(camera.viewpoint), [camera.viewpoint]);
  const previewCamera = useMemo(() => generationCamera(camera), [camera]);
  const compiledPrompt = useMemo(() => compileAngleTargetPrompt(note, camera, { hasGuideReference: viewpoint.guide && viewpoint.changeView, output: angleOutput, cameraStart }), [angleOutput, camera, cameraStart, note, viewpoint]);
  const cameraSemantics = useMemo(() => ({
    yaw: referenceViewLabel(previewCamera.yaw),
    pitch: previewCamera.pitch < -0.1 ? `比原图高 ${Math.abs(previewCamera.pitch)}°` : previewCamera.pitch > 0.1 ? `比原图低 ${previewCamera.pitch}°` : '原图高度',
    focal: cameraSemanticSummary(previewCamera).focal,
    distance: previewCamera.distance < ANGLE_DEFAULTS.distance ? '靠近' : previewCamera.distance > ANGLE_DEFAULTS.distance ? '拉远' : '原图距离',
  }), [previewCamera]);
  const targetSemantic = useMemo(() => buildAngleTargetSemantic(camera, angleOutput), [angleOutput, camera]);
  const targetDifficulty = targetSemantic.difficulty.level;
  const targetDifficultyCopy = targetDifficulty === 'high'
    ? { label: '大角度机位', detail: '原图未展示区域需要模型推断，结构与细节一致性可能降低。' }
    : targetDifficulty === 'medium'
      ? { label: '中角度机位', detail: '需重建部分遮挡关系与表面细节。' }
      : { label: '小角度机位', detail: '适合单次视角重构，优先保持参考图内容连续。' };
  const latestResult = results[0] || null;
  const visibleResults = favoritesOnly ? results.filter((item) => item.favorite) : results;
  const framingVisibleRatio = Math.round(framingStatus.visibleRatio ?? 100);
  const subjectHeightRatio = framingStatus.subjectHeightRatio;
  const subjectHeightSummary = typeof subjectHeightRatio === 'number' ? `主体高度 ${Math.round(subjectHeightRatio)}%` : '主体比例待计算';
  const cropSummary = framingStatus.crop
    ? ([['左', framingStatus.crop.left], ['右', framingStatus.crop.right], ['上', framingStatus.crop.top], ['下', framingStatus.crop.bottom]] as const)
      .filter(([, value]) => Math.round(value) > 0)
      .map(([edge, value]) => `${edge}${Math.round(value)}%`)
      .join(' · ')
    : '';
  const hasReadyReference = Boolean(reference && !reference.pending);
  const submitState = !reference
    ? { title: '先添加参考图', detail: '上传或从历史选择一张图片，作为原始内容、结构与风格参考。', step: 1 }
    : reference.pending
      ? { title: '正在准备参考图', detail: '图片处理完成后即可继续对齐和生成。', step: 1 }
      : !modelOptions.length
        ? { title: '还差：选择可用改图模型', detail: '请先在模型库启用至少一个带“改图”能力的图片模型。', step: 2 }
        : viewpoint.guide && viewpoint.changeView && (framingStatus.level === 'unknown' || framingStatus.level === 'unavailable')
          ? { title: '正在准备构图导引', detail: '关闭“使用空间导引”即可直接用原图生成。', step: 3 }
          : { title: '已准备好生成', detail: viewpoint.guide && viewpoint.changeView ? '将提交原图与可选空间构图导引。' : '只提交原始参考图，按文字机位和光影语义生成。', step: 3 };

  useEffect(() => {
    if (initialOutput) {
      setAngleOutput(initialOutput);
      return;
    }
    if (!reference) {
      setAngleOutput(angleOutputFromDimensions(1, 1));
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => { if (!cancelled) setAngleOutput(angleOutputFromDimensions(image.naturalWidth, image.naturalHeight)); };
    image.onerror = () => { if (!cancelled) onNotify('无法读取参考图比例，暂时使用 1:1 输出框。'); };
    const referenceUrl = reference.dataUrl || reference.url;
    if (!referenceUrl) {
      setAngleOutput(angleOutputFromDimensions(1, 1));
      return () => { cancelled = true; };
    }
    image.src = referenceUrl;
    return () => { cancelled = true; };
  }, [initialOutput, onNotify, reference?.id, reference?.dataUrl, reference?.url]);

  useEffect(() => {
    viewedResultIdsRef.current = readViewedAngleResultIds();
    latestResultIdRef.current = latestResult?.id || null;
    angleConsoleMountedRef.current = true;
    const unreadResult = results.find((item) => item.id !== suppressAutoOpenId && !viewedResultIdsRef.current.has(item.id));
    if (unreadResult) openResult(unreadResult);
  }, []);

  useEffect(() => {
    if (!angleConsoleMountedRef.current) return;
    const previousResultId = latestResultIdRef.current;
    latestResultIdRef.current = latestResult?.id || null;
    if (latestResult && latestResult.id !== previousResultId) setResultNoticeId(latestResult.id);
  }, [latestResult?.id]);

  useEffect(() => {
    if (!openResultId) return;
    const requestedResult = results.find((item) => item.id === openResultId);
    if (requestedResult) openResult(requestedResult);
  }, [openResultId, results]);

  useEffect(() => {
    if (embedded) return;
    try {
      const saved = JSON.parse(localStorage.getItem('sanmao-angle-settings') || 'null') as (Partial<AngleCameraState> & { camera?: Partial<AngleCameraState>; cameraStart?: Partial<AngleCameraState>; referenceId?: string; note?: string }) | null;
    if (saved) {
        const savedCamera = saved.camera && typeof saved.camera === 'object' ? saved.camera : saved;
        setCamera(saved.referenceId === reference?.id ? createViewpointCamera(savedCamera) : { ...createViewpointCamera(), modelId: savedCamera.modelId || 'auto' });
        setCameraStart(saved.cameraStart ? normalizeAngleState(saved.cameraStart) : null);
        if (typeof saved.note === 'string') setNote(saved.note);
      }
    } catch {}
  }, [embedded, reference?.id]);

  useEffect(() => {
    if (embedded || preferenceRestoredRef.current || !modelOptions.length || initialCamera) return;
    preferenceRestoredRef.current = true;
    const lastCall = getLastModelCall('angle');
    if (!lastCall) return;
    const rememberedModelId = lastCall.mode === 'manual' && lastCall.modelId && modelOptions.some((model) => model.id === lastCall.modelId) ? lastCall.modelId : 'auto';
    setCamera((current) => ({ ...current, modelId: rememberedModelId }));
    if (typeof lastCall.params.note === 'string') setNote(lastCall.params.note);
    onNotify('已恢复上次角度控制台设置');
  }, [embedded, initialCamera, modelOptions, onNotify]);

  useEffect(() => {
    if (embedded) return;
    try { localStorage.setItem('sanmao-angle-settings', JSON.stringify({ camera, cameraStart, referenceId: reference?.id || null, note })); } catch {}
  }, [camera, cameraStart, embedded, note, reference?.id]);

  useEffect(() => {
    const previousId = previousReferenceIdRef.current;
    const nextId = reference?.id;
    if (previousId !== undefined && previousId !== nextId) {
      setCameraStart(null);
      if (nextId) setCamera((current) => ({ ...createViewpointCamera(), modelId: current.modelId }));
    }
    previousReferenceIdRef.current = nextId;
  }, [onNotify, reference?.id]);

  useEffect(() => {
    if (!initialCamera) return;
    setCamera(createViewpointCamera(initialCamera));
    setCameraStart(initialCameraStart ? normalizeAngleState(initialCameraStart) : null);
    if (initialNote !== undefined) setNote(initialNote);
    if (initialOutput) setAngleOutput(initialOutput);
  }, [initialCamera, initialCameraStart, initialNote, initialOutput, reference?.id]);

  useEffect(() => {
    if (!embedded || !onDraftChange) return;
    onDraftChange({
      camera,
      cameraStart,
      subjectType: viewpoint.subjectType,
      cameraMode: viewpoint.mode,
      lighting: viewpoint.lighting,
      angleNote: note,
      angleGuide: viewpoint.guide && viewpoint.changeView,
      output: angleOutput,
    });
  }, [angleOutput, camera, cameraStart, embedded, note, onDraftChange, viewpoint]);

  useEffect(() => {
    setHumanMode(current => current === 'object' || current === 'scene' ? (viewpoint.mode === 'camera-view' ? 'scene' : 'object') : current);
  }, [viewpoint.mode]);

  useEffect(() => {
    if (camera.modelId !== 'auto' && !modelOptions.some((model) => model.id === camera.modelId)) setCamera((current) => ({ ...current, modelId: 'auto' }));
  }, [camera.modelId, modelOptions]);

  function updateCamera(patch: CameraPatch) {
    setCamera((current) => {
      const next = { ...current, ...patch };
      if (typeof patch.focal === 'number' && current.compositionLock && current.focal > 0) next.distance = Math.round(clampAngleValue('distance', current.distance * (patch.focal / current.focal)) * 10) / 10;
      return normalizeAngleState(next);
    });
  }

  function updateViewpoint(patch: Partial<ViewpointOptions>) {
    updateCamera({ viewpoint: normalizeViewpointOptions({ ...viewpoint, ...patch, lighting: patch.lighting ? { ...viewpoint.lighting, ...patch.lighting } : viewpoint.lighting }) });
  }

  function updateLighting(patch: Partial<LightingState>) {
    updateViewpoint({ lighting: { ...viewpoint.lighting, ...patch } });
  }

  function update3dCamera(patch: CameraPatch) { updateCamera(patch); }

  function applyPreset(yaw: number, pitch: number) {
    if (!viewpoint.changeView) return;
    updateCamera({ yaw, pitch });
  }

  function resetCameraToReference() {
    setCamera(current => resetViewpointCamera(current));
    setFramingStatus(GUIDE_FRAMING_PENDING);
    onNotify('已重置相对机位；参考类型、模式、灯光、模型和补充要求不变。');
  }

  function flipHorizontalTarget() {
    const nextYaw = flipHorizontalYaw(camera.yaw);
    if (nextYaw === camera.yaw) return onNotify(Math.abs(camera.yaw) < 1 ? '正面机位没有左右方向可切换。' : '背面机位没有可见的正面方向可切换。');
    updateCamera({ yaw: nextYaw });
    onNotify(`已切换画面左右方向：Yaw ${roundViewportValue(camera.yaw)}° → ${roundViewportValue(nextYaw)}°，导引与最终语义已同步。`);
  }

  function resetAllControls() {
    const defaults = createViewpointCamera();
    setCamera(defaults);
    setCameraStart(null);
    setNote('');
    setHumanMode('object');
    setInteractionMode('camera');
    setCustomHumanFile(null);
    setPanelTab('controls');
    setControlTab('camera');
    setFramingStatus(GUIDE_FRAMING_PENDING);
    if (!embedded) {
      try { localStorage.setItem('sanmao-angle-settings', JSON.stringify({ camera: defaults, cameraStart: null, note: '' })); } catch {}
    }
    onNotify('已恢复默认参考视角、通用主体和原始光照；参考图与生成结果已保留。');
  }

  function replaceReferenceFiles(files: File[] | FileList) {
    onReferenceFiles(files);
  }

  function removeReference() {
    setCameraStart(null);
    onRemoveReference();
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const files = Array.from(event.clipboardData.files || []).filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    replaceReferenceFiles(files);
    onNotify('已从剪贴板添加参考图');
  }

  async function submit() {
    if (busy || submittingRef.current || reference?.pending) return;
    if (!reference) return onNotify('请先添加一张参考图');
    if (!modelOptions.length) return onNotify('还没有可用的改图模型，请先到模型库启用带“改图”能力的图片模型');
    submittingRef.current = true;
    try {
    const guideReference = viewpoint.guide && viewpoint.changeView
      ? await guideCaptureApiRef.current?.capture(angleOutput)
      : undefined;
    if (viewpoint.guide && viewpoint.changeView && !guideReference) return onNotify('空间构图导引截图失败，请关闭导引或重新载入空间预览。');
    const selectedModel = camera.modelId !== 'auto' ? modelOptions.find((model) => model.id === camera.modelId) : undefined;
    recordModelCall({ context: 'angle', mode: selectedModel ? 'manual' : 'auto', providerId: selectedModel?.providerId, modelId: selectedModel?.id, params: { yaw: camera.yaw, pitch: camera.pitch, roll: camera.roll, focal: camera.focal, distance: camera.distance, frameX: camera.frameX, frameY: camera.frameY, compositionLock: camera.compositionLock, note } });
    await onGenerate({ reference, guideReference: guideReference || undefined, output: angleOutput, camera, cameraStart, note, prompt: compiledPrompt });
    } catch (error) {
      onNotify(error instanceof Error ? error.message : '视角生成失败，请重试。');
    } finally {
      submittingRef.current = false;
    }
  }

  function openHistoryPanel() {
    if (!latestResult) return onNotify('还没有本轮生成结果，生成后可在这里查看和对比。');
    openResult(latestResult);
  }

  function markResultViewed(id: string) {
    viewedResultIdsRef.current.add(id);
    saveViewedAngleResultIds(viewedResultIdsRef.current);
  }

  function openResult(item: GalleryItem) {
    markResultViewed(item.id);
    setViewedResult(item);
    setResultMode('single');
    setComparePosition(50);
    setResultNoticeId(null);
    setResultModalOpen(true);
    onResultOpened?.(item.id);
  }

  function restoreViewedCamera() {
    if (viewedResult?.angle?.viewpoint?.version !== 2) return onNotify('旧结果未保存相对原图参数，请以原图视角重新调整。');
    setCamera(normalizeAngleState(viewedResult.angle));
    setCameraStart(null);
    if (typeof viewedResult.angleNote === 'string') setNote(viewedResult.angleNote);
    onNotify('已恢复此结果的机位参数');
  }

  function continueFromViewedResult() {
    // Continue from the saved controls, never replace the original with output.
    restoreViewedCamera();
  }

  function setCompareFromClientX(clientX: number) {
    const stage = compareStageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const next = ((clientX - rect.left) / Math.max(1, rect.width)) * 100;
    setComparePosition(Math.max(0, Math.min(100, Math.round(next))));
  }

  function handleComparePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    compareDragRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setCompareFromClientX(event.clientX);
  }

  function handleComparePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (compareDragRef.current) setCompareFromClientX(event.clientX);
  }

  function handleComparePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    compareDragRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleHelpKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setHelpOpen(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = helpDialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const current = document.activeElement;
    if (event.shiftKey && current === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const renderQuickControl = (key: AngleNumericKey, label: string, min: number, max: number, step = 1, suffix = '°') => {
    const scale = key === 'distance' ? ANGLE_DEFAULTS.distance : 1;
    const value = roundViewportValue(previewCamera[key] / scale, 3);
    const sliderValue = Math.max(min, Math.min(max, value));
    const baselineValue = ANGLE_DEFAULTS[key] / scale;
    const isDefault = Math.abs(value - baselineValue) < 0.0001;
    return <label className={`angle-control-row angle-slider-control ${isDefault ? 'is-default' : 'is-modified'}`} key={key}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} disabled={!viewpoint.changeView} value={sliderValue} onChange={(event) => updateCamera({ [key]: Number(event.target.value) * scale } as CameraPatch)} aria-label={`${label} 快速滑块`}/>
      <AngleNumberInput value={value} step={step} min={min} max={max} label={label} disabled={!viewpoint.changeView} onCommit={(next) => updateCamera({ [key]: next * scale } as CameraPatch)}/>
      <em>{suffix}</em>
      <button type="button" className="angle-value-reset" disabled={isDefault || !viewpoint.changeView} onClick={() => updateCamera({ [key]: ANGLE_DEFAULTS[key] } as CameraPatch)} title={`重置${label}`} aria-label={`重置${label}`}>↺</button>
    </label>;
  };

  const renderLightControl = (key: keyof Pick<LightingState, 'azimuth' | 'elevation' | 'intensity' | 'softness' | 'temperature' | 'fill'>, label: string, min: number, max: number, step = 1, suffix = '°') => {
    const value = viewpoint.lighting[key];
    return <label className="angle-control-row angle-slider-control angle-light-control" key={key}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => updateLighting({ [key]: Number(event.target.value) })} aria-label={`${label}快速滑块`}/>
      <AngleNumberInput value={value} step={step} min={min} max={max} label={label} onCommit={(next) => updateLighting({ [key]: next })}/>
      <em>{suffix}</em>
      <button type="button" className="angle-value-reset" onClick={() => updateLighting({ [key]: LIGHTING_DEFAULTS[key] })} title={`重置${label}`} aria-label={`重置${label}`}>↺</button>
    </label>;
  };
  return <section className="angle-page angle-viewpoint-console" onPaste={handlePaste} onDragStart={(event) => { if ((event.target as HTMLElement).closest('img')) event.preventDefault(); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const files = Array.from(event.dataTransfer.files || []).filter((file) => file.type.startsWith('image/')); if (files.length) { replaceReferenceFiles(files); onNotify(`已添加 ${files.length} 张参考图`); } }}>
    <header className="angle-console-topbar">
      <div className="angle-console-brand-group"><button type="button" className="angle-brand" onClick={onExit} title="返回 SANMAO.AI"><div className="angle-logo"><img src="/brand-mark.png" alt="" /></div><div><b>ANGLE CONTROL</b><small>CAMERA VIEW GENERATOR</small></div></button><button type="button" className="angle-exit-button" onClick={onExit} title="返回 SANMAO.AI"><span className="angle-exit-icon" aria-hidden="true"><svg viewBox="0 0 18 18" focusable="false"><path d="M8 4.5 4.5 8 8 11.5" /><path d="M4.8 8H13.5" /></svg></span><span className="angle-exit-label">返回 SANMAO.AI</span></button></div>
      <div className="angle-console-actions">
        <button type="button" className="angle-top-button angle-top-help" onClick={() => setHelpOpen(true)} aria-haspopup="dialog" aria-expanded={helpOpen}><span aria-hidden="true">?</span>使用说明</button>
        <button type="button" className={`angle-top-button angle-top-history ${resultNoticeId === latestResult?.id ? 'has-new-result' : ''}`} onClick={openHistoryPanel}>查看结果{results.length ? ` · ${results.length}` : ''}</button>
        <input ref={referenceInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { if (event.target.files?.length) replaceReferenceFiles(event.target.files); event.currentTarget.value = ''; }}/>
      </div>
    </header>
    <div className="angle-workspace surface">
      <div className="angle-workspace-head"><div className="angle-stage-heading"><span>REFERENCE VIEW</span><strong>原图参考 · 视角与光影</strong></div><span className="angle-stage-hint">0° 是原图观察方向；空间导引可选 · 未展示区域由模型保守推断</span></div>
      <div className="angle-preview-grid">
        <div className="angle-preview-pane angle-reference-pane">
          <div className="angle-pane-label"><b>原始参考图</b></div>
          {reference ? <div className="angle-image-frame"><img draggable={false} src={reference.dataUrl || reference.url} alt={reference.name}/></div> : <div className="angle-empty-reference"><strong>粘贴、拖入或上传参考图</strong><span>也可以从生成历史中选择一张已有图片。</span><div><button type="button" className="primary-small" onClick={() => referenceInputRef.current?.click()}>选择图片</button><button type="button" className="ghost-button" onClick={onBrowseHistory}>打开历史</button></div></div>}
          {reference?.pending && <div className="angle-reference-loading" role="status" aria-live="polite"><span className="mini-loader"/><span>正在准备参考图…</span></div>}
          {reference && <div className="angle-pane-tools"><button type="button" onClick={() => referenceInputRef.current?.click()}>更换参考图</button><button type="button" onClick={onBrowseHistory}>从历史选择</button><button type="button" title="恢复人物居中" onClick={() => updateCamera({ frameX: 0, frameY: 0 })}>构图居中</button></div>}
          {reference && <div className="angle-reference-hud"><span><b>图 1</b> 原始内容、结构与风格参考</span><small title={reference.name}>{reference.name}</small></div>}
          {reference && <button type="button" className="angle-reference-remove" onClick={removeReference}>移除参考图</button>}
        </div>
        <div className="angle-preview-pane angle-model-pane">
          <div className="angle-preview-toolbar">
            <div className="angle-segmented" role="group" aria-label="预览交互">
              <button type="button" aria-pressed={interactionMode === 'camera'} className={interactionMode === 'camera' ? 'active' : ''} onClick={() => setInteractionMode('camera')}>机位</button>
              <button type="button" aria-pressed={interactionMode === 'light'} className={interactionMode === 'light' ? 'active' : ''} onClick={() => { setInteractionMode('light'); setControlTab('lighting'); setPanelTab('controls'); updateLighting({ enabled: true }); }}>光源</button>
            </div>
            <AngleMenu
              label="预览对象"
              value={humanMode}
              options={PREVIEW_OBJECT_OPTIONS}
              onChange={(value) => { if (value === 'custom') humanInputRef.current?.click(); else setHumanMode(value); }}
              ariaLabel="预览对象"
              className="angle-preview-object-menu"
              showLabel
            />
          </div>
          <div className="angle-preview-calibration-note">方向示意 · 未对齐原图 · 灰模不能代表真实相机位置</div>
          <ThreeCameraPreview camera={previewCamera} output={angleOutput} theme={theme} humanMode={humanMode} customHumanFile={customHumanFile} interaction={interactionMode} captureApiRef={guideCaptureApiRef} miniHostRef={cameraMapHostRef} onCameraChange={update3dCamera} onFramingStatus={setFramingStatus} onNotify={onNotify}/>
          <input ref={humanInputRef} hidden type="file" accept=".glb,model/gltf-binary" onChange={(event) => { const file = event.target.files?.[0] || null; if (file) { setCustomHumanFile(file); setHumanMode('custom'); } event.currentTarget.value = ''; }}/>
        </div>
        <aside className="angle-view-rail" aria-label="视角与光影状态">
          <div className="angle-rail-heading"><b>视角与光影</b></div>
          <div className="angle-camera-map angle-camera-map-rail" aria-label="视角俯视图"><span>{interactionMode === 'light' ? '光源方向' : '视角关系'}</span><div className="angle-map-stage" ref={cameraMapHostRef}/><small>{Math.round(previewCamera.focal)}mm · {roundViewportValue(previewCamera.distance / ANGLE_DEFAULTS.distance, 2)}×</small></div>
          <div className={`angle-rail-status ${hasReadyReference ? framingStatus.level : 'unknown'}`}>
            <div className="angle-rail-status-head"><span>当前状态</span><b>{!hasReadyReference ? '等待原始参考图' : viewpoint.guide && viewpoint.changeView ? guideFramingLabel(framingStatus.level) : '原图已就绪'}</b></div>
            <strong>{referenceViewLabel(previewCamera.yaw)}</strong>
            <div className="angle-rail-readout"><span>{roundViewportValue(previewCamera.yaw)}° / {roundViewportValue(previewCamera.pitch)}°</span><span>{SUBJECT_OPTIONS.find(option => option.value === viewpoint.subjectType)?.label} · {viewpoint.mode === 'camera-view' ? '空间保持' : '主体保持'}</span><span>{viewpoint.lighting.enabled ? lightingDirectionLabel(viewpoint.lighting) : '原始光照'}</span><span>{viewpoint.guide && viewpoint.changeView ? '原图 + 构图导引' : '仅原图'}</span><span>{angleOutput.width} × {angleOutput.height}</span></div>
          </div>
        </aside>
      </div>
      <div className="angle-preset-strip"><div className="angle-preset-strip-head"><b>快捷视角</b><span>以原图观察方向为基准</span></div><div className="angle-preset-options">{REFERENCE_VIEW_PRESETS.map((preset) => <button type="button" key={preset.id} className={Math.abs(camera.yaw - preset.yaw) < 1 && Math.abs(camera.pitch - preset.pitch) < 1 ? 'active' : ''} onClick={() => applyPreset(preset.yaw, preset.pitch)}><b>{preset.label}</b><span>{preset.yaw}° / {preset.pitch}°</span></button>)}</div></div>
    </div>

    <aside className="angle-panel surface">
      <div className="angle-panel-head"><h2>视角与光影</h2><div className="angle-panel-actions"><button type="button" className="angle-reset-all" title="恢复原图机位和原始光照" onClick={resetAllControls}>重置</button><div className="angle-panel-tabs"><button type="button" className={panelTab === 'controls' ? 'active' : ''} onClick={() => setPanelTab('controls')}>参数</button><button type="button" className={panelTab === 'backend' ? 'active' : ''} onClick={() => setPanelTab('backend')}>生成指令</button></div></div></div>
      <div className="angle-panel-scroll">
        {panelTab === 'controls' ? <>
          <div className="angle-model-compact"><span>改图模型</span><ModelPicker models={models} value={camera.modelId} capability="edit" defaultProviderId={defaultProviderId} defaultProviderName={defaultProviderName} defaultModelId={defaultModelId} onChange={(value) => updateCamera({ modelId: value })}/></div>
          <section className="angle-section angle-viewpoint-section"><h3>视角策略</h3>
            <div className="angle-select-label"><span>参考类型</span><AngleMenu label="参考类型" value={viewpoint.subjectType} options={SUBJECT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} onChange={(subjectType) => updateViewpoint({ subjectType, mode: defaultViewMode(subjectType), modeSource: 'auto' })} ariaLabel="参考图类型，只用于选择内容类别，不会替换原图主体"/></div>
            <small className="angle-reference-type-explain">这里只选择原图里的内容类别，不会让模型换一个主体。</small>
            <div className="angle-mode-policy"><div><span>相机策略</span><b>{viewpoint.modeSource === 'manual' ? '历史设置' : '系统自动选择'}</b></div><small>{viewpoint.mode === 'camera-view' ? '空间类内容优先保持场景布局；预览只用于看方向和构图。' : '主体类内容优先保持主体外形；预览只用于看方向和构图。'}</small></div>
            <div className="angle-reference-baseline">
              <div><span>起始基准</span><b>{hasReadyReference ? '原始参考图' : '等待参考图'}</b></div>
              <button type="button" onClick={resetCameraToReference} aria-label="重置相对机位" title="重置角度、距离、焦距和构图；保留类型、模式、灯光与补充要求">回到起点</button>
              <small>0° = 原图方向 · 仅将目标参数清零，不会让灰模自动对齐原图</small>
            </div>
            <div className="angle-action-row">
              <button type="button" role="switch" aria-label="改变观察角度" aria-checked={viewpoint.changeView} className={`angle-toggle ${viewpoint.changeView ? 'active' : ''}`} onClick={() => updateViewpoint({ changeView: !viewpoint.changeView })}><i/>{viewpoint.changeView ? '改变观察角度' : '保持原机位'}</button>
              <button type="button" role="switch" aria-label="使用空间导引" aria-checked={viewpoint.guide && viewpoint.changeView} className={`angle-toggle ${viewpoint.guide && viewpoint.changeView ? 'active' : ''}`} onClick={() => updateViewpoint({ guide: !viewpoint.guide })} disabled={!viewpoint.changeView}><i/>使用空间导引</button>
            </div>
          </section>
          <div className="angle-control-tabs" role="tablist" aria-label="控制参数">
            <button type="button" role="tab" id="angle-camera-tab" aria-selected={controlTab === 'camera'} aria-controls="angle-camera-panel" onClick={() => { setControlTab('camera'); setInteractionMode('camera'); }}>机位</button>
            <button type="button" role="tab" id="angle-lighting-tab" aria-selected={controlTab === 'lighting'} aria-controls="angle-lighting-panel" onClick={() => setControlTab('lighting')}>光影</button>
            <button type="button" role="tab" id="angle-composition-tab" aria-selected={controlTab === 'composition'} aria-controls="angle-composition-panel" onClick={() => setControlTab('composition')}>构图与高级</button>
          </div>
          <div role="tabpanel" id="angle-camera-panel" aria-labelledby="angle-camera-tab" hidden={controlTab !== 'camera'}>
          <div className="angle-semantic-summary" aria-live="polite" aria-label="目标视觉语义">
            <div><b>水平</b><strong>{cameraSemantics.yaw}</strong></div><div><b>高度</b><strong>{cameraSemantics.pitch}</strong></div>
            <div><b>镜头</b><strong>{Math.round(previewCamera.focal)}mm</strong></div><div><b>距离</b><strong>{roundViewportValue(previewCamera.distance / ANGLE_DEFAULTS.distance, 2)}× · {cameraSemantics.distance}</strong></div>
            <div className="angle-direction-calibration"><div><b>方向校准</b><strong>{referenceViewLabel(previewCamera.yaw)}</strong></div><button type="button" disabled={!viewpoint.changeView} title="仅在参考图左右方向需要反转时使用" onClick={flipHorizontalTarget}>左右换向</button></div>
            {viewpoint.changeView && <div className={`angle-difficulty-note ${targetDifficulty}`}><b>{targetDifficultyCopy.label}</b><span>{targetDifficultyCopy.detail}</span></div>}
          </div>
          <fieldset className="angle-camera-fields" disabled={!viewpoint.changeView}>
            <section className="angle-section angle-compact-section"><h3>01 · 机位控制</h3>{renderQuickControl('yaw', '水平角度', -180, 180)}{renderQuickControl('pitch', '上下角度', -60, 60)}
              <div className="angle-lenses">{[{label:'高机位',pitch:-30},{label:'原图高度',pitch:0},{label:'低机位',pitch:30}].map(preset => <button type="button" key={preset.label} onClick={() => updateCamera({ pitch: preset.pitch })}>{preset.label}</button>)}</div>
            </section>
            <section className="angle-section angle-compact-section"><h3>02 · 距离与焦距</h3>{renderQuickControl('focal', '焦距', 14, 200, 1, 'mm')}<div className="angle-lenses">{[24, 35, 50, 85, 135].map((focal) => <button type="button" key={focal} className={Math.round(camera.focal) === focal ? 'active' : ''} onClick={() => updateCamera({ focal })}>{focal}</button>)}</div>
              {renderQuickControl('distance', '相对距离', 0.25, 5, 0.05, '×')}
              <div className="angle-lenses">{[{label:'近景',value:0.65},{label:'原图距离',value:1},{label:'远景',value:2}].map(preset => <button type="button" key={preset.label} onClick={() => updateCamera({ distance: preset.value * ANGLE_DEFAULTS.distance })}>{preset.label}</button>)}</div>
              <div className="angle-lens-foot"><button type="button" role="switch" aria-checked={camera.compositionLock} className={`angle-lock ${camera.compositionLock ? 'active' : ''}`} onClick={() => updateCamera({ compositionLock: !camera.compositionLock })} title="改变焦距时同步调整相机距离，尽量保持主体在画面中的大小"><i/>变焦保持构图</button></div>
            </section>
          </fieldset>
          </div>
          <div role="tabpanel" id="angle-lighting-panel" aria-labelledby="angle-lighting-tab" hidden={controlTab !== 'lighting'}>
          <section className="angle-section angle-light-section"><h3>03 · 光影控制</h3>
            <div className="angle-light-head"><button type="button" role="switch" aria-label="重新布光" aria-checked={viewpoint.lighting.enabled} className={`angle-toggle ${viewpoint.lighting.enabled ? 'active' : ''}`} onClick={() => { updateLighting({ enabled: !viewpoint.lighting.enabled }); if (viewpoint.lighting.enabled) setInteractionMode('camera'); }}><i/>{viewpoint.lighting.enabled ? '使用目标光影' : '保留原始光影'}</button></div>
            {viewpoint.lighting.enabled && <><div className="angle-light-presets">{LIGHTING_PRESETS.map((preset) => <button type="button" key={preset.name} onClick={() => updateLighting({ ...preset, enabled: true })}>{preset.name}</button>)}</div>
              {renderLightControl('azimuth', '光源水平', -180, 180, 1, '°')}{renderLightControl('elevation', '光源高度', 0, 90, 1, '°')}{renderLightControl('intensity', '主光强度', 0.1, 2, 0.1, '×')}{renderLightControl('softness', '阴影柔和', 0, 1, 0.05, '')}{renderLightControl('temperature', '色温', 2500, 10000, 100, 'K')}{renderLightControl('fill', '补光比例', 0, 1, 0.05, '')}
              <div className="angle-select-label"><span>光源基准</span><AngleMenu label="光源基准" value={viewpoint.lighting.anchor} options={LIGHT_ANCHOR_OPTIONS} onChange={(anchor) => updateLighting({ anchor })} ariaLabel="光源基准"/></div>
            </>}
          </section>
          </div>
          <div role="tabpanel" id="angle-composition-panel" aria-labelledby="angle-composition-tab" hidden={controlTab !== 'composition'}>
              <div className={`angle-output-summary ${framingStatus.level}`} title={viewpoint.guide ? framingStatus.detail : undefined}><strong>{angleOutput.width} × {angleOutput.height}</strong><span>{viewpoint.guide && viewpoint.changeView ? subjectHeightSummary : '原图比例'}</span>{viewpoint.guide && viewpoint.changeView && <small>主体可见 {framingVisibleRatio}%{cropSummary ? ` · 裁切 ${cropSummary}` : ''}</small>}</div>
              <section className="angle-section angle-compact-section"><h3>04 · 构图位置</h3>{renderQuickControl('frameX', '水平位置', -50, 50, 0.1, '%')}{renderQuickControl('frameY', '垂直位置', -50, 50, 0.1, '%')}</section>
              <section className="angle-section angle-compact-section"><h3>05 · 画面倾斜</h3>{renderQuickControl('roll', '画面倾斜', -45, 45)}</section>
          </div>
          <section className="angle-section angle-note-section"><label htmlFor="angle-note">补充要求</label><textarea id="angle-note" className="angle-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="补充要求（可选）"/></section>
         </> : <div className="angle-backend-view"><section className="angle-section"><h3>CAMERA PAYLOAD · FINAL + AUDIT</h3><div className="angle-code-box"><pre>{JSON.stringify(payload, null, 2)}</pre></div></section><section className="angle-section"><h3>MODEL PROMPT · FINAL TARGET ONLY</h3><div className="angle-code-box"><textarea readOnly value={compiledPrompt}/></div></section></div>}
      </div>
      <div className="angle-submit">
        <div className={`angle-submit-state ${submitState.step === 3 && !busy ? 'ready' : ''}`} role="status">
          <i>{busy ? '…' : submitState.step}</i>
          <span><b>{busy ? '正在生成' : submitState.title}</b><small>{hasReadyReference ? `${viewpoint.guide && viewpoint.changeView ? '原图 + 导引' : '仅原图'} · ${viewpoint.lighting.enabled ? '目标光影' : '原始光影'} · ${angleOutput.width} × ${angleOutput.height}` : submitState.detail}</small></span>
        </div>
        <button type="button" className="primary-action" disabled={busy || reference?.pending || Boolean(reference && (!modelOptions.length || (viewpoint.guide && viewpoint.changeView && framingStatus.level !== 'ready')))} onClick={() => { if (!reference) referenceInputRef.current?.click(); else void submit(); }}>
          {reference?.pending ? '正在准备原图…' : busy ? '正在生成…' : !reference ? '添加参考图' : !viewpoint.changeView ? (viewpoint.lighting.enabled ? '生成光影版本' : '生成修改结果') : '生成新视角'}
        </button>
        {viewpoint.changeView && (targetDifficulty === 'high' || liteLargeAngleWarning) && <small className="angle-submit-warning">原图未展示区域需要模型推断，无法保证绝对几何准确。</small>}
      </div>
    </aside>

    {helpOpen && <div className="angle-help-modal" role="presentation" onClick={() => setHelpOpen(false)} onKeyDown={handleHelpKeyDown}>
      <section ref={helpDialogRef} className="angle-help-dialog" role="dialog" aria-modal="true" aria-label="角度控制台使用说明" aria-labelledby="angle-help-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <header className="angle-help-head">
          <div><span>QUICK START</span><h2 id="angle-help-title">三步掌握视角与光影</h2><p>以原始参考图为起点，告诉模型想从哪里看、如何布光。三维预览是方向和构图示意，不是原图的三维还原。</p></div>
          <button type="button" className="angle-help-close" data-angle-help-close onClick={() => setHelpOpen(false)} aria-label="关闭使用说明">×</button>
        </header>
        <div className="angle-help-scroll">
          <ol className="angle-help-steps">
            <li><i>1</i><div><b>放入原始参考图</b><p>粘贴、拖入或选择一张图片。第 1 张图始终是主体、结构和风格的依据，不会用上一轮生成结果继续叠加。</p></div></li>
            <li><i>2</i><div><b>调整目标机位</b><p>先选主体类型，再调整水平角度、上下角度、距离和焦距。预览中的“机位”拖动会同步右侧参数。</p></div></li>
            <li><i>3</i><div><b>需要时重新布光，然后生成</b><p>关闭光影时保留原始光照；开启后，模型会重建高光、反射、接触阴影和投影方向。</p></div></li>
          </ol>
          <section className="angle-help-section">
            <div className="angle-help-section-head"><span>HOW IT WORKS</span><h3>参数怎么理解</h3></div>
            <div className="angle-help-guide-grid">
              <article><b>机位</b><p><strong>0°</strong> 就是原图观察方向；负数向左，正数向右。上下角度决定高机位或低机位，不能用来转动人物头部或改变姿态。</p></article>
              <article><b>光影</b><p>“保留原始光影”适合只换视角；“使用目标光影”适合指定左侧、右侧、逆光、落日等效果。光源基准决定它跟随当前相机还是固定在原图方向。</p></article>
              <article><b>构图与导引</b><p>焦距影响透视感，距离影响主体大小。只有灰模画框已经接近目标构图时才打开空间导引；灰模没对齐时请保持关闭，避免把错误构图交给模型。</p></article>
            </div>
          </section>
          <section className="angle-help-section">
            <div className="angle-help-section-head"><span>HOW THE SYSTEM CHOOSES</span><h3>为什么不让你手动选“绕圈”或“换站位”</h3></div>
            <div className="angle-help-mode-compare">
              <article><strong>人物、商品、车辆</strong><b>主体保持策略</b><p><em>模型优先保持同一主体的外形。</em> 比如从车头方向生成车侧视角，车辆本身不应被当成另一个物体。预览只帮助你判断左右、高低和画面大小。</p></article>
              <article><strong>室内、建筑、风景、街景</strong><b>空间保持策略</b><p><em>模型优先保持同一场景的布局。</em> 比如从房间另一侧生成画面，房间关系不应整块旋转。当前版本没有真实深度和相机坐标，不能用灰模判断“走了几米”。</p></article>
            </div>
            <p className="angle-help-mode-note"><b>你不需要判断这两个词：</b>系统会根据参考类型自动采用对应的保持策略。两者都以原图为第一依据，当前三维预览不是原图的三维还原。</p>
          </section>
          <section className="angle-help-section">
            <div className="angle-help-section-head"><span>REFERENCE START</span><h3>起始画面没对齐，怎么知道相机移到哪</h3></div>
            <div className="angle-help-guide-grid">
              <article><b>先说结论：目前不能准确预判</b><p>如果首帧构图没有和原图对齐，单看通用灰模就不知道相机真实该移几米、转多少度。这里的 0° 是“相对原图描述目标”，不是已经测出的三维相机坐标。</p></article>
              <article><b>现在可以控制什么</b><p>水平角度、上下角度、距离、焦距和画面位置，都是给模型的视觉目标。它们能表达“从左侧看、从上方看、近一点”，但不会让灰模自动对齐原图。</p></article>
              <article><b>要精确移动，需要先标定</b><p>必须先用真实场景几何或目标视角图，把场景和起始相机对齐，再记录起点并计算位移。当前版本没有这套三维校准流程，因此空间导引只适合粗略表达方向和构图。</p></article>
            </div>
            <p className="angle-help-mode-note"><b>实际用法：</b>把原始参考图当作唯一内容依据；只需要“方向变化”时关闭空间导引，使用快捷视角或角度参数；只有当灰模画框确实接近你想要的构图时，才提交空间导引。真正换一张参考图后，以新原图为起点；生成结果不会自动成为下一轮起点。</p>
          </section>
          <section className="angle-help-section">
            <div className="angle-help-section-head"><span>SUCCESS TIPS</span><h3>想要更稳定的结果</h3></div>
            <div className="angle-help-tips">
              <p><b>小角度优先：</b>左右 45° 以内通常更容易保持身份、材质和空间连续性。</p>
              <p><b>大角度要有预期：</b>超过 90° 会出现原图未展示区域，模型只能根据可见信息保守推断。</p>
              <p><b>不要混淆任务：</b>只想改光线就关闭“改变观察角度”；只想换视角就关闭“使用目标光影”。</p>
              <p><b>结果不理想时：</b>回到原始参考图，先用快捷视角或预设，再逐步微调，不要连续拿生成结果继续生成。</p>
            </div>
          </section>
          <div className="angle-help-readout" aria-label="快速记忆">
            <div><strong>0°</strong><span>原图方向</span></div>
            <div><strong>−</strong><span>向左看</span></div>
            <div><strong>＋</strong><span>向右看</span></div>
            <div><strong>光影关闭</strong><span>保留原光照</span></div>
          </div>
        </div>
        <footer className="angle-help-foot"><span>所有生成都以原始参考图为第一依据。</span><button type="button" className="primary-small" onClick={() => setHelpOpen(false)}>开始使用</button></footer>
      </section>
    </div>}

    {resultModalOpen && viewedResult && reference && <div className="angle-result-modal" role="dialog" aria-modal="true" aria-label="生成结果" onClick={() => setResultModalOpen(false)} onKeyDown={event => { if (event.key === 'Escape') setResultModalOpen(false); }}>
      <div className="angle-result-shell" onClick={(event) => event.stopPropagation()}>
        <div className="angle-result-head">
          <div><b>生成结果</b><small>{viewedResult.angle ? viewedResult.angle.viewpoint ? referenceViewLabel(generationCamera(viewedResult.angle).yaw) : `旧版 ${angleName(viewedResult.angle.yaw)}` : viewedResult.modelName}</small></div>
          <button type="button" className="angle-result-close" autoFocus onClick={() => setResultModalOpen(false)} aria-label="关闭">×</button>
        </div>
        <div className="angle-result-modal-stage">
          {resultMode === 'single' && <div className="angle-result-single"><img src={viewedResult.url} alt="生成结果"/></div>}
          {resultMode === 'swipe' && <div className="angle-result-swipe" ref={compareStageRef}>
            <img src={reference.dataUrl || reference.url} alt="原图"/>
            <div className="angle-result-swipe-top" style={{ clipPath: `inset(0 ${100 - comparePosition}% 0 0)` }}><img src={viewedResult.url} alt="生成结果"/></div>
            <span className="angle-result-label before">原图</span><span className="angle-result-label after">生成结果</span>
            <div className="angle-result-divider" style={{ left: `${comparePosition}%` }} onPointerDown={handleComparePointerDown} onPointerMove={handleComparePointerMove} onPointerUp={handleComparePointerUp} onPointerCancel={handleComparePointerUp} role="slider" aria-label="原图与生成结果分割位置" aria-valuemin={0} aria-valuemax={100} aria-valuenow={comparePosition} tabIndex={0} onKeyDown={(event) => { if (event.key === 'ArrowLeft') setComparePosition((value) => Math.max(0, value - 1)); if (event.key === 'ArrowRight') setComparePosition((value) => Math.min(100, value + 1)); }}><span>↔</span></div>
            <input className="angle-compare-range" aria-label="对比位置" type="range" min="0" max="100" value={comparePosition} onChange={(event) => setComparePosition(Number(event.target.value))}/>
          </div>}
          {resultMode === 'split' && <div className="angle-result-split"><div><img src={reference.dataUrl || reference.url} alt="原图"/><span>原图</span></div><div><img src={viewedResult.url} alt="生成结果"/><span>生成结果</span></div></div>}
        </div>
        <div className="angle-result-history">
          <div><b>本轮历史</b><div className="angle-result-history-actions"><button type="button" aria-pressed={favoritesOnly} className={favoritesOnly ? 'active' : ''} onClick={() => setFavoritesOnly((value) => !value)}>只看收藏</button></div></div>
          <div className="angle-result-history-strip">{visibleResults.map((item) => <button type="button" className={item.id === viewedResult.id ? 'active' : ''} key={item.id} onClick={() => { setViewedResult(item); markResultViewed(item.id); }}><img src={item.url} alt=""/><small>{item.modelName || '图片模型'}</small></button>)}</div>
        </div>
        <div className="angle-result-foot">
          <div className="angle-segmented" role="group" aria-label="结果视图">
            <button type="button" aria-pressed={resultMode === 'single'} className={resultMode === 'single' ? 'active' : ''} onClick={() => setResultMode('single')}>大图</button>
            <button type="button" aria-pressed={resultMode === 'swipe'} className={resultMode === 'swipe' ? 'active' : ''} onClick={() => setResultMode('swipe')}>滑动对比</button>
            <button type="button" aria-pressed={resultMode === 'split'} className={resultMode === 'split' ? 'active' : ''} onClick={() => setResultMode('split')}>并排对比</button>
          </div>
          <button type="button" disabled={busy} onClick={() => { setResultModalOpen(false); void submit(); }}>重新生成</button>
          <button type="button" onClick={() => void onDownloadResult(viewedResult)}>下载结果</button>
          <button type="button" onClick={() => void onDownloadShare(viewedResult)}>下载分享版</button>
          <button type="button" onClick={() => setResultModalOpen(false)}>返回参数</button>
          <button type="button" className="angle-result-primary" disabled={viewedResult.angle?.viewpoint?.version !== 2} onClick={() => { continueFromViewedResult(); setResultModalOpen(false); }}>恢复参数并调整</button>
        </div>
      </div>
    </div>}
  </section>;
}
