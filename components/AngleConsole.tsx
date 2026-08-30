'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ClientReferenceImage, RegistryModel } from '@/lib/types';
import type { GalleryItem } from '@/lib/client-history';
import ModelPicker from '@/components/ModelPicker';
import { getLastModelCall, recordModelCall } from '@/lib/model-preferences';
import { selectAutomaticModel } from '@/lib/model-selection';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';
import { ANGLE_DEFAULTS, ANGLE_PRESETS, angleName, buildAnglePayload, cameraSemanticSummary, clampAngleValue, compileAngleTargetPrompt, deriveAngleDelta, normalizeAngleState, shouldWarnLiteForAngle, type AngleCameraState, type AngleGenerationInput, type AngleNumericKey, type AngleOutputSpec } from '@/lib/angle-control';

type AngleConsoleProps = {
  theme: 'light' | 'dark';
  reference: ClientReferenceImage | null;
  initialCamera?: AngleCameraState | null;
  initialCameraStart?: AngleCameraState | null;
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
  onUseResult: (item: GalleryItem) => void | Promise<void>;
  onDownloadResult: (item: GalleryItem) => void | Promise<void>;
  onDownloadShare: (item: GalleryItem) => void | Promise<void>;
  onNotify: (message: string) => void;
};

type HumanMode = 'default' | 'natural' | 'outline' | 'gray' | 'custom';
type ResultMode = 'single' | 'swipe' | 'split';
type CameraPatch = Partial<Pick<AngleCameraState, 'yaw' | 'pitch' | 'roll' | 'focal' | 'distance' | 'frameX' | 'frameY' | 'compositionLock' | 'modelId'>>;
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
};

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
  detail: '3D 模型和输出相机准备完成后，可生成构图导引图。',
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
  const radius = 5.4 * (state.distance / 2.2);
  const horizontal = radius * Math.cos(pitch);
  const offset = new THREE.Vector3(Math.sin(yaw) * horizontal, -Math.sin(pitch) * radius, Math.cos(yaw) * horizontal);
  const forward = offset.clone().normalize().multiplyScalar(-1);
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const verticalSpan = 2 * radius * Math.tan(THREE.MathUtils.degToRad(focalLengthToFovForPreview(state.focal)) / 2);
  return { radius, offset, right, up, verticalSpan, horizontalSpan: verticalSpan * aspect };
}

function focalLengthToFovForPreview(focal: number) {
  return (2 * Math.atan(36 / (2 * Math.max(0.1, focal))) * 180) / Math.PI;
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

function signedCameraDelta(value: number, suffix: string) {
  const rounded = roundViewportValue(value);
  if (Math.abs(rounded) < 0.0001) return `0${suffix}`;
  return `${rounded > 0 ? '+' : ''}${rounded}${suffix}`;
}

function AngleNumberInput({ value, step, onCommit }: { value: number; step: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(() => String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next)) onCommit(next);
    else setDraft(String(value));
  };
  return <input className="angle-number" type="text" inputMode="decimal" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(String(value)); event.currentTarget.blur(); } }} aria-label="自由数值输入" title={`自由输入数值，建议步长 ${step}`}/>;
}

function cssColor(value: string | undefined, fallback: string) {
  const raw = value?.trim();
  if (!raw) return new THREE.Color(fallback);
  try { return new THREE.Color(raw); } catch { return new THREE.Color(fallback); }
}

function createMannequin(scene: THREE.Scene, mode: 'natural' | 'outline' | 'gray' = 'natural') {
  const group = new THREE.Group();
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
  // Direction-first anatomy: +Z is the mannequin's front. These volumes are
  // deliberately neutral and clothing-free so the image model can read face,
  // chest and pelvis orientation without inheriting armor or costume details.
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
  if (runtime.customSubject?.visible) return runtime.customSubject;
  if (runtime.defaultSubject?.visible) return runtime.defaultSubject;
  return runtime.subject.visible ? runtime.subject : null;
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
  if (!subject) return { level: 'unavailable', title: '3D 人物尚未准备好', detail: '默认模型或自定义 GLB 加载完成后才能生成构图导引。' };

  runtime.scene.updateMatrixWorld(true);
  runtime.virtualCamera.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(subject);
  if (box.isEmpty()) return { level: 'unavailable', title: '无法读取人物模型', detail: '请重新载入默认模型或自定义 GLB。' };

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
    title: roundedVisible >= 99 ? '人物全部位于输出框内' : `人物包围框可见约 ${roundedVisible}%`,
    detail: `${roundedVisible >= 99 ? '可以继续拉近取近景' : '这是主动裁切预览'}；主体约占输出高度 ${roundedHeight}%，框内画面将作为第二张构图参考图。`,
    visibleRatio,
    subjectHeightRatio,
    crop,
  };
}

function ThreeCameraPreview({ camera, output, theme, humanMode, customHumanFile, captureApiRef, miniHostRef, onCameraChange, onFramingStatus, onNotify }: { camera: AngleCameraState; output: AngleOutputSpec; theme: 'light' | 'dark'; humanMode: HumanMode; customHumanFile: File | null; captureApiRef: MutableRefObject<GuideCaptureApi | null>; miniHostRef: MutableRefObject<HTMLDivElement | null>; onCameraChange: (patch: CameraPatch) => void; onFramingStatus: (status: GuideFramingStatus) => void; onNotify: (message: string) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef(camera);
  const outputRef = useRef(output);
  const humanModeRef = useRef(humanMode);
  const callbackRef = useRef(onCameraChange);
  const framingCallbackRef = useRef(onFramingStatus);
  const reportFramingRef = useRef<(() => void) | null>(null);
  const runtimeRef = useRef<ThreePreviewRuntime | null>(null);
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
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      host.appendChild(renderer.domElement);

      const miniRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      miniRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      miniRenderer.shadowMap.enabled = true;
      miniRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xaec8ff, 1.15);
      fill.position.set(-3.4, 2.7, 3.3);
      scene.add(fill);

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
      subject.visible = humanModeRef.current !== 'default' && humanModeRef.current !== 'custom';

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
      // C4D/DCC-style viewport: LMB orbit, MMB pan, RMB or wheel dolly.
      // The only limits left are the tiny mathematical epsilon around the
      // camera origin and the polar singularities.
      controls.enablePan = true;
      controls.screenSpacePanning = true;
      controls.panSpeed = 0.82;
      controls.minDistance = 0.05;
      controls.maxDistance = Infinity;
      controls.minPolarAngle = 0.001;
      controls.maxPolarAngle = Math.PI - 0.001;
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

      runtimeRef.current = { scene, renderer, miniRenderer, guideRenderer, orbitCamera, overviewCamera, virtualCamera, controls, helper, camRig, grid, floor, subject, defaultSubject: null, customSubject: null };
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
          const savedVisibility = [floor.visible, grid.visible, helper.visible, camRig.visible];
          floor.visible = false;
          grid.visible = false;
          helper.visible = false;
          camRig.visible = false;
          scene.background = new THREE.Color(0xe9edf2);
          scene.overrideMaterial = humanModeRef.current === 'gray' ? null : neutralGuideMaterial;
          guideRenderer.setSize(captureOutput.width, captureOutput.height, false);
          guideRenderer.render(scene, guideCamera);
          const dataUrl = guideRenderer.domElement.toDataURL('image/webp', 0.9);
          scene.background = savedBackground;
          scene.overrideMaterial = savedOverride;
          [floor.visible, grid.visible, helper.visible, camRig.visible] = savedVisibility;
          return { id: `angle-guide-${crypto.randomUUID()}`, name: `3D水平构图导引-${captureOutput.width}x${captureOutput.height}.webp`, dataUrl };
        },
      };

      const defaultLoader = new GLTFLoader();
      defaultLoader.load(DEFAULT_HUMAN_URL, (gltf) => {
        if (!runtimeRef.current) return;
        const defaultSubject = gltf.scene;
        normalizeLoadedSubject(defaultSubject, -Math.PI / 2);
        defaultSubject.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
        });
        defaultSubject.visible = humanModeRef.current === 'default';
        scene.add(defaultSubject);
        runtimeRef.current.defaultSubject = defaultSubject;
        reportFraming();
      }, undefined, () => {
        framingCallbackRef.current({ level: 'unavailable', title: '默认 GLB 加载失败', detail: '请确认应用内置模型文件完整，或临时导入其他 GLB。' });
      });

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
        controls.enablePan = true;
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
          distance: roundViewportValue(clampAngleValue('distance', (radius / 5.4) * 2.2)),
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
        renderer.render(scene, orbitCamera);
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
      framingCallbackRef.current({ level: 'unavailable', title: '无法验证人物入镜', detail: '当前设备无法启动 3D 导引，无法保证安全构图。请刷新页面或使用支持 WebGL 的浏览器。' });
      return undefined;
    }
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.subject.visible = humanMode === 'natural' || humanMode === 'outline' || humanMode === 'gray';
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
    if (!runtime || !customHumanFile) return;
    const objectUrl = URL.createObjectURL(customHumanFile);
    const loader = new GLTFLoader();
    loader.load(objectUrl, (gltf) => {
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
      runtime.subject.visible = false;
      if (runtime.defaultSubject) runtime.defaultSubject.visible = false;
      subject.visible = humanModeRef.current === 'custom';
      window.requestAnimationFrame(() => reportFramingRef.current?.());
    }, undefined, () => onNotify('GLB 人物导入失败，请确认文件格式有效。'));
    return () => URL.revokeObjectURL(objectUrl);
  }, [customHumanFile, onNotify]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || gestureActiveRef.current) return;
    const aspect = output.width / output.height;
    const target = targetFromFrameOffset(camera, aspect);
    const basis = cameraBasis(camera, aspect);
    if (changeAnimationRef.current) {
      window.cancelAnimationFrame(changeAnimationRef.current);
      changeAnimationRef.current = 0;
    }
    pendingPatchRef.current = null;
    syncingRef.current = true;
    runtime.controls.target.copy(target);
    runtime.controls.enablePan = true;
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

  return <div className="angle-three-host" ref={hostRef}>
    {fallback && <div className="angle-three-fallback"><strong>3D 预览不可用</strong><span>当前设备无法生成第二张构图导引图，请刷新页面或更换支持 WebGL 的浏览器。</span></div>}
    <div className="angle-output-mask" aria-hidden><i style={{ left: 0, top: 0, right: 0, height: frameRect.top }}/><i style={{ left: 0, top: frameRect.top + frameRect.height, right: 0, bottom: 0 }}/><i style={{ left: 0, top: frameRect.top, width: frameRect.left, height: frameRect.height }}/><i style={{ left: frameRect.left + frameRect.width, right: 0, top: frameRect.top, height: frameRect.height }}/></div>
    <div className="angle-output-frame" style={{ left: frameRect.left, top: frameRect.top, width: frameRect.width, height: frameRect.height }}><span>最终输出 {output.width}×{output.height}</span></div>
    <div className={`angle-three-loading ${hasInteracted ? 'is-muted' : ''}`}>左键环绕 · 中键平移<br/>右键/滚轮缩放 · 1/2/3 + 左拖</div>
  </div>;
}

export default function AngleConsole({ theme, reference, initialCamera, initialCameraStart, models, defaultProviderId, defaultProviderName, defaultModelId, results, busy, onReferenceFiles, onExit, onRemoveReference, onBrowseHistory, onGenerate, onOpenResult, openResultId, suppressAutoOpenId, onResultOpened, onUseResult, onDownloadResult, onDownloadShare, onNotify }: AngleConsoleProps) {
  const [camera, setCamera] = useState<AngleCameraState>(ANGLE_DEFAULTS);
  const [cameraStart, setCameraStart] = useState<AngleCameraState | null>(null);
  const [note, setNote] = useState('');
  const [humanMode, setHumanMode] = useState<HumanMode>('gray');
  const [customHumanFile, setCustomHumanFile] = useState<File | null>(null);
  const [panelTab, setPanelTab] = useState<'controls' | 'backend'>('controls');
  const [resultMode, setResultMode] = useState<ResultMode>('single');
  const [resultModalOpen, setResultModalOpen] = useState(false);
  useBodyScrollLock(resultModalOpen);
  const [viewedResult, setViewedResult] = useState<GalleryItem | null>(null);
  const [resultNoticeId, setResultNoticeId] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [comparePosition, setComparePosition] = useState(50);
  const [framingStatus, setFramingStatus] = useState<GuideFramingStatus>(GUIDE_FRAMING_PENDING);
  const [angleOutput, setAngleOutput] = useState<AngleOutputSpec>(() => angleOutputFromDimensions(1, 1));
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const humanInputRef = useRef<HTMLInputElement | null>(null);
  const compareStageRef = useRef<HTMLDivElement | null>(null);
  const compareDragRef = useRef(false);
  const latestResultIdRef = useRef<string | null>(null);
  const angleConsoleMountedRef = useRef(false);
  const viewedResultIdsRef = useRef<Set<string>>(new Set());
  const guideCaptureApiRef = useRef<GuideCaptureApi | null>(null);
  const cameraMapHostRef = useRef<HTMLDivElement | null>(null);
  const preferenceRestoredRef = useRef(false);
  const previousReferenceIdRef = useRef<string | null | undefined>(reference?.id);

  const modelOptions = useMemo(() => models.filter((model) => model.enabled && model.published && model.capabilities.includes('generate')), [models]);
  const resolvedModel = camera.modelId === 'auto'
    ? selectAutomaticModel(modelOptions, defaultProviderId, defaultModelId)
    : modelOptions.find((model) => model.id === camera.modelId);
  const modelLabel = resolvedModel?.displayName || '自动选择生图模型';
  const payload = useMemo(() => buildAnglePayload(camera, modelLabel, cameraStart), [camera, cameraStart, modelLabel]);
  const liteLargeAngleWarning = Boolean(resolvedModel && shouldWarnLiteForAngle(`${resolvedModel.rawId} ${resolvedModel.displayName}`, camera.yaw));
  const compiledPrompt = useMemo(() => compileAngleTargetPrompt(note, camera, { hasGuideReference: true, output: angleOutput, cameraStart }), [angleOutput, camera, cameraStart, note]);
  const cameraDelta = useMemo(() => cameraStart ? deriveAngleDelta(cameraStart, camera) : null, [camera, cameraStart]);
  const cameraSemantics = useMemo(() => cameraSemanticSummary(camera), [camera]);
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
    ? { title: '先添加参考图', detail: '上传或从历史选择一张图片，作为图 1 的人物、场景与风格参考。', step: 1 }
    : reference.pending
      ? { title: '正在准备参考图', detail: '图片处理完成后即可继续对齐和生成。', step: 1 }
      : !cameraStart
        ? { title: '还差：记录起始机位', detail: '先把右侧灰模对齐图 1，再点击“记录起始机位”。', step: 2 }
        : !modelOptions.length
          ? { title: '还差：选择可用模型', detail: '请先在模型库启用至少一个图片模型。', step: 3 }
          : framingStatus.level === 'unknown' || framingStatus.level === 'unavailable'
            ? { title: '正在准备 3D 构图导引', detail: '构图导引准备完成后即可生成。', step: 3 }
            : { title: '已准备好生成', detail: '将提交图 1 原图与当前安全框内的 3D 构图导引。', step: 3 };

  useEffect(() => {
    if (!reference) {
      setAngleOutput(angleOutputFromDimensions(1, 1));
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => { if (!cancelled) setAngleOutput(angleOutputFromDimensions(image.naturalWidth, image.naturalHeight)); };
    image.onerror = () => { if (!cancelled) onNotify('无法读取参考图比例，暂时使用 1:1 输出框。'); };
    image.src = reference.dataUrl;
    return () => { cancelled = true; };
  }, [reference?.id, reference?.dataUrl]);

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
    try {
      const saved = JSON.parse(localStorage.getItem('sanmao-angle-settings') || 'null') as (Partial<AngleCameraState> & { camera?: Partial<AngleCameraState>; cameraStart?: Partial<AngleCameraState>; referenceId?: string; note?: string }) | null;
      if (saved) {
        const savedCamera = saved.camera && typeof saved.camera === 'object' ? saved.camera : saved;
        setCamera(normalizeAngleState(savedCamera));
        setCameraStart(saved.cameraStart && saved.referenceId && saved.referenceId === reference?.id ? normalizeAngleState(saved.cameraStart) : null);
        if (typeof saved.note === 'string') setNote(saved.note);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (preferenceRestoredRef.current || !modelOptions.length) return;
    preferenceRestoredRef.current = true;
    const lastCall = getLastModelCall('angle');
    if (!lastCall) return;
    const rememberedModelId = lastCall.mode === 'manual' && lastCall.modelId && modelOptions.some((model) => model.id === lastCall.modelId) ? lastCall.modelId : 'auto';
    setCamera((current) => ({ ...current, modelId: rememberedModelId }));
    if (typeof lastCall.params.note === 'string') setNote(lastCall.params.note);
    onNotify('已恢复上次角度控制台设置');
  }, [modelOptions, onNotify]);

  useEffect(() => {
    if (!initialCamera) return;
    setCamera(normalizeAngleState(initialCamera));
    setCameraStart(initialCameraStart ? normalizeAngleState(initialCameraStart) : null);
  }, [initialCamera, initialCameraStart]);

  useEffect(() => {
    try { localStorage.setItem('sanmao-angle-settings', JSON.stringify({ camera, cameraStart, referenceId: reference?.id || null, note })); } catch {}
  }, [camera, cameraStart, note, reference?.id]);

  useEffect(() => {
    const previousId = previousReferenceIdRef.current;
    const nextId = reference?.id;
    if (previousId !== undefined && previousId !== nextId) {
      setCameraStart(null);
      if (nextId) onNotify('参考图已更换，已清除旧的起始机位；请重新对齐后记录。');
    }
    previousReferenceIdRef.current = nextId;
  }, [onNotify, reference?.id]);

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

  function update3dCamera(patch: CameraPatch) { updateCamera(patch); }

  function applyPreset(yaw: number, pitch: number) {
    updateCamera({ yaw, pitch });
  }

  function recordStartingCamera() {
    setCameraStart(normalizeAngleState(camera));
    onNotify('已记录起始机位；灰模画面保持不动，后续调整将从 0 开始累计。');
  }

  function resetAllControls() {
    const defaults = normalizeAngleState(ANGLE_DEFAULTS);
    setCamera(defaults);
    setCameraStart(null);
    setNote('');
    setHumanMode('gray');
    setCustomHumanFile(null);
    setPanelTab('controls');
    setFramingStatus(GUIDE_FRAMING_PENDING);
    try { localStorage.setItem('sanmao-angle-settings', JSON.stringify({ camera: defaults, cameraStart: null, note: '' })); } catch {}
    onNotify('已恢复全部默认参数、默认场景和正面视图；参考图与生成结果已保留。');
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
    if (!reference) return onNotify('请先添加一张参考图');
    if (!cameraStart) return onNotify('请先把灰模对齐图1的原始视角，再点击“记录起始机位”。');
    if (!modelOptions.length) return onNotify('还没有可用的生图模型，请先到模型库启用模型');
    if (framingStatus.level === 'unknown' || framingStatus.level === 'unavailable') return onNotify('3D 导引尚未准备完成，暂时无法生成第二张构图参考图。');
    const guideReference = await guideCaptureApiRef.current?.capture(angleOutput);
    if (!guideReference) return onNotify('构图导引截图失败，请重新载入 3D 模型后再试。');
    const selectedModel = camera.modelId !== 'auto' ? modelOptions.find((model) => model.id === camera.modelId) : undefined;
    recordModelCall({ context: 'angle', mode: selectedModel ? 'manual' : 'auto', providerId: selectedModel?.providerId, modelId: selectedModel?.id, params: { yaw: camera.yaw, pitch: camera.pitch, roll: camera.roll, focal: camera.focal, distance: camera.distance, frameX: camera.frameX, frameY: camera.frameY, compositionLock: camera.compositionLock, note } });
    void onGenerate({ reference, guideReference, output: angleOutput, camera, cameraStart, note, prompt: compiledPrompt });
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
    if (!viewedResult?.angle) return onNotify('这个结果没有保存角度参数，无法恢复机位。');
    setCamera(normalizeAngleState(viewedResult.angle));
    setCameraStart(null);
    onNotify('已恢复此结果的机位参数');
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

  const renderQuickControl = (key: AngleNumericKey, label: string, min: number, max: number, step = 1, suffix = '°') => {
    const value = camera[key];
    const sliderValue = Math.max(min, Math.min(max, value));
    const baselineValue = cameraStart?.[key] ?? ANGLE_DEFAULTS[key];
    const isDefault = Math.abs(value - baselineValue) < 0.0001;
    return <label className={`angle-control-row angle-slider-control ${isDefault ? 'is-default' : 'is-modified'}`} key={key}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={sliderValue} onChange={(event) => updateCamera({ [key]: Number(event.target.value) } as CameraPatch)} aria-label={`${label} 快速滑块`}/>
      <AngleNumberInput value={value} step={step} onCommit={(next) => updateCamera({ [key]: next } as CameraPatch)}/>
      <em>{suffix}</em>
      <button type="button" className="angle-value-reset" disabled={isDefault} onClick={() => updateCamera({ [key]: baselineValue } as CameraPatch)} title={cameraStart ? `恢复${label}到起始机位` : `重置${label}`} aria-label={cameraStart ? `恢复${label}到起始机位` : `重置${label}`}>↺</button>
    </label>;
  };

  return <section className="angle-page" onPaste={handlePaste} onDragStart={(event) => { if ((event.target as HTMLElement).closest('img')) event.preventDefault(); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const files = Array.from(event.dataTransfer.files || []).filter((file) => file.type.startsWith('image/')); if (files.length) { replaceReferenceFiles(files); onNotify(`已添加 ${files.length} 张参考图`); } }}>
    <header className="angle-console-topbar">
      <div className="angle-console-brand-group"><button type="button" className="angle-brand" onClick={onExit} title="返回 SANMAO.AI"><div className="angle-logo"><img src="/brand-mark.png" alt="" /></div><div><b>ANGLE CONTROL</b><small>CAMERA VIEW GENERATOR</small></div></button><button type="button" className="angle-exit-button" onClick={onExit} title="返回 SANMAO.AI"><span className="angle-exit-icon" aria-hidden="true"><svg viewBox="0 0 18 18" focusable="false"><path d="M8 4.5 4.5 8 8 11.5" /><path d="M4.8 8H13.5" /></svg></span><span className="angle-exit-label">返回 SANMAO.AI</span></button></div>
      <div className="angle-console-actions">
        <button type="button" className={`angle-top-button angle-top-history ${resultNoticeId === latestResult?.id ? 'has-new-result' : ''}`} onClick={openHistoryPanel}>查看结果{results.length ? ` · ${results.length}` : ''}</button>
        <input ref={referenceInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { if (event.target.files?.length) replaceReferenceFiles(event.target.files); event.currentTarget.value = ''; }}/>
      </div>
    </header>
    <div className="angle-workspace surface">
      <div className="angle-workspace-head"><div className="angle-stage-heading"><span>REFERENCE</span><strong>原图参考 · 3D 导引</strong></div><span className="angle-stage-hint">图 2 只约束机位与构图；单张原图无法提供完整场景深度 · Roll 在生成后无硬边裁切</span></div>
      <div className="angle-preview-grid">
        <div className="angle-preview-pane angle-reference-pane">
          <div className="angle-pane-label"><b>原始参考图</b> · 身份、服装与画面风格</div>
          {reference ? <div className="angle-image-frame"><img draggable={false} src={reference.dataUrl} alt={reference.name}/></div> : <div className="angle-empty-reference"><strong>粘贴、拖入或上传参考图</strong><span>也可以从生成历史中选择一张已有图片。</span><div><button type="button" className="primary-small" onClick={() => referenceInputRef.current?.click()}>选择图片</button><button type="button" className="ghost-button" onClick={onBrowseHistory}>打开历史</button></div></div>}
          {reference?.pending && <div className="angle-reference-loading" role="status" aria-live="polite"><span className="mini-loader"/><span>正在准备参考图…</span></div>}
          {reference && <div className="angle-pane-tools"><button type="button" onClick={() => referenceInputRef.current?.click()}>更换参考图</button><button type="button" onClick={onBrowseHistory}>从历史选择</button><button type="button" title="恢复人物居中" onClick={() => updateCamera({ frameX: 0, frameY: 0 })}>构图居中</button></div>}
          {reference && <div className="angle-reference-hud"><span><b>图 1</b> 人物 / 场景 / 风格参考</span><small title={reference.name}>{reference.name}</small></div>}
          {reference && <button type="button" className="angle-reference-remove" onClick={removeReference}>移除参考图</button>}
        </div>
        <div className="angle-preview-pane angle-model-pane"><div className="angle-pane-label"><b>3D 构图预览</b> · 图 2 导出时保持水平；Roll 只在最终结果后处理</div><ThreeCameraPreview camera={camera} output={angleOutput} theme={theme} humanMode={humanMode} customHumanFile={customHumanFile} captureApiRef={guideCaptureApiRef} miniHostRef={cameraMapHostRef} onCameraChange={update3dCamera} onFramingStatus={setFramingStatus} onNotify={onNotify}/><details className="angle-guide-display"><summary>导引显示</summary><div><button type="button" className={humanMode === 'gray' ? 'active' : ''} onClick={() => setHumanMode('gray')}>中性灰模（默认）</button><button type="button" className={humanMode === 'natural' ? 'active' : ''} onClick={() => setHumanMode('natural')}>自然人物</button><button type="button" className={humanMode === 'outline' ? 'active' : ''} onClick={() => setHumanMode('outline')}>清晰轮廓</button><button type="button" className={humanMode === 'default' ? 'active' : ''} onClick={() => setHumanMode('default')}>士兵</button><button type="button" className={humanMode === 'custom' ? 'active' : ''} onClick={() => humanInputRef.current?.click()}>导入 GLB</button></div><input ref={humanInputRef} hidden type="file" accept=".glb,model/gltf-binary" onChange={(event) => { const file = event.target.files?.[0] || null; if (file) { setCustomHumanFile(file); setHumanMode('custom'); } event.currentTarget.value = ''; }}/></details></div>
        <aside className="angle-view-rail" aria-label="机位状态"><div className="angle-rail-heading"><b>机位概览</b><span>CAMERA MAP</span></div><div className="angle-camera-map angle-camera-map-rail" aria-label="机位俯视图"><span>机位俯视 · CAMERA MAP</span><div className="angle-map-stage" ref={cameraMapHostRef}/><small>{Math.round(camera.focal)}mm · {camera.distance.toFixed(1)}×</small></div><div className={`angle-rail-status ${framingStatus.level}`}><div className="angle-rail-status-head"><span>构图状态</span><b>{guideFramingLabel(framingStatus.level)}</b></div><strong>{framingStatus.title}</strong><small>{framingStatus.detail}</small><div className="angle-rail-readout"><b>机位 {angleName(camera.yaw)}</b><span>{roundViewportValue(camera.yaw)}° / {roundViewportValue(camera.pitch)}° · Roll {roundViewportValue(camera.roll)}°</span><span>{cameraSemantics.yaw}</span><span>{cameraSemantics.pitch} · {cameraSemantics.focal}</span><span>{subjectHeightSummary} · 输出 {angleOutput.width}×{angleOutput.height}</span></div></div></aside>
      </div>
      <div className="angle-preset-strip"><div className="angle-preset-strip-head"><b>快捷视角</b><span>从常用角度开始，再进行精确微调</span></div><div className="angle-preset-options">{ANGLE_PRESETS.map((preset) => <button type="button" key={preset.id} className={Math.abs(camera.yaw - preset.yaw) < 1 && Math.abs(camera.pitch - preset.pitch) < 1 ? 'active' : ''} onClick={() => applyPreset(preset.yaw, preset.pitch)}><b>{preset.label}</b><span>{preset.yaw}° / {preset.pitch}°</span></button>)}</div></div>
    </div>

    <aside className="angle-panel surface">
      <div className="angle-panel-head"><div><span>控制</span><h2>机位参数</h2></div><div className="angle-panel-actions"><button type="button" className="angle-reset-all" title="恢复全部默认参数、默认场景和正面视图" onClick={resetAllControls}>全部重置</button><div className="angle-panel-tabs"><button type="button" className={panelTab === 'controls' ? 'active' : ''} onClick={() => setPanelTab('controls')}>参数</button><button type="button" className={panelTab === 'backend' ? 'active' : ''} onClick={() => setPanelTab('backend')}>后台记录</button></div></div></div>
      <div className="angle-panel-scroll">
        {panelTab === 'controls' ? <>
          <div className="angle-model-compact"><span>生图模型</span><ModelPicker models={models} value={camera.modelId} capability="generate" defaultProviderId={defaultProviderId} defaultProviderName={defaultProviderName} defaultModelId={defaultModelId} onChange={(value) => updateCamera({ modelId: value } as CameraPatch)}/></div>
          <div className={`angle-output-summary ${framingStatus.level}`} title={framingStatus.detail}><strong>{angleOutput.width}×{angleOutput.height}</strong><span>{subjectHeightSummary}</span><small>人物可见 {framingVisibleRatio}%{cropSummary ? ` · 裁切 ${cropSummary}` : ''}</small></div>
          <div className="angle-semantic-summary" aria-live="polite" aria-label="目标视觉语义"><span>目标视觉语义</span><div><b>Yaw</b><strong>{cameraSemantics.yaw}</strong></div><div><b>Pitch</b><strong>{cameraSemantics.pitch}</strong></div><div><b>Lens</b><strong>{Math.round(camera.focal)}mm · {cameraSemantics.focal}</strong></div><div><b>Distance</b><strong>{camera.distance.toFixed(1)}× · {cameraSemantics.distance}</strong></div></div>
          <ol className="angle-workflow" aria-label="角度控制操作流程">
            <li className={hasReadyReference ? 'done' : submitState.step === 1 ? 'current' : ''}><i>1</i><span><b>添加图 1</b><small>{hasReadyReference ? '参考图已就绪' : '身份、场景与风格参考'}</small></span></li>
            <li className={cameraStart ? 'done' : submitState.step === 2 ? 'current' : ''}><i>2</i><span><b>记录起始机位</b><small>{cameraStart ? '已保存对齐基准' : '先把灰模对齐图 1'}</small></span></li>
            <li className={cameraStart && submitState.step === 3 ? 'current' : ''}><i>3</i><span><b>调整目标并生成</b><small>以当前安全框为最终构图</small></span></li>
          </ol>
          <div className={`angle-start-card ${cameraStart ? 'recorded' : ''}`}>
            <div><strong>{cameraStart ? '起始机位已记录' : '先对齐图1，再记录起始机位'}</strong><small>{cameraStart ? '灰模画面已锁定为起始基准；继续调参只记录相对变化。' : '把灰模调到与图1尽量一致，点击记录后再调整到目标机位。'}</small></div>
            <button type="button" className={cameraStart ? 'ghost-button' : 'primary-small'} onClick={recordStartingCamera}>{cameraStart ? '重新记录' : '记录起始机位'}</button>
            {cameraStart && cameraDelta && <div className="angle-start-delta"><span>相对调整</span><b>Yaw {signedCameraDelta(cameraDelta.yaw, '°')}</b><b>Pitch {signedCameraDelta(cameraDelta.pitch, '°')}</b><b>Roll {signedCameraDelta(cameraDelta.roll, '°')}</b><b>Lens {signedCameraDelta(cameraDelta.focal, 'mm')}</b><b>Distance {signedCameraDelta(cameraDelta.distance, '×')}</b><b>构图 X/Y {signedCameraDelta(cameraDelta.frameX, '%')} / {signedCameraDelta(cameraDelta.frameY, '%')}</b></div>}
          </div>
          <section className="angle-section angle-compact-section"><h3>01 · 机位</h3>{renderQuickControl('yaw', '水平 Yaw', -180, 180)}{renderQuickControl('pitch', '上下 Pitch', -60, 60)}</section>
          <section className="angle-section angle-compact-section"><h3>02 · 镜头</h3>{renderQuickControl('focal', '焦距', 14, 200, 1, 'mm')}<div className="angle-lenses">{[24, 35, 50, 85, 135].map((focal) => <button type="button" key={focal} className={Math.round(camera.focal) === focal ? 'active' : ''} onClick={() => updateCamera({ focal })}>{focal}</button>)}</div>{renderQuickControl('distance', '相机距离', 0.5, 10, 0.1, '×')}<div className="angle-lens-foot"><button type="button" className={`angle-lock ${camera.compositionLock ? 'active' : ''}`} onClick={() => updateCamera({ compositionLock: !camera.compositionLock })} title="改变焦距时同步调整相机距离，尽量保持人物在画面中的大小"><i/>变焦保持构图</button><small>改变焦距时联动距离</small></div></section>
          <details className="angle-advanced">
            <summary><span>构图微调</span><small>位置、倾斜与补充说明</small></summary>
            <div className="angle-advanced-body">
              <section className="angle-section angle-compact-section"><h3>03 · 构图位置</h3>{renderQuickControl('frameX', '水平位置', -100, 100, 0.1, '%')}{renderQuickControl('frameY', '垂直位置', -100, 100, 0.1, '%')}</section>
              <section className="angle-section angle-compact-section"><h3>04 · 画面倾斜</h3>{renderQuickControl('roll', '画面倾斜', -45, 45)}</section>
              <section className="angle-section angle-note-section"><h3>05 · 补充说明</h3><textarea className="angle-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选：例如保持人物表情，同时改成略低机位…"/></section>
            </div>
          </details>
        </> : <div className="angle-backend-view"><section className="angle-section"><h3>CAMERA PAYLOAD</h3><div className="angle-code-box"><pre>{JSON.stringify(payload, null, 2)}</pre></div></section><section className="angle-section"><h3>MODEL PROMPT</h3><div className="angle-code-box"><textarea readOnly value={compiledPrompt}/></div></section></div>}
      </div>
      <div className="angle-submit"><div className={`angle-submit-state ${submitState.step === 3 && !busy ? 'ready' : ''}`}><i>{busy ? '…' : submitState.step}</i><span><b>{busy ? '正在生成双参考图' : submitState.title}</b><small>{busy ? '先重建水平场景，再执行一次最终 Roll 裁切；结果完成后会出现在右上角。' : submitState.detail}</small></span></div><button type="button" className="primary-action" disabled={busy || reference?.pending || Boolean(reference && (!cameraStart || !modelOptions.length || framingStatus.level === 'unknown' || framingStatus.level === 'unavailable'))} onClick={() => { if (!reference) referenceInputRef.current?.click(); else void submit(); }}>{reference?.pending ? '正在准备参考图…' : busy ? '正在生成双参考图…' : !reference ? '添加参考图' : !cameraStart ? '记录起始机位后生成' : '按当前机位生成'}</button>{liteLargeAngleWarning && <small className="angle-submit-warning">当前为 gpt-image-2-lite，Yaw {Math.abs(camera.yaw).toFixed(1)}° 需要明显场景绕拍。该模型可能仍保留原视角；建议改用更强的图片编辑模型以获得侧面、背面和环境视差。不会自动替换你的选择。</small>}</div>
    </aside>

    {resultModalOpen && viewedResult && reference && <div className="angle-result-modal" role="dialog" aria-modal="true" aria-label="生成结果" onClick={() => setResultModalOpen(false)}><div className="angle-result-shell" onClick={(event) => event.stopPropagation()}><div className="angle-result-head"><div><b>生成结果 · RESULT</b><small>{`${angleName(camera.yaw)} · ${Math.round(camera.yaw)}° · Pitch ${Math.round(camera.pitch)}° · Roll ${Math.round(camera.roll)}° · ${Math.round(camera.focal)}mm · ${camera.distance.toFixed(1)}×`}</small></div><button type="button" className="angle-result-close" onClick={() => setResultModalOpen(false)} aria-label="关闭">×</button></div><div className="angle-result-modal-stage">{resultMode === 'single' && <div className="angle-result-single"><img src={viewedResult.url} alt="生成结果"/><span>生成大图</span></div>}{resultMode === 'swipe' && <div className="angle-result-swipe" ref={compareStageRef}><img src={reference.dataUrl} alt="原图"/><div className="angle-result-swipe-top" style={{ clipPath: `inset(0 ${100 - comparePosition}% 0 0)` }}><img src={viewedResult.url} alt="生成结果"/></div><span className="angle-result-label before">原图</span><span className="angle-result-label after">生成结果</span><div className="angle-result-divider" style={{ left: `${comparePosition}%` }} onPointerDown={handleComparePointerDown} onPointerMove={handleComparePointerMove} onPointerUp={handleComparePointerUp} onPointerCancel={handleComparePointerUp} role="slider" aria-label="原图与生成结果分割位置" aria-valuemin={0} aria-valuemax={100} aria-valuenow={comparePosition} tabIndex={0} onKeyDown={(event) => { if (event.key === 'ArrowLeft') setComparePosition((value) => Math.max(0, value - 1)); if (event.key === 'ArrowRight') setComparePosition((value) => Math.min(100, value + 1)); }}><span>↔</span></div><input className="angle-compare-range" aria-label="对比位置" type="range" min="0" max="100" value={comparePosition} onChange={(event) => setComparePosition(Number(event.target.value))}/></div>}{resultMode === 'split' && <div className="angle-result-split"><div><img src={reference.dataUrl} alt="原图"/><span>原图</span></div><div><img src={viewedResult.url} alt="生成结果"/><span>生成结果</span></div></div>}</div><div className="angle-result-history"><div><b>生成历史 · 最近 6 张 + 收藏</b><div className="angle-result-history-actions"><button type="button" className={favoritesOnly ? 'active' : ''} onClick={() => setFavoritesOnly((value) => !value)}>★ 只看收藏</button><button type="button" onClick={() => setViewedResult(latestResult)}>查看最新结果</button></div></div><div className="angle-result-history-strip">{visibleResults.slice(0, 6).map((item) => <button type="button" className={item.id === viewedResult.id ? 'active' : ''} key={item.id} onClick={() => setViewedResult(item)}><img src={item.url} alt=""/><small>{item.modelName || '图片模型'}</small></button>)}</div></div><div className="angle-result-foot"><button type="button" className={resultMode === 'single' ? 'active' : ''} onClick={() => setResultMode('single')}>生成大图</button><button type="button" className={resultMode === 'swipe' ? 'active' : ''} onClick={() => setResultMode('swipe')}>↔ 滑动对比</button><button type="button" className={resultMode === 'split' ? 'active' : ''} onClick={() => setResultMode('split')}>▥ 左右对比</button><button type="button" onClick={() => { setResultModalOpen(false); submit(); }}>重新生成</button><button type="button" onClick={() => void onDownloadResult(viewedResult)}>下载结果</button><button type="button" onClick={() => void onDownloadShare(viewedResult)}>下载分享版</button><button type="button" onClick={restoreViewedCamera}>恢复此机位</button><button type="button" onClick={() => setResultModalOpen(false)}>继续调整</button><button type="button" className="angle-result-primary" onClick={() => { setResultModalOpen(false); void onUseResult(viewedResult); }}>采用此结果继续调整</button></div></div></div>}
  </section>;
}
