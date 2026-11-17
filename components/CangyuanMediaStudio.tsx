'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import ModelPicker from '@/components/ModelPicker';
import CangyuanMusicOptionsFields from '@/components/cangyuan/CangyuanMusicOptionsFields';
import type {
  CangyuanMediaCreateInput,
  CangyuanMediaKind,
  CangyuanMediaOutput,
  CangyuanMediaTask,
  CangyuanMusicOptions,
} from '@/packages/contracts/cangyuan-media';
import { getCangyuan3DModelProfile, getCangyuanMusicModelProfile } from '@/packages/contracts/cangyuan-media';
import type { SpeechOutputFormat } from '@/packages/contracts/audio-synthesis';
import { getCangyuanSpeechModelProfile } from '@/packages/contracts/audio-synthesis';
import type { PublicState, RegistryModel } from '@/lib/types';
import { isCangyuanProvider } from '@/lib/cangyuan-provider';
import { filterModelsByActiveProviders } from '@/lib/provider-availability';
import { CANGYUAN_3D_TASK_POLL_INTERVAL_MS, CANGYUAN_MEDIA_TASK_POLL_INTERVAL_MS, nextCangyuanTaskPollBatch } from '@/lib/cangyuan-media-task-polling';
import './CangyuanMediaStudio.css';

type StudioMode = 'speech' | 'music' | '3d';
type StudioNotice = { kind: 'error' | 'info' | 'success'; text: string } | null;
type SpeechResult = { url: string; name: string; modelName: string; contentType: string; extension: string };

const ACTIVE_TASK_STATUSES = new Set(['pending', 'queued', 'running', 'waiting']);

function isActiveTask(task: CangyuanMediaTask) {
  return ACTIVE_TASK_STATUSES.has(task.status);
}

function taskStatusLabel(task: CangyuanMediaTask) {
  if (task.status === 'succeeded') return '已完成';
  if (task.status === 'failed') return '失败';
  if (task.status === 'cancelled') return '已取消';
  if (task.status === 'waiting') return '等待中';
  if (task.status === 'queued' || task.status === 'pending') return '排队中';
  return '生成中';
}

function taskSort(left: CangyuanMediaTask, right: CangyuanMediaTask) {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

function providerModels(state: PublicState | null, capabilities: string[]) {
  if (!state) return [];
  return filterModelsByActiveProviders(state.models, state.providers.filter(isCangyuanProvider)).filter((model) =>
    model.enabled && model.published
    && capabilities.every((capability) => model.capabilities.includes(capability as RegistryModel['capabilities'][number])));
}

function threeDModels(state: PublicState | null) {
  return providerModels(state, ['3d-generate']).filter((model) => getCangyuan3DModelProfile(model.rawId) !== null);
}

function supportedMusicModels(state: PublicState | null) {
  return providerModels(state, ['music-generate']).filter((model) => getCangyuanMusicModelProfile(model.rawId) !== null);
}

function supportedSpeechModels(state: PublicState | null) {
  return providerModels(state, ['speech']).filter((model) => getCangyuanSpeechModelProfile(model.rawId) !== null);
}

function isTripoModel(model: RegistryModel | undefined) {
  return model?.rawId.trim().toLowerCase() === 'tripo3d';
}

function isTrellisModel(model: RegistryModel | undefined) {
  return model?.rawId.trim().toLowerCase() === 'trellis';
}

function formatCreatedAt(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : value;
}

function clampSpeechSpeed(value: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

function readError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) return error;
  }
  return fallback;
}

function isPublicHttpsUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function disposeModel(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

function GlbPreview({ url, label }: { url: string; label: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setError('');
    setLoading(true);
    let disposed = false;
    let modelRoot: THREE.Object3D | null = null;
    let frame = 0;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#171b20');
    const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 1000);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    } catch {
      setLoading(false);
      setError('浏览器当前无法创建三维预览，可直接下载 GLB 文件。');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    host.replaceChildren(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xf0f5ff, 0x343c46, 2.1));
    const keyLight = new THREE.DirectionalLight(0xfff0dc, 2.5);
    keyLight.position.set(3, 5, 4);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xc7e4ff, 1.15);
    fillLight.position.set(-4, 2, -3);
    scene.add(fillLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;

    const requestRender = () => {
      if (disposed || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const moving = controls.update();
        renderer.render(scene, camera);
        if (moving) requestRender();
      });
    };
    controls.addEventListener('change', requestRender);

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      requestRender();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const loader = new GLTFLoader();
    loader.load(url, (gltf) => {
      if (disposed) {
        disposeModel(gltf.scene);
        return;
      }
      modelRoot = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(modelRoot);
      const center = bounds.getCenter(new THREE.Vector3());
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      modelRoot.position.sub(center);
      scene.add(modelRoot);
      const radius = Math.max(0.05, sphere.radius);
      const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.55;
      camera.position.set(distance * 0.9, distance * 0.62, distance);
      camera.near = Math.max(0.001, radius / 1000);
      camera.far = Math.max(100, distance * 12);
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.minDistance = radius * 1.2;
      controls.maxDistance = distance * 4;
      controls.update();
      setLoading(false);
      requestRender();
    }, undefined, () => {
      if (!disposed) {
        setLoading(false);
        setError('模型无法在线预览，可直接下载 GLB 文件。');
      }
    });
    requestRender();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      if (modelRoot) disposeModel(modelRoot);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url]);

  return (
    <div className="cangyuan-glb-preview" aria-label={`${label} 三维模型预览`}>
      <div className="cangyuan-glb-stage" ref={hostRef} />
      {loading && <p className="cangyuan-glb-loading" role="status">正在加载模型预览…</p>}
      {error && <p className="cangyuan-glb-error" role="status">{error}</p>}
      <span className="cangyuan-glb-hint">拖动旋转 · 滚轮缩放</span>
    </div>
  );
}

export type CangyuanMediaStudioProps = {
  onOpenModels?: () => void;
  onNotify?: (message: string) => void;
};

export default function CangyuanMediaStudio({ onOpenModels, onNotify }: CangyuanMediaStudioProps) {
  const [mode, setMode] = useState<StudioMode>('speech');
  const [publicState, setPublicState] = useState<PublicState | null>(null);
  const [loadingState, setLoadingState] = useState(true);
  const [stateError, setStateError] = useState('');
  const [speechModelId, setSpeechModelId] = useState('');
  const [musicModelId, setMusicModelId] = useState('');
  const [model3dId, setModel3dId] = useState('');
  const [speechText, setSpeechText] = useState('');
  const [speechVoiceChoice, setSpeechVoiceChoice] = useState('');
  const [speechCustomVoice, setSpeechCustomVoice] = useState('');
  const [speechFormat, setSpeechFormat] = useState<SpeechOutputFormat>('mp3');
  const [speechSpeed, setSpeechSpeed] = useState(1);
  const [musicPrompt, setMusicPrompt] = useState('');
  const [musicOptions, setMusicOptions] = useState<CangyuanMusicOptions>({});
  const [prompt3d, setPrompt3d] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [generationMode, setGenerationMode] = useState<'text-to-3d' | 'image-to-3d'>('image-to-3d');
  const [texture, setTexture] = useState<'no' | 'standard' | 'HD'>('standard');
  const [pbr, setPbr] = useState(false);
  const [trellisTextureSize, setTrellisTextureSize] = useState('');
  const [trellisSeed, setTrellisSeed] = useState('');
  const [trellisMeshSimplify, setTrellisMeshSimplify] = useState('');
  const [trellisSsGuidance, setTrellisSsGuidance] = useState('');
  const [trellisSsSteps, setTrellisSsSteps] = useState('');
  const [trellisSlatGuidance, setTrellisSlatGuidance] = useState('');
  const [trellisSlatSteps, setTrellisSlatSteps] = useState('');
  const [musicTasks, setMusicTasks] = useState<CangyuanMediaTask[]>([]);
  const [threeTasks, setThreeTasks] = useState<CangyuanMediaTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<StudioNotice>(null);
  const [speechResult, setSpeechResult] = useState<SpeechResult | null>(null);
  const [continuation, setContinuation] = useState<{ sourceTaskId?: string; sourceAudioId?: string; title: string } | null>(null);
  const [previewOutput, setPreviewOutput] = useState<{ taskId: string; output: CangyuanMediaOutput; modelName: string } | null>(null);
  const speechUrlRef = useRef('');
  const musicPollRef = useRef(false);
  const threePollRef = useRef(false);
  const musicPollCursorRef = useRef<string | null>(null);
  const threePollCursorRef = useRef<string | null>(null);

  const cangyuanProviders = useMemo(() => publicState?.providers.filter(isCangyuanProvider) || [], [publicState]);
  const speechModels = useMemo(() => supportedSpeechModels(publicState), [publicState]);
  const musicModels = useMemo(() => supportedMusicModels(publicState), [publicState]);
  const models3d = useMemo(() => threeDModels(publicState), [publicState]);
  const speechModel = useMemo(() => speechModels.find((model) => model.id === speechModelId) || speechModels[0], [speechModelId, speechModels]);
  const speechProfile = useMemo(() => getCangyuanSpeechModelProfile(speechModel?.rawId || ''), [speechModel]);
  const musicModel = useMemo(() => musicModels.find((model) => model.id === musicModelId) || musicModels[0], [musicModelId, musicModels]);
  const musicProfile = useMemo(() => getCangyuanMusicModelProfile(musicModel?.rawId || ''), [musicModel]);
  const model3d = useMemo(() => models3d.find((model) => model.id === model3dId) || models3d[0], [model3dId, models3d]);
  const selectedTasks = mode === 'music' ? musicTasks : mode === '3d' ? threeTasks : [];
  const sortedMusicTasks = useMemo(() => [...musicTasks].sort(taskSort), [musicTasks]);
  const sortedThreeTasks = useMemo(() => [...threeTasks].sort(taskSort), [threeTasks]);

  const loadPublicState = useCallback(async () => {
    setLoadingState(true);
    setStateError('');
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      const data = await response.json() as PublicState & { error?: string };
      if (!response.ok) throw new Error(data.error || '读取模型配置失败');
      setPublicState(data);
    } catch (error) {
      setStateError(error instanceof Error ? error.message : '读取模型配置失败');
    } finally {
      setLoadingState(false);
    }
  }, []);

  const loadTasks = useCallback(async (kind: CangyuanMediaKind) => {
    try {
      const response = await fetch(`/api/cangyuan/${kind === 'music' ? 'music' : '3d'}`, { cache: 'no-store' });
      const data = await response.json() as { tasks?: CangyuanMediaTask[]; error?: string };
      if (!response.ok) throw new Error(data.error || '读取生成记录失败');
      const tasks = Array.isArray(data.tasks) ? data.tasks.filter((task) => task.kind === kind) : [];
      if (kind === 'music') setMusicTasks(tasks);
      else setThreeTasks(tasks);
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '读取生成记录失败' });
    }
  }, []);

  useEffect(() => {
    void loadPublicState();
    void loadTasks('music');
    void loadTasks('3d');
  }, [loadPublicState, loadTasks]);

  useEffect(() => {
    if (!speechUrlRef.current) return;
    URL.revokeObjectURL(speechUrlRef.current);
    speechUrlRef.current = '';
    setSpeechResult(null);
  }, [speechModelId]);

  useEffect(() => {
    setSpeechVoiceChoice('');
    setSpeechCustomVoice('');
    setSpeechFormat('mp3');
    setSpeechSpeed(1);
  }, [speechModel?.id]);

  useEffect(() => {
    setMusicOptions({});
  }, [musicModel?.id]);

  useEffect(() => () => {
    if (speechUrlRef.current) URL.revokeObjectURL(speechUrlRef.current);
  }, []);

  const pollTasks = useCallback(async (kind: CangyuanMediaKind) => {
    const busyRef = kind === 'music' ? musicPollRef : threePollRef;
    if (busyRef.current) return;
    const currentTasks = kind === 'music' ? musicTasks : threeTasks;
    const cursorRef = kind === 'music' ? musicPollCursorRef : threePollCursorRef;
    const batch = nextCangyuanTaskPollBatch(currentTasks, cursorRef.current, 4);
    if (!batch.tasks.length) return;
    cursorRef.current = batch.lastTaskId;
    busyRef.current = true;
    try {
      const updated = await Promise.all(batch.tasks.map(async (task) => {
        const response = await fetch(`/api/cangyuan/${kind === 'music' ? 'music' : '3d'}/tasks/${encodeURIComponent(task.id)}`, { cache: 'no-store' });
        const data = await response.json() as { task?: CangyuanMediaTask; error?: string };
        if (!response.ok || !data.task) throw new Error(data.error || '查询任务状态失败');
        return data.task;
      }));
      if (kind === 'music') setMusicTasks((current) => current.map((task) => updated.find((item) => item.id === task.id) || task));
      else setThreeTasks((current) => current.map((task) => updated.find((item) => item.id === task.id) || task));
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '查询任务状态失败' });
    } finally {
      busyRef.current = false;
    }
  }, [musicTasks, threeTasks]);

  useEffect(() => {
    if (!musicTasks.some(isActiveTask)) return;
    const timer = window.setInterval(() => void pollTasks('music'), CANGYUAN_MEDIA_TASK_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [musicTasks, pollTasks]);

  useEffect(() => {
    if (!threeTasks.some(isActiveTask)) return;
    const timer = window.setInterval(() => void pollTasks('3d'), CANGYUAN_3D_TASK_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [threeTasks, pollTasks]);

  async function submitSpeech() {
    const text = speechText.trim();
    if (!text || !speechModel || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          modelId: speechModel.id,
          source: 'workspace',
          ...(speechVoiceChoice === 'custom'
            ? (speechCustomVoice.trim() ? { voice: speechCustomVoice.trim() } : {})
            : (speechVoiceChoice ? { voice: speechVoiceChoice } : {})),
          format: speechFormat,
          ...(speechProfile?.speedRange ? { speed: speechSpeed } : {}),
        }),
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(readError(payload, `配音生成失败（${response.status}）`));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (speechUrlRef.current) URL.revokeObjectURL(speechUrlRef.current);
      speechUrlRef.current = url;
      const extension = response.headers.get('X-Audio-Extension') || 'mp3';
      setSpeechResult({
        url,
        name: `Cangyuan-speech-${Date.now()}.${extension}`,
        modelName: response.headers.get('X-Audio-Model') || speechModel.displayName,
        contentType: blob.type || 'audio/mpeg',
        extension,
      });
      setNotice({ kind: 'success', text: '配音已生成。' });
      onNotify?.('配音已生成');
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '配音生成失败' });
    } finally {
      setBusy(false);
    }
  }

  async function submitMedia(kind: CangyuanMediaKind) {
    const selectedModel = kind === 'music' ? musicModel : model3d;
    const prompt = (kind === 'music' ? musicPrompt : prompt3d).trim();
    const promptRequired = kind === 'music' || !isTrellisModel(selectedModel);
    if (!selectedModel || promptRequired && !prompt || busy) return;
    if (kind === 'music' && continuation && selectedModel.rawId !== 'suno-v6') {
      setNotice({ kind: 'error', text: '当前选择的音乐型号不支持续作，请选择 Suno v6 或清除续作来源。' });
      return;
    }
    if (kind === '3d' && (isTrellisModel(selectedModel) || isTripoModel(selectedModel) && generationMode === 'image-to-3d') && !isPublicHttpsUrl(imageUrl)) {
      setNotice({ kind: 'error', text: '图生 3D 需要可公开访问的图片 URL。' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      let input: CangyuanMediaCreateInput;
      if (kind === 'music') {
        const supportedOptions = musicProfile?.allowedOptions.reduce<CangyuanMusicOptions>((result, key) => {
          if (key !== 'sourceTaskId' && key !== 'sourceAudioId' && musicOptions[key] !== undefined) {
            Object.assign(result, { [key]: musicOptions[key] });
          }
          return result;
        }, {}) || {};
        input = {
          kind: 'music',
          modelId: selectedModel.id,
          prompt,
          options: {
            ...supportedOptions,
            ...(continuation?.sourceTaskId ? { sourceTaskId: continuation.sourceTaskId } : {}),
            ...(continuation?.sourceAudioId ? { sourceAudioId: continuation.sourceAudioId } : {}),
          },
        };
      } else if (isTripoModel(selectedModel)) {
        input = {
          kind: '3d',
          modelId: selectedModel.id,
          prompt,
          options: {
            mode: generationMode,
            ...(generationMode === 'image-to-3d' ? { imageUrl: imageUrl.trim() } : {}),
            texture,
            pbr,
          },
        };
      } else if (isTrellisModel(selectedModel)) {
        input = {
          kind: '3d',
          modelId: selectedModel.id,
          prompt,
          options: {
            imageUrl: imageUrl.trim(),
            ...(trellisTextureSize.trim() ? { textureSize: trellisTextureSize.trim() } : {}),
            ...(trellisSeed.trim() ? { seed: trellisSeed.trim() } : {}),
            ...(trellisMeshSimplify !== '' ? { meshSimplify: Number(trellisMeshSimplify) } : {}),
            ...(trellisSsGuidance !== '' ? { ssGuidanceStrength: Number(trellisSsGuidance) } : {}),
            ...(trellisSsSteps !== '' ? { ssSamplingSteps: Number(trellisSsSteps) } : {}),
            ...(trellisSlatGuidance !== '' ? { slatGuidanceStrength: Number(trellisSlatGuidance) } : {}),
            ...(trellisSlatSteps !== '' ? { slatSamplingSteps: Number(trellisSlatSteps) } : {}),
          },
        };
      } else {
        setNotice({ kind: 'error', text: '当前沧元三维型号尚未接入。' });
        return;
      }
      const response = await fetch(`/api/cangyuan/${kind === 'music' ? 'music' : '3d'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(input),
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; task?: CangyuanMediaTask; error?: string } | null;
      if (!payload?.task) throw new Error(readError(payload, '生成任务提交失败。'));
      const submittedTask = payload.task;
      if (kind === 'music') setMusicTasks((current) => [submittedTask, ...current.filter((task) => task.id !== submittedTask.id)]);
      else setThreeTasks((current) => [submittedTask, ...current.filter((task) => task.id !== submittedTask.id)]);
      if (!response.ok || payload.ok === false || submittedTask.status === 'failed') {
        setNotice({ kind: 'error', text: submittedTask.error || readError(payload, '生成任务提交失败。') });
        return;
      }
      if (kind === 'music') {
        setMusicPrompt('');
        setContinuation(null);
      } else {
        setPrompt3d('');
      }
      setNotice({ kind: 'info', text: '任务已提交，正在按服务商状态更新。' });
      onNotify?.('生成任务已提交');
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '生成任务提交失败。' });
    } finally {
      setBusy(false);
    }
  }

  function chooseContinuation(task: CangyuanMediaTask, output: CangyuanMediaOutput, includeTrack: boolean) {
    if (task.providerModel !== 'suno-v6') {
      setNotice({ kind: 'error', text: '当前音乐型号不支持续作参数。' });
      return;
    }
    if (includeTrack && output.audioId && output.jobId) {
      const continuationModel = musicModels.find((model) => model.rawId === 'suno-v6');
      if (!continuationModel) {
        setNotice({ kind: 'error', text: '请先在模型库启用 Suno v6，才能使用单曲续作。' });
        return;
      }
      setMusicModelId(continuationModel.id);
      setContinuation({ sourceTaskId: output.jobId, sourceAudioId: output.audioId, title: task.modelName });
      setMode('music');
      setNotice({ kind: 'info', text: '已选择单首曲目作为续作来源。' });
      return;
    }
    if (!output.jobId) {
      setNotice({ kind: 'error', text: '该曲目没有返回续作任务号，无法继续生成。' });
      return;
    }
    const continuationModel = musicModels.find((model) => model.rawId === 'suno-v6');
    if (!continuationModel) {
      setNotice({ kind: 'error', text: '请先在模型库启用 Suno v6，才能使用任务续作。' });
      return;
    }
    setMusicModelId(continuationModel.id);
    setContinuation({ sourceTaskId: output.jobId, title: task.modelName });
    setMode('music');
    setNotice({ kind: 'info', text: '已选择该任务作为续作来源。' });
  }

  const availableCount = mode === 'speech' ? speechModels.length : mode === 'music' ? musicModels.length : models3d.length;
  const selectedModel = mode === 'speech' ? speechModel : mode === 'music' ? musicModel : model3d;
  const currentTasks = mode === 'music' ? sortedMusicTasks : sortedThreeTasks;
  const isTripo = mode === '3d' && isTripoModel(model3d);

  return (
    <main className="cangyuan-studio" aria-label="沧元音频与三维生成">
      <header className="cangyuan-studio-header">
        <div>
          <p className="cangyuan-studio-eyebrow">沧元算力 · MEDIA</p>
          <h1>媒体生成</h1>
          <p>配音、音乐与三维模型在一个工作区中生成和管理。</p>
        </div>
        <div className="cangyuan-studio-header-meta">
          <span className={`cangyuan-connection-dot ${cangyuanProviders.length ? 'connected' : ''}`} />
          <span>{cangyuanProviders.length ? `${cangyuanProviders.length} 个沧元接口` : '未连接沧元接口'}</span>
          {onOpenModels && <button type="button" className="cangyuan-link-button" onClick={onOpenModels}>模型库</button>}
        </div>
      </header>

      <nav className="cangyuan-studio-tabs" aria-label="生成类型">
        <button type="button" className={mode === 'speech' ? 'active' : ''} aria-pressed={mode === 'speech'} onClick={() => { setMode('speech'); setNotice(null); }}>配音</button>
        <button type="button" className={mode === 'music' ? 'active' : ''} aria-pressed={mode === 'music'} onClick={() => { setMode('music'); setNotice(null); }}>音乐</button>
        <button type="button" className={mode === '3d' ? 'active' : ''} aria-pressed={mode === '3d'} onClick={() => { setMode('3d'); setNotice(null); }}>三维</button>
      </nav>

      {notice && <p className={`cangyuan-studio-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
      {stateError && <div className="cangyuan-studio-error" role="alert"><span>{stateError}</span><button type="button" onClick={() => void loadPublicState()}>重试</button></div>}
      {loadingState && <div className="cangyuan-studio-loading" role="status">正在读取沧元模型…</div>}

      {!loadingState && !stateError && (
        <div className="cangyuan-studio-layout">
          <section className="cangyuan-studio-form" aria-label={`${mode === 'speech' ? '配音' : mode === 'music' ? '音乐' : '三维'}生成设置`}>
            <div className="cangyuan-form-heading">
              <div>
                <h2>{mode === 'speech' ? '文本配音' : mode === 'music' ? '音乐生成' : '三维生成'}</h2>
                <p>{mode === 'speech' ? '提交文本并接收音频文件。' : mode === 'music' ? '输入创作提示词，任务完成后可试听、下载或续作。' : '按所选模型公开的参数生成 GLB。'}</p>
              </div>
              <span className="cangyuan-capability-count">{availableCount} 个模型</span>
            </div>

            <span className="cangyuan-field-label">生成模型</span>
            <ModelPicker
              models={mode === 'speech' ? speechModels : mode === 'music' ? musicModels : models3d}
              value={mode === 'speech' ? speechModel?.id || 'auto' : mode === 'music' ? musicModel?.id || 'auto' : model3d?.id || 'auto'}
              onChange={(value) => {
                if (mode === 'speech') setSpeechModelId(value === 'auto' ? speechModels[0]?.id || '' : value);
                else if (mode === 'music') {
                  const nextModel = musicModels.find((model) => model.id === value) || musicModels[0];
                  setMusicModelId(nextModel?.id || '');
                  if (continuation && nextModel?.rawId !== 'suno-v6') setContinuation(null);
                }
                else setModel3dId(value === 'auto' ? models3d[0]?.id || '' : value);
              }}
              capability={mode === 'speech' ? 'speech' : mode === 'music' ? 'music-generate' : '3d-generate'}
              defaultProviderId={publicState?.settings.defaultProviderId}
              defaultModelId={mode === 'speech' ? speechModels[0]?.id : mode === 'music' ? musicModels[0]?.id : models3d[0]?.id}
              placeholder="选择沧元模型"
              disabled={busy || availableCount === 0}
              className="cangyuan-model-picker"
            />

            {availableCount === 0 ? (
              <div className="cangyuan-empty-models">
                <p>没有可用的沧元{mode === 'speech' ? '配音' : mode === 'music' ? '音乐' : '三维'}模型。</p>
                <span>请先在模型库同步或启用对应能力。</span>
                {onOpenModels && <button type="button" onClick={onOpenModels}>打开模型库</button>}
              </div>
            ) : mode === 'speech' ? (
              <>
                {speechProfile && (
                  <div className="cangyuan-speech-options" aria-label="配音参数">
                    <label className="cangyuan-speech-field" htmlFor="cangyuan-speech-voice">
                      <span>音色</span>
                      <select
                        id="cangyuan-speech-voice"
                        value={speechVoiceChoice}
                        onChange={(event) => setSpeechVoiceChoice(event.target.value)}
                      >
                        <option value="">使用模型默认音色</option>
                        {speechProfile.suggestedVoices.map((voice) => <option key={voice} value={voice}>{voice}</option>)}
                        <option value="custom">自定义音色名称</option>
                      </select>
                    </label>
                    {speechVoiceChoice === 'custom' && (
                      <label className="cangyuan-speech-field" htmlFor="cangyuan-speech-custom-voice">
                        <span>自定义音色</span>
                        <input
                          id="cangyuan-speech-custom-voice"
                          type="text"
                          maxLength={100}
                          value={speechCustomVoice}
                          onChange={(event) => setSpeechCustomVoice(event.target.value)}
                          placeholder="输入服务商支持的音色名称"
                        />
                      </label>
                    )}
                    <label className="cangyuan-speech-field" htmlFor="cangyuan-speech-format">
                      <span>输出格式</span>
                      <select
                        id="cangyuan-speech-format"
                        value={speechFormat}
                        onChange={(event) => setSpeechFormat(event.target.value as SpeechOutputFormat)}
                      >
                        {speechProfile.responseFormats.map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}
                      </select>
                    </label>
                    {speechProfile.speedRange && (
                      <div className="cangyuan-speech-speed">
                        <label htmlFor="cangyuan-speech-speed-range">语速</label>
                        <input
                          id="cangyuan-speech-speed-range"
                          type="range"
                          min={speechProfile.speedRange.min}
                          max={speechProfile.speedRange.max}
                          step="0.05"
                          value={speechSpeed}
                          onChange={(event) => setSpeechSpeed(clampSpeechSpeed(Number(event.target.value), speechProfile.speedRange!.min, speechProfile.speedRange!.max))}
                        />
                        <input
                          aria-label="语速数值"
                          type="number"
                          min={speechProfile.speedRange.min}
                          max={speechProfile.speedRange.max}
                          step="any"
                          value={speechSpeed}
                          onChange={(event) => setSpeechSpeed(clampSpeechSpeed(Number(event.target.value), speechProfile.speedRange!.min, speechProfile.speedRange!.max))}
                        />
                        <small>{speechProfile.speedRange.min}–{speechProfile.speedRange.max}，默认 1</small>
                      </div>
                    )}
                  </div>
                )}
                <label className="cangyuan-field-label" htmlFor="cangyuan-speech-text">配音文本</label>
                <textarea id="cangyuan-speech-text" className="cangyuan-prompt" value={speechText} maxLength={5000} onChange={(event) => setSpeechText(event.target.value)} placeholder="输入要朗读的文本" rows={8} />
                <div className="cangyuan-field-foot"><span>音色、格式与该型号支持的语速会随请求发送</span><span>{speechText.length}/5000</span></div>
                <div className="cangyuan-submit-row">
                  <span>{speechModel?.displayName || '请选择模型'}</span>
                  <button type="button" className="cangyuan-primary-button" disabled={busy || !speechText.trim() || !speechModel || speechVoiceChoice === 'custom' && !speechCustomVoice.trim()} onClick={() => void submitSpeech()}>{busy ? '正在生成…' : '生成配音'}</button>
                </div>
                {speechResult && (
                  <div className="cangyuan-speech-result">
                    <div className="cangyuan-result-heading"><b>最新配音</b><span>{speechResult.modelName} · {speechResult.contentType}</span></div>
                    {speechResult.extension.toLowerCase() !== 'pcm' && <audio controls preload="metadata" src={speechResult.url} />}
                    {speechResult.extension.toLowerCase() === 'pcm' && <p className="cangyuan-pcm-note">PCM 已生成。此格式通常需要导入音频编辑软件播放。</p>}
                    <a className="cangyuan-download-link" href={speechResult.url} download={speechResult.name}>下载音频</a>
                  </div>
                )}
              </>
            ) : mode === 'music' ? (
              <>
                {continuation && <div className="cangyuan-continuation-banner"><span>续作来源：{continuation.title}{continuation.sourceAudioId ? ' · 指定曲目' : ' · 同任务'}</span><button type="button" aria-label="清除续作来源" onClick={() => setContinuation(null)}>清除</button></div>}
                <label className="cangyuan-field-label" htmlFor="cangyuan-music-prompt">音乐提示词</label>
                <textarea id="cangyuan-music-prompt" className="cangyuan-prompt" value={musicPrompt} maxLength={musicProfile?.promptMaxLength} onChange={(event) => setMusicPrompt(event.target.value)} placeholder={musicProfile?.family === 'su2' ? '直接描述希望生成的音乐' : musicProfile?.family === 'suno-sfx' ? '描述单个声音，例如关门声、雨打窗户' : '描述曲风、情绪、乐器与场景'} rows={8} />
                <div className="cangyuan-field-foot"><span>{musicProfile?.family === 'su2' ? '仅使用提示词；请求固定 n=1' : musicProfile?.family === 'lyria' ? '一次生成 1 首；时长与 BPM 为目标值，成片以实际结果为准' : musicProfile?.family === 'suno-sfx' ? '用于短音效，不是完整歌曲；结果可能包含多段音频' : '歌词、风格与续作字段按所选型号发送'}</span><span>{musicProfile?.promptMaxLength ? `${musicPrompt.length}/${musicProfile.promptMaxLength}` : `${musicPrompt.length} 字`}</span></div>
                {musicProfile && <CangyuanMusicOptionsFields profile={musicProfile} options={musicOptions} onChange={setMusicOptions} />}
                <div className="cangyuan-submit-row">
                  <span>{musicModel?.displayName || '请选择模型'}</span>
                  <button type="button" className="cangyuan-primary-button" disabled={busy || !musicPrompt.trim() || !musicModel} onClick={() => void submitMedia('music')}>{busy ? '正在提交…' : musicProfile?.family === 'suno-sfx' ? '生成音效' : '生成音乐'}</button>
                </div>
              </>
            ) : (
              <>
                {isTripo && (
                  <div className="cangyuan-mode-control" role="group" aria-label="三维生成方式">
                    <button type="button" aria-pressed={generationMode === 'text-to-3d'} className={generationMode === 'text-to-3d' ? 'active' : ''} onClick={() => setGenerationMode('text-to-3d')}>文生 3D</button>
                    <button type="button" aria-pressed={generationMode === 'image-to-3d'} className={generationMode === 'image-to-3d' ? 'active' : ''} onClick={() => setGenerationMode('image-to-3d')}>图生 3D</button>
                  </div>
                )}
                <label className="cangyuan-field-label" htmlFor="cangyuan-3d-prompt">物体描述</label>
                <textarea id="cangyuan-3d-prompt" className="cangyuan-prompt" value={prompt3d} onChange={(event) => setPrompt3d(event.target.value)} placeholder="描述模型的形状、材质与风格" rows={6} />
                {(isTripo && generationMode === 'image-to-3d' || isTrellisModel(model3d)) && (
                  <div className="cangyuan-image-url-field">
                    <label className="cangyuan-field-label" htmlFor="cangyuan-3d-image-url">参考图片公网 URL</label>
                    <input id="cangyuan-3d-image-url" type="url" inputMode="url" autoComplete="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://…/object.png" />
                    <small>图片需可从公网访问；不接受本地文件编号或 Base64。Trellis 必须提供图片。</small>
                  </div>
                )}
                {isTripo && (
                  <div className="cangyuan-3d-options">
                    <label className="cangyuan-select-field"><span>贴图</span><select value={texture} onChange={(event) => setTexture(event.target.value as typeof texture)}><option value="no">无贴图</option><option value="standard">标准</option><option value="HD">HD</option></select></label>
                    <label className="cangyuan-checkbox-field"><input type="checkbox" checked={pbr} onChange={(event) => setPbr(event.target.checked)} /><span>PBR 材质</span></label>
                  </div>
                )}
                {isTrellisModel(model3d) && (
                  <div className="cangyuan-3d-trellis-options">
                    <div className="cangyuan-trellis-grid">
                      <label className="cangyuan-music-text-field"><span>贴图边长</span><input list="cangyuan-trellis-texture-sizes" value={trellisTextureSize} onChange={(event) => setTrellisTextureSize(event.target.value)} placeholder="默认 1024" /><datalist id="cangyuan-trellis-texture-sizes"><option value="512" /><option value="1024" /><option value="2048" /></datalist></label>
                      <label className="cangyuan-music-text-field"><span>随机种子</span><input type="text" inputMode="numeric" value={trellisSeed} onChange={(event) => setTrellisSeed(event.target.value)} placeholder="可选" /></label>
                      <label className="cangyuan-music-text-field"><span>网格简化 0.9–0.98</span><input type="number" min="0.9" max="0.98" step="0.01" value={trellisMeshSimplify} onChange={(event) => setTrellisMeshSimplify(event.target.value)} placeholder="可选" /></label>
                      <label className="cangyuan-music-text-field"><span>结构引导 0–10</span><input type="number" min="0" max="10" step="0.1" value={trellisSsGuidance} onChange={(event) => setTrellisSsGuidance(event.target.value)} placeholder="可选" /></label>
                      <label className="cangyuan-music-text-field"><span>结构步数 1–50</span><input type="number" min="1" max="50" step="1" value={trellisSsSteps} onChange={(event) => setTrellisSsSteps(event.target.value)} placeholder="可选" /></label>
                      <label className="cangyuan-music-text-field"><span>细节引导 0–10</span><input type="number" min="0" max="10" step="0.1" value={trellisSlatGuidance} onChange={(event) => setTrellisSlatGuidance(event.target.value)} placeholder="可选" /></label>
                      <label className="cangyuan-music-text-field"><span>细节步数 1–50</span><input type="number" min="1" max="50" step="1" value={trellisSlatSteps} onChange={(event) => setTrellisSlatSteps(event.target.value)} placeholder="可选" /></label>
                    </div>
                    <p className="cangyuan-model-note">Trellis 仅支持图生。增加采样步数会变慢；简化值越大，网格越轻、细节越少。参数不填时交由模型默认处理。</p>
                  </div>
                )}
                {!isTripo && !isTrellisModel(model3d) && <p className="cangyuan-model-note">当前模型未提供已核对的专属参数。</p>}
                <div className="cangyuan-submit-row">
                  <span>{model3d?.displayName || '请选择模型'}</span>
                  <button type="button" className="cangyuan-primary-button" disabled={busy || (!prompt3d.trim() && !isTrellisModel(model3d)) || !model3d || (isTrellisModel(model3d) || generationMode === 'image-to-3d') && !imageUrl.trim()} onClick={() => void submitMedia('3d')}>{busy ? '正在提交…' : '生成 3D 模型'}</button>
                </div>
              </>
            )}
          </section>

          {mode !== 'speech' ? (
            <section className="cangyuan-studio-results" aria-label="生成任务">
              <div className="cangyuan-results-header">
                <div><h2>{mode === 'music' ? '音乐任务' : '三维任务'}</h2><p>最近 {currentTasks.length} 条 · 状态自动更新</p></div>
                <button type="button" className="cangyuan-refresh-button" aria-label="刷新任务列表" title="刷新任务列表" onClick={() => void loadTasks(mode === 'music' ? 'music' : '3d')}>刷新</button>
              </div>
              {selectedTasks.length === 0 ? (
                <div className="cangyuan-task-empty"><strong>还没有生成任务</strong><span>提交一次生成后，任务与结果会显示在这里。</span></div>
              ) : (
                <div className="cangyuan-task-list">
                  {(mode === 'music' ? sortedMusicTasks : sortedThreeTasks).map((task) => (
                    <article className="cangyuan-task-item" key={task.id}>
                      <div className="cangyuan-task-title-row">
                        <div><strong>{task.modelName}</strong><small>{formatCreatedAt(task.createdAt)}</small></div>
                        <span className={`cangyuan-task-status ${isActiveTask(task) ? 'active' : task.status}`}>{taskStatusLabel(task)}</span>
                      </div>
                      <p className="cangyuan-task-prompt">{task.input.prompt}</p>
                      {isActiveTask(task) && <p className="cangyuan-task-progress">{task.providerStatus || (task.status === 'queued' || task.status === 'pending' ? '等待服务商开始处理…' : '服务商正在生成…')}</p>}
                      {task.error && <p className="cangyuan-task-error" role="alert">{task.error}</p>}
                      {task.status === 'succeeded' && task.outputs.length === 0 && <p className="cangyuan-task-error">任务完成，但服务商没有返回结果地址。</p>}
                      {task.outputs.map((output, index) => mode === 'music' ? (
                        <div className="cangyuan-music-output" key={`${task.id}-${output.audioId || index}`}>
                          <div className="cangyuan-output-meta"><b>{output.title || (output.audioId ? `曲目 ${index + 1}` : `音乐 ${index + 1}`)}</b><span>{[output.duration ? `${output.duration} 秒` : '', output.audioId ? `曲目编号 ${output.audioId}` : '完成'].filter(Boolean).join(' · ')}</span></div>
                          <audio controls preload="none" src={output.url} />
                          <div className="cangyuan-output-actions">
                            <a href={output.url} download target="_blank" rel="noreferrer">下载</a>
                            {task.providerModel === 'suno-v6' && <button type="button" disabled={!output.audioId || !output.jobId} onClick={() => chooseContinuation(task, output, true)}>续作此曲</button>}
                            {task.providerModel === 'suno-v6' && <button type="button" disabled={!output.jobId} onClick={() => chooseContinuation(task, output, false)}>基于任务续作</button>}
                          </div>
                        </div>
                      ) : (
                        <div className="cangyuan-3d-output" key={`${task.id}-${index}`}>
                          <div className="cangyuan-output-meta"><b>GLB 模型 {index + 1}</b><span>GLTF Binary</span></div>
                          <div className="cangyuan-output-actions">
                            <button type="button" onClick={() => setPreviewOutput({ taskId: task.id, output, modelName: task.modelName })}>预览</button>
                            <a href={output.url} download target="_blank" rel="noreferrer">下载 GLB</a>
                          </div>
                        </div>
                      ))}
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <aside className="cangyuan-studio-aside" aria-label="配音使用说明">
              <h2>配音结果</h2>
              {speechResult ? <p>{speechResult.extension.toLowerCase() === 'pcm' ? `已生成 ${speechResult.name}，可下载后导入音频编辑软件。` : `已生成 ${speechResult.name}，可以试听或下载到本地。`}</p> : <p>音色、格式与可选语速按所选型号文档发送；PCM 仅提供下载。</p>}
              <hr />
              <span>模型：{speechModel?.displayName || '未选择'}</span>
              <span>服务商：沧元算力</span>
            </aside>
          )}
        </div>
      )}

      {previewOutput && <div className="cangyuan-preview-modal" role="dialog" aria-modal="true" aria-label="三维模型预览" onClick={() => setPreviewOutput(null)}>
        <div className="cangyuan-preview-dialog" onClick={(event) => event.stopPropagation()}>
          <div className="cangyuan-preview-header"><div><strong>{previewOutput.modelName}</strong><span>GLB 三维预览</span></div><button type="button" aria-label="关闭预览" onClick={() => setPreviewOutput(null)}>关闭</button></div>
          <GlbPreview url={previewOutput.output.url} label={previewOutput.modelName} />
          <div className="cangyuan-preview-footer"><span>任务 {previewOutput.taskId.slice(0, 8)}</span><a href={previewOutput.output.url} download target="_blank" rel="noreferrer">下载 GLB</a></div>
        </div>
      </div>}
    </main>
  );
}
