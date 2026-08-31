'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderConnection, RegistryModel, VideoGenerationInput } from '@/lib/types';
import type { JimengAccount } from '@/lib/jimeng-cli';
import SelectMenu from '@/components/SelectMenu';
import JimengAccountSummary from '@/components/JimengAccountSummary';
import { allRatios, getVideoModelLimits } from '@/lib/video-model-limits';
import { is65535Provider, isJimengProvider, isAgnesProvider, requiresPublicMediaRelay } from '@/lib/video-platform';
import { insertReferenceMention as insertCreativeMention, referenceMentionRange as creativeReferenceMentionRange, selectCreativeReferences, type CreativeReference } from '@/lib/creative-references';

type VideoTask = {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  modelId?: string;
  modelName?: string;
  operation?: string;
  input?: VideoGenerationInput;
  videoUrls?: string[];
  remoteVideoUrls?: string[];
  error?: string;
  createdAt: string;
  costUsd?: number;
};

type Props = {
  models: RegistryModel[];
  providers: ProviderConnection[];
  defaultModelId?: string | null;
  promptPrefill?: string | null;
  onPromptPrefillConsumed?: () => void;
  mediaPrefill?: { name: string; url: string; kind: 'image' }[];
  mediaPrefillToken?: number;
  onMediaPrefillConsumed?: () => void;
  onOpenModels: () => void;
  onOpenProviders?: () => void;
  onNotify: (message: string) => void;
};

type UploadSlot = { id?: string; name: string; url: string; kind: 'image' | 'video' | 'audio' };
type VideoOperation = 'generate' | 'edit' | 'extend';
type VideoInputMode = 'text' | 'first-frame' | 'frames' | 'reference';
type MediaTransportStatus = { mode: 'relay' | 'self-hosted' | 'unavailable'; relayConfigured: boolean; publicBaseConfigured: boolean; reachable?: boolean; publicUrl?: string };
const MAX_65535_INLINE_BYTES = 64 * 1024 * 1024;
const MAX_VIDEO_IMAGE_EDGE = 2048;
const MAX_VIDEO_IMAGE_BYTES = 4 * 1024 * 1024;
const AGNES_V20_DURATION_PRESETS = [
  { label: '约 3 秒', frames: 81, frameRate: 24 },
  { label: '约 5 秒', frames: 121, frameRate: 24 },
  { label: '约 10 秒', frames: 241, frameRate: 24 },
  { label: '约 18 秒', frames: 441, frameRate: 24 },
] as const;
const AGNES_V20_DIMENSION_PRESETS = [
  { label: '标准 3:2', width: 1152, height: 768 },
  { label: '横屏 16:9', width: 1024, height: 576 },
  { label: '竖屏 9:16', width: 576, height: 1024 },
  { label: '方形 1:1', width: 768, height: 768 },
] as const;

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function dataUriBytes(value: string) {
  if (!value.startsWith('data:')) return 0;
  const comma = value.indexOf(',');
  if (comma < 0) return 0;
  const payload = value.slice(comma + 1);
  return /;base64/i.test(value.slice(0, comma)) ? Math.floor(payload.replace(/\s/g, '').length * 3 / 4) : new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('读取图片尺寸失败'));
    image.src = dataUrl;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('压缩图片失败')), type, quality);
  });
}

function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取压缩图片失败'));
    reader.readAsDataURL(blob);
  });
}

async function compressVideoImageDataUrl(dataUrl: string) {
  if (!dataUrl.startsWith('data:image/')) return { value: dataUrl, changed: false, originalBytes: 0, outputBytes: 0 };
  const source = await loadImage(dataUrl);
  const originalBytes = dataUriBytes(dataUrl);
  const sourceMaxEdge = Math.max(source.naturalWidth, source.naturalHeight);
  if (originalBytes <= MAX_VIDEO_IMAGE_BYTES && sourceMaxEdge <= MAX_VIDEO_IMAGE_EDGE) return { value: dataUrl, changed: false, originalBytes, outputBytes: originalBytes };

  let maxEdge = Math.min(MAX_VIDEO_IMAGE_EDGE, sourceMaxEdge);
  let quality = 0.82;
  let flatten = false;
  let output: Blob | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const scale = Math.min(1, maxEdge / sourceMaxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return { value: dataUrl, changed: false, originalBytes, outputBytes: originalBytes };
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    let hasTransparency = false;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 16) {
      if (pixels[index] < 255) { hasTransparency = true; break; }
    }
    if (hasTransparency && !flatten) {
      output = await canvasBlob(canvas, 'image/png');
      if (output.size <= MAX_VIDEO_IMAGE_BYTES) break;
      flatten = true;
      continue;
    }
    if (flatten) {
      context.globalCompositeOperation = 'destination-over';
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = 'source-over';
    }
    output = await canvasBlob(canvas, 'image/jpeg', quality);
    if (output.size <= MAX_VIDEO_IMAGE_BYTES) break;
    quality = Math.max(0.52, quality - 0.06);
    maxEdge = Math.max(1024, Math.round(maxEdge * 0.88));
  }
  if (!output) return { value: dataUrl, changed: false, originalBytes, outputBytes: originalBytes };
  return { value: await blobDataUrl(output), changed: true, originalBytes, outputBytes: output.size };
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

function formatTime(value: string) {
  try { return new Date(value).toLocaleString('zh-CN', { hour12: false }); } catch { return value; }
}

function statusLabel(status: VideoTask['status']) {
  return status === 'done' ? '已完成' : status === 'failed' ? '失败' : status === 'running' ? '生成中' : '排队中';
}

function operationLabel(operation?: string) {
  return operation === 'extend' ? '扩展' : operation === 'edit' ? '编辑' : '生成';
}

function taskParameterSummary(task: VideoTask) {
  const input: Partial<VideoGenerationInput> = task.input || {};
  const isAgnesV20 = /agnes(?: video)?[- ]?v2\.0/i.test(`${task.modelName || ''} ${input.model || ''}`);
  if (isAgnesV20 && Number(input.numFrames) > 0 && Number(input.frameRate) > 0) {
    const duration = (Number(input.numFrames) / Number(input.frameRate)).toFixed(1);
    const size = Number(input.width) > 0 && Number(input.height) > 0 ? `${input.width}×${input.height}` : '默认尺寸';
    return `约 ${duration} 秒 · ${input.numFrames} 帧/${input.frameRate} FPS · ${size}`;
  }
  const duration = input.seconds ? `${input.seconds} 秒` : '默认时长';
  const ratio = input.aspectRatio || 'Auto';
  const resolution = input.resolution || input.videoSize || '默认清晰度';
  return `${duration} · ${ratio} · ${resolution}`;
}

function uploadSlot(url: string, name: string, kind: UploadSlot['kind']): UploadSlot {
  return { id: `video-ref-${Math.random().toString(36).slice(2, 10)}`, url, name, kind };
}

type VideoRestorePlan = {
  modelId: string;
  prompt: string;
  operation: VideoOperation;
  inputMode: VideoInputMode;
  seconds: number;
  ratio: string;
  resolution: string;
  firstFrame: UploadSlot | null;
  lastFrame: UploadSlot | null;
  referenceImages: UploadSlot[];
  referenceVideo: UploadSlot | null;
  audios: UploadSlot[];
  agnesWidth: number;
  agnesHeight: number;
  agnesNumFrames: number;
  agnesFrameRate: number;
  warnings: string[];
};

function buildVideoRestorePlan(task: VideoTask, models: RegistryModel[], providers: ProviderConnection[], defaultModelId?: string | null): VideoRestorePlan {
  const input: Partial<VideoGenerationInput> = task.input || {};
  const requestedModelId = task.modelId || input.model;
  const targetModel = requestedModelId && requestedModelId !== 'auto' ? models.find((model) => model.id === requestedModelId) : undefined;
  const defaultModel = defaultModelId ? models.find((model) => model.id === defaultModelId) : undefined;
  const modelForLimits = targetModel || defaultModel || models[0];
  const modelId = targetModel?.id || defaultModel?.id || 'auto';
  const provider = providers.find((item) => item.id === modelForLimits?.providerId);
  const usesAgnes = isAgnesProvider(provider) || modelForLimits?.rawId?.toLowerCase().startsWith('agnes-');
  const usesAgnesV20 = usesAgnes && /agnes-video-v2\.0/i.test(modelForLimits?.rawId || '');
  const usesAgnes25 = usesAgnes && /agnes-video-2\.5/i.test(modelForLimits?.rawId || '');
  const usesAgnesFlash = usesAgnes && /agnes-video-2\.5-flash/i.test(modelForLimits?.rawId || '');
  const capabilities = modelForLimits?.capabilities || [];
  const can = (name: string) => capabilities.includes(name as never);
  const uses65535Policy = is65535Provider(provider);
  const usesJimengCli = isJimengProvider(provider);
  const supportsEdit = can('video-edit');
  const supportsExtend = can('video-extend');
  const supportsFirst = can('video-first-frame') || can('video-generate') || uses65535Policy;
  const supportsReference = can('video-reference') || can('video-generate') || uses65535Policy;
  const supportsAudio = !usesAgnesV20 && (can('video-audio') || !uses65535Policy);
  const warnings: string[] = [];

  if (requestedModelId && requestedModelId !== 'auto' && !targetModel) warnings.push('历史模型已不可用，已切换到当前默认模型');

  let operation = (input.operation || task.operation || 'generate') as VideoOperation;
  if (operation !== 'generate' && operation !== 'edit' && operation !== 'extend') operation = 'generate';
  if (operation === 'edit' && !supportsEdit) {
    operation = 'generate';
    warnings.push('当前模型不支持视频编辑，已切换为生成视频');
  }
  if (operation === 'extend' && !supportsExtend) {
    operation = 'generate';
    warnings.push('当前模型不支持视频扩展，已切换为生成视频');
  }

  const cleanUrl = (value: unknown) => typeof value === 'string' ? value.trim() : '';
  const firstUrl = cleanUrl(input.firstFrame);
  const lastUrl = cleanUrl(input.lastFrame);
  const sourceReferenceUrls = Array.isArray(input.referenceImages)
    ? input.referenceImages.map(cleanUrl).filter(Boolean)
    : [];
  let inputMode: VideoInputMode = 'text';
  let firstFrame: UploadSlot | null = null;
  let lastFrame: UploadSlot | null = null;
  let referenceImages: UploadSlot[] = [];

  if (firstUrl && lastUrl) {
    if (supportsFirst) {
      inputMode = 'frames';
      firstFrame = uploadSlot(firstUrl, '首帧', 'image');
      lastFrame = uploadSlot(lastUrl, '尾帧', 'image');
    } else if (supportsReference) {
      inputMode = 'reference';
      const maxReferenceImages = getVideoModelLimits(modelForLimits, provider).maxReferenceImages;
      referenceImages = [uploadSlot(firstUrl, '参考图 1', 'image'), uploadSlot(lastUrl, '参考图 2', 'image')].slice(0, maxReferenceImages);
      warnings.push('当前模型不支持首尾帧，已改用参考图');
      if (maxReferenceImages < 2) warnings.push(`参考图已按当前模型限制保留前 ${maxReferenceImages} 张`);
    } else {
      warnings.push('当前模型不支持图片输入，已切换为纯文本');
    }
  } else if (firstUrl) {
    if (supportsFirst) {
      inputMode = 'first-frame';
      firstFrame = uploadSlot(firstUrl, '首帧', 'image');
    } else if (supportsReference) {
      inputMode = 'reference';
      referenceImages = [uploadSlot(firstUrl, '参考图 1', 'image')];
      warnings.push('当前模型不支持首帧，已改用参考图');
    } else {
      warnings.push('当前模型不支持图片输入，已切换为纯文本');
    }
  } else if (sourceReferenceUrls.length) {
    if (supportsReference) {
      inputMode = 'reference';
      const maxReferenceImages = getVideoModelLimits(modelForLimits, provider).maxReferenceImages;
      referenceImages = sourceReferenceUrls.slice(0, maxReferenceImages).map((url, index) => uploadSlot(url, `参考图 ${index + 1}`, 'image'));
      if (sourceReferenceUrls.length > referenceImages.length) warnings.push(`参考图已按当前模型限制保留前 ${referenceImages.length} 张`);
    } else if (supportsFirst) {
      if (sourceReferenceUrls.length > 2) warnings.push('当前模型不支持多张参考图，已保留首尾两张');
      inputMode = sourceReferenceUrls.length > 1 ? 'frames' : 'first-frame';
      firstFrame = uploadSlot(sourceReferenceUrls[0], '首帧', 'image');
      lastFrame = sourceReferenceUrls[1] ? uploadSlot(sourceReferenceUrls[sourceReferenceUrls.length - 1], '尾帧', 'image') : null;
      if (!lastFrame) warnings.push('当前模型不支持参考图，已改用首帧');
      else warnings.push('当前模型不支持参考图，已改用首尾帧');
    } else {
      warnings.push('当前模型不支持图片输入，已切换为纯文本');
    }
  }

  const inputReferenceVideo = cleanUrl(input.referenceVideo)
    || (Array.isArray(input.referenceVideos) ? input.referenceVideos.map(cleanUrl).find(Boolean) || '' : '');
  const referenceVideo = inputReferenceVideo && (operation !== 'generate' || (usesAgnes25 && !usesAgnesFlash && inputMode === 'reference')) ? uploadSlot(inputReferenceVideo, '参考视频', 'video') : null;
  if (inputReferenceVideo && !referenceVideo) warnings.push('当前操作不使用参考视频，已清除该素材');

  const sourceAudioUrls = Array.isArray(input.audios) && input.audios.length
    ? input.audios.map(cleanUrl).filter(Boolean)
    : cleanUrl(input.audio) ? [cleanUrl(input.audio)] : [];
  let audios: UploadSlot[] = [];
  if (sourceAudioUrls.length && supportsAudio) {
    const maxAudios = getVideoModelLimits(modelForLimits, provider).maxAudios;
    audios = sourceAudioUrls.slice(0, maxAudios).map((url, index) => uploadSlot(url, `音频 ${index + 1}`, 'audio'));
    if (sourceAudioUrls.length > audios.length) warnings.push(`音频已按当前模型限制保留前 ${audios.length} 段`);
  } else if (sourceAudioUrls.length) {
    warnings.push('当前模型不支持音频输入，已清除音频素材');
  }

  const baseLimits = getVideoModelLimits(modelForLimits, provider);
  const usesJimengMultiframe = usesJimengCli && inputMode === 'reference' && referenceImages.length > 1 && !referenceVideo && !audios.length;
  const limits = usesJimengMultiframe ? {
    ...baseLimits,
    minSeconds: 1,
    maxSeconds: 8,
    allowedSeconds: Array.from({ length: 8 }, (_, index) => index + 1),
    resolutions: ['720p', '1080p'],
  } : baseLimits;
  const durationValues = limits.fixedSeconds ? [limits.fixedSeconds] : limits.allowedSeconds || [1, 3, 5, 8, 10, 15, 30, 60];
  const requestedSeconds = Number(input.seconds || 5);
  const seconds = durationValues.includes(requestedSeconds) && requestedSeconds >= limits.minSeconds && requestedSeconds <= limits.maxSeconds
    ? requestedSeconds
    : durationValues.find((value) => value >= limits.minSeconds && value <= limits.maxSeconds) || limits.minSeconds;
  if (input.seconds !== undefined && seconds !== requestedSeconds) warnings.push(`时长已调整为当前模型支持的 ${seconds} 秒`);

  const requestedRatio = typeof input.aspectRatio === 'string' && allRatios.includes(input.aspectRatio) ? input.aspectRatio : '16:9';
  if (input.aspectRatio && requestedRatio !== input.aspectRatio) warnings.push('比例已调整为当前支持的选项');
  const requestedResolution = typeof input.resolution === 'string'
    ? input.resolution
    : typeof input.videoSize === 'string'
      ? input.videoSize
      : '720p';
  const resolution = limits.resolutions.find(
    (value) => value.toLowerCase() === requestedResolution.trim().toLowerCase(),
  ) || limits.resolutions[0] || '720p';
  if (input.resolution && resolution.toLowerCase() !== input.resolution.trim().toLowerCase()) warnings.push(`分辨率已调整为 ${resolution}`);

  return {
    modelId,
    prompt: typeof input.prompt === 'string' ? input.prompt : '',
    operation,
    inputMode,
    seconds,
    ratio: requestedRatio,
    resolution,
    firstFrame,
    lastFrame,
    referenceImages,
    referenceVideo,
    audios,
    agnesWidth: usesAgnesV20 && Number.isInteger(Number(input.width)) && Number(input.width) > 0 ? Number(input.width) : 1152,
    agnesHeight: usesAgnesV20 && Number.isInteger(Number(input.height)) && Number(input.height) > 0 ? Number(input.height) : 768,
    agnesNumFrames: usesAgnesV20 && Number.isInteger(Number(input.numFrames)) && Number(input.numFrames) >= 1 && Number(input.numFrames) <= 441 && (Number(input.numFrames) - 1) % 8 === 0 ? Number(input.numFrames) : 81,
    agnesFrameRate: usesAgnesV20 && Number.isInteger(Number(input.frameRate)) && Number(input.frameRate) >= 1 && Number(input.frameRate) <= 60 ? Number(input.frameRate) : 24,
    warnings,
  };
}

export default function VideoStudio({ models, providers, defaultModelId, promptPrefill, onPromptPrefillConsumed, mediaPrefill, mediaPrefillToken, onMediaPrefillConsumed, onOpenModels, onOpenProviders, onNotify }: Props) {
  const [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState(defaultModelId || 'auto');
  const [operation, setOperation] = useState<VideoOperation>('generate');
  const [inputMode, setInputMode] = useState<VideoInputMode>('text');
  const [seconds, setSeconds] = useState(5);
  const [ratio, setRatio] = useState('16:9');
  const [resolution, setResolution] = useState('720p');
  const [agnesWidth, setAgnesWidth] = useState(1152);
  const [agnesHeight, setAgnesHeight] = useState(768);
  const [agnesNumFrames, setAgnesNumFrames] = useState(81);
  const [agnesFrameRate, setAgnesFrameRate] = useState(24);
  const [firstFrame, setFirstFrame] = useState<UploadSlot | null>(null);
  const [lastFrame, setLastFrame] = useState<UploadSlot | null>(null);
  const [referenceImages, setReferenceImages] = useState<UploadSlot[]>([]);
  const [referenceVideo, setReferenceVideo] = useState<UploadSlot | null>(null);
  const [audios, setAudios] = useState<UploadSlot[]>([]);
  const [previewImage, setPreviewImage] = useState<UploadSlot | null>(null);
  const [referenceMentionOpen, setReferenceMentionOpen] = useState(false);
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mediaStatus, setMediaStatus] = useState<MediaTransportStatus | null>(null);
  const [mediaStatusBusy, setMediaStatusBusy] = useState(false);
  const [jimengAccount, setJimengAccount] = useState<JimengAccount | null>(null);
  const [jimengAccountCheckedAt, setJimengAccountCheckedAt] = useState('');
  const [jimengAccountError, setJimengAccountError] = useState('');
  const [jimengAccountBusy, setJimengAccountBusy] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const next = promptPrefill?.trim();
    if (!next) return;
    setPrompt((current) => {
      const existing = current.trimEnd();
      return existing ? `${existing}\n${next}` : next;
    });
    onPromptPrefillConsumed?.();
    window.setTimeout(() => promptRef.current?.focus(), 0);
  }, [promptPrefill]);

  const selectedModel = models.find((model) => model.id === modelId) || models.find((model) => model.id === defaultModelId) || models[0];
  const selectedProvider = providers.find((provider) => provider.id === selectedModel?.providerId);
  const jimengProvider = useMemo(() => providers.find((provider) => provider.platform === 'jimeng-cli' || provider.videoTransport === 'jimeng-cli'), [providers]);

  async function refreshJimengAccount() {
    if (!jimengProvider || jimengAccountBusy) return;
    setJimengAccountBusy(true);
    setJimengAccountError('');
    try {
      const response = await fetch('/api/providers/jimeng', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refresh-account' }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '读取即梦账户信息失败，请稍后重试。');
      setJimengAccount(data.account || null);
      setJimengAccountCheckedAt(data.accountCheckedAt || new Date().toISOString());
      setJimengAccountError(data.accountError || '');
    } catch (error) {
      setJimengAccount(null);
      setJimengAccountError(error instanceof Error ? error.message : '读取即梦账户信息失败，请稍后重试。');
    } finally { setJimengAccountBusy(false); }
  }

  useEffect(() => {
    if (!jimengProvider) {
      setJimengAccount(null);
      setJimengAccountCheckedAt('');
      setJimengAccountError('');
      return;
    }
    void refreshJimengAccount();
  }, [jimengProvider?.id]);

  const nativeTask = selectedProvider?.videoTransport === 'native-task' || selectedProvider?.platform === '65535';
  const uses65535Policy = is65535Provider(selectedProvider);
  const usesJimengCli = isJimengProvider(selectedProvider);
  const usesAgnes = isAgnesProvider(selectedProvider) || selectedModel?.rawId?.toLowerCase().startsWith('agnes-');
  const usesAgnesV20 = usesAgnes && /agnes-video-v2\.0/i.test(selectedModel?.rawId || '');
  const usesAgnes25 = usesAgnes && /agnes-video-2\.5/i.test(selectedModel?.rawId || '');
  const usesAgnesFlash = usesAgnes && /agnes-video-2\.5-flash/i.test(selectedModel?.rawId || '');
  const usesMediaRelay = requiresPublicMediaRelay(selectedProvider, {
    hasVideoModel: selectedModel?.kind === 'video' || selectedModel?.capabilities?.includes('video-generate'),
  });
  const supportsReferenceMentions = !usesJimengCli;

  async function refreshMediaStatus() {
    if (mediaStatusBusy) return;
    setMediaStatusBusy(true);
    try {
      const response = await fetch('/api/relay/status', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !['relay', 'self-hosted', 'unavailable'].includes(data.mode)) throw new Error('status unavailable');
      setMediaStatus(data as MediaTransportStatus);
    } catch {
      setMediaStatus({ mode: 'unavailable', relayConfigured: false, publicBaseConfigured: false });
    } finally { setMediaStatusBusy(false); }
  }

  useEffect(() => {
    if (!usesMediaRelay) {
      setMediaStatus(null);
      return;
    }
    void refreshMediaStatus();
    const timer = window.setInterval(() => void refreshMediaStatus(), 15_000);
    return () => window.clearInterval(timer);
  }, [usesMediaRelay, selectedProvider?.id]);

  const baseModelLimits = useMemo(() => getVideoModelLimits(selectedModel, selectedProvider), [selectedModel?.rawId, selectedModel?.displayName, selectedProvider?.platform, selectedProvider?.videoTransport, selectedProvider?.baseUrl, selectedProvider?.videoBaseUrl]);
  const usesJimengMultiframe = usesJimengCli && inputMode === 'reference' && referenceImages.length > 1 && !referenceVideo && !audios.length;
  const modelLimits = useMemo(() => usesJimengMultiframe ? {
    ...baseModelLimits,
    minSeconds: 1,
    maxSeconds: 8,
    allowedSeconds: Array.from({ length: 8 }, (_, index) => index + 1),
    resolutions: ['720p', '1080p'],
    notes: [...baseModelLimits.notes, '即梦多帧模式：2–20 张图片；3 张以上图片按转场提示处理', '多帧模式仅支持 720p/1080p'],
  } : baseModelLimits, [baseModelLimits, usesJimengMultiframe]);
  const capabilities = selectedModel?.capabilities || [];
  const can = (name: string) => capabilities.includes(name as never);
  const supportsEdit = can('video-edit');
  const supportsExtend = can('video-extend');
  // A plain video-generate capability means the provider did not publish
  // granular input metadata. Keep the common image-to-video controls visible
  // in that case; only an explicit capability response should narrow them.
  const supportsFirst = can('video-first-frame') || can('video-generate') || uses65535Policy;
  const supportsReference = can('video-reference') || can('video-generate') || uses65535Policy;
  const referenceCandidates = useMemo<CreativeReference[]>(() => [
    ...referenceImages.map((item, index) => ({ id: item.id || `video-image-${index + 1}`, kind: 'image' as const, name: item.name, url: item.url })),
    ...(referenceVideo ? [{ id: referenceVideo.id || 'video-reference-video', kind: 'video' as const, name: referenceVideo.name, url: referenceVideo.url }] : []),
  ], [referenceImages, referenceVideo]);
  // 65535's documented native task schema currently has no audio input field.
  // Only expose audio there when the model metadata explicitly advertises it;
  // other compatible providers keep the existing flexible control.
  const supportsAudio = !usesAgnesV20 && (can('video-audio') || !uses65535Policy);
  const modelOptions = [{ value: 'auto', label: '自动选择', description: '使用当前默认视频模型' }, ...models.map((model) => ({ value: model.id, label: model.displayName, description: model.providerName }))];
  const operationOptions = [{ value: 'generate' as const, label: '生成视频', description: '根据提示词和画面输入生成视频' }, ...(supportsEdit ? [{ value: 'edit' as const, label: '视频编辑', description: '参考已有视频进行修改' }] : []), ...(supportsExtend ? [{ value: 'extend' as const, label: '视频扩展', description: '延续已有视频的镜头' }] : [])];
  const showOperationField = operationOptions.length > 1;
  const inputModeOptions = useMemo(() => [{ value: 'text' as const, label: '纯文本 · 不使用图片', description: '从提示词直接生成' }, ...(supportsFirst ? [{ value: 'first-frame' as const, label: '首帧 · 控制开场画面', description: '上传一张开场参考图' }, { value: 'frames' as const, label: uses65535Policy ? '双参考图 · 控制起止' : '首尾帧 · 约束镜头起止', description: uses65535Policy ? '65535 将首帧和尾帧按两张参考图提交' : '上传首帧和尾帧' }] : []), ...(supportsReference ? [{ value: 'reference' as const, label: '参考图 · 保持主体风格', description: `最多添加 ${modelLimits.maxReferenceImages} 张参考图` }] : [])], [modelLimits.maxReferenceImages, supportsFirst, supportsReference, uses65535Policy]);
  const durationOptions = useMemo(() => {
    const values = modelLimits.fixedSeconds ? [modelLimits.fixedSeconds] : modelLimits.allowedSeconds || [1, 3, 5, 8, 10, 15, 30, 60];
    return values.filter((value) => value >= modelLimits.minSeconds && value <= modelLimits.maxSeconds).map((value) => ({ value, label: `${value} 秒` }));
  }, [modelLimits]);
  const ratioOptions = allRatios.map((value) => ({ value, label: value === 'auto' ? 'Auto' : value, description: value === 'auto' ? '模型自选 / 跟随首帧' : value.includes(':') ? (value.split(':')[0] === value.split(':')[1] ? '方形' : Number(value.split(':')[0]) > Number(value.split(':')[1]) ? '横屏' : '竖屏') : '模型自选' }));
  const resolutionOptions = modelLimits.resolutions.map((value) => ({ value, label: value, description: value === '480p' ? '快速生成' : value === '1080p' ? '高清' : '推荐' }));
  const selectedAgnesV20Duration = AGNES_V20_DURATION_PRESETS.find((preset) => preset.frames === agnesNumFrames && preset.frameRate === agnesFrameRate);
  const selectedAgnesV20Dimensions = AGNES_V20_DIMENSION_PRESETS.find((preset) => preset.width === agnesWidth && preset.height === agnesHeight);

  function applyAgnesV20Duration(preset: typeof AGNES_V20_DURATION_PRESETS[number]) {
    setAgnesNumFrames(preset.frames);
    setAgnesFrameRate(preset.frameRate);
  }

  function applyAgnesV20Dimensions(preset: typeof AGNES_V20_DIMENSION_PRESETS[number]) {
    setAgnesWidth(preset.width);
    setAgnesHeight(preset.height);
  }

  useEffect(() => { if (defaultModelId && modelId === 'auto') setModelId(defaultModelId); }, [defaultModelId, modelId]);

  useEffect(() => {
    if (operation === 'edit' && !supportsEdit) setOperation('generate');
    if (operation === 'extend' && !supportsExtend) setOperation('generate');
  }, [operation, supportsEdit, supportsExtend]);

  useEffect(() => {
    if (!inputModeOptions.some((option) => option.value === inputMode)) setInputMode(inputModeOptions[0]?.value || 'text');
  }, [inputMode, inputModeOptions]);

  useEffect(() => {
    if (!durationOptions.some((option) => option.value === seconds)) setSeconds(durationOptions[0]?.value || modelLimits.minSeconds);
    if (!modelLimits.resolutions.includes(resolution)) setResolution(modelLimits.resolutions[0] || '720p');
    setReferenceImages((old) => old.length > modelLimits.maxReferenceImages ? old.slice(0, modelLimits.maxReferenceImages) : old);
    setAudios((old) => !supportsAudio ? [] : old.length > modelLimits.maxAudios ? old.slice(0, modelLimits.maxAudios) : old);
  }, [durationOptions, modelLimits, resolution, seconds, supportsAudio]);

  // Consume reference images pushed from the record view and map them to the
  // best-supported video input mode, degrading gracefully when the selected
  // model cannot accept the full set.
  useEffect(() => {
    if (!mediaPrefillToken || !mediaPrefill?.length) return;
    const images = mediaPrefill.filter((item) => item.kind === 'image');
    if (!images.length) {
      onMediaPrefillConsumed?.();
      return;
    }
    const maxReference = modelLimits.maxReferenceImages || images.length;
    const applyText = () => {
      setInputMode('text');
      setFirstFrame(null);
      setLastFrame(null);
      setReferenceImages([]);
      onNotify('当前模型不支持图片输入，已切换到纯文本');
    };
    const applyFirstFrame = (list: UploadSlot[]) => {
      setInputMode('first-frame');
      setFirstFrame(list[0] || null);
      setLastFrame(null);
      setReferenceImages([]);
    };
    const applyFrames = (list: UploadSlot[]) => {
      setInputMode('frames');
      setFirstFrame(list[0] || null);
      setLastFrame(list[1] || null);
      setReferenceImages([]);
    };
    const applyReference = (list: UploadSlot[]) => {
      setInputMode('reference');
      setReferenceImages(list);
      setFirstFrame(null);
      setLastFrame(null);
    };

    if (images.length === 1) {
      if (supportsFirst) applyFirstFrame(images);
      else if (supportsReference) {
        applyReference(images);
        onNotify('当前模型不支持首帧，已改用参考图');
      } else applyText();
    } else if (images.length === 2) {
      if (supportsFirst) applyFrames(images);
      else if (supportsReference) {
        applyReference(images);
        onNotify('当前模型不支持首尾帧，已改用参考图');
      } else applyText();
    } else {
      const capped = images.length > maxReference ? images.slice(0, maxReference) : images;
      if (capped.length !== images.length) onNotify('已保留前 ' + maxReference + ' 张参考图');
      if (supportsReference) applyReference(capped);
      else if (supportsFirst) {
        applyFrames(capped);
        onNotify('当前模型不支持多帧参考，已改用首尾帧');
      } else applyText();
    }
    onMediaPrefillConsumed?.();
  }, [mediaPrefillToken]);

  async function refreshTasks() {
    try {
      const response = await fetch('/api/video/tasks?limit=30', { cache: 'no-store' });
      const data = await response.json();
      if (response.ok && Array.isArray(data.tasks)) setTasks(data.tasks);
    } catch {}
  }

  useEffect(() => {
    void refreshTasks();
    const timer = window.setInterval(() => void refreshTasks(), 3500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!tasks.some((task) => task.status === 'pending' || task.status === 'running')) return;
    const timer = window.setTimeout(() => void refreshTasks(), 2200);
    return () => window.clearTimeout(timer);
  }, [tasks]);

  useEffect(() => {
    setSelectedTaskId((current) => {
      if (current && tasks.some((task) => task.id === current)) return current;
      return tasks.find((task) => task.status === 'done' && task.videoUrls?.length)?.id || tasks[0]?.id || null;
    });
  }, [tasks]);

  async function selectFile(key: string, onChange: (slot: UploadSlot | null) => void, kind: UploadSlot['kind']) {
    const input = inputRefs.current[key];
    if (!input?.files?.[0]) return;
    try {
      const file = input.files[0];
      onChange({ name: file.name, url: await readFile(file), kind });
    } catch (error) { onNotify(error instanceof Error ? error.message : '读取文件失败'); }
    input.value = '';
  }

  async function addReferences(files: FileList | null) {
    if (!files?.length) return;
    const next = [...referenceImages];
    for (const file of Array.from(files).slice(0, Math.max(0, modelLimits.maxReferenceImages - next.length))) {
      if (!file.type.startsWith('image/')) continue;
      next.push({ name: file.name, url: await readFile(file), kind: 'image' });
    }
    setReferenceImages(next);
  }

  async function addAudios(files: FileList | null) {
    if (!files?.length) return;
    const next = [...audios];
    for (const file of Array.from(files).slice(0, Math.max(0, modelLimits.maxAudios - next.length))) {
      if (!file.type.startsWith('audio/')) continue;
      next.push({ name: file.name, url: await readFile(file), kind: 'audio' });
    }
    setAudios(next);
  }

  function reorderReferences(from: number, to: number) {
    setReferenceImages((old) => {
      if (from === to || from < 0 || to < 0 || from >= old.length || to >= old.length) return old;
      const next = [...old];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function moveReference(index: number, direction: -1 | 1) {
    reorderReferences(index, index + direction);
  }

  function referenceMentionRange(value: string, cursor: number) {
    return creativeReferenceMentionRange(value, cursor);
  }

  function referenceMentionIsOpen(value: string, cursor: number) {
    return supportsReferenceMentions && (inputMode === 'reference' || operation !== 'generate') && referenceCandidates.length > 0 && Boolean(referenceMentionRange(value, cursor));
  }

  function insertReferenceMention(index: number) {
    const cursor = promptRef.current?.selectionStart ?? prompt.length;
    const inserted = insertCreativeMention(prompt, cursor, index);
    setPrompt(inserted.value);
    setReferenceMentionOpen(false);
    requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(inserted.cursor, inserted.cursor);
    });
  }

  function clearReferences() {
    setReferenceImages([]);
    setReferenceMentionOpen(false);
    setPrompt((value) => value.replace(/@[0-9]+\s*/g, '').replace(/[ \t]{2,}/g, ' '));
  }

  function hasDraft() {
    return Boolean(
      prompt.trim()
      || firstFrame
      || lastFrame
      || referenceImages.length
      || referenceVideo
      || audios.length
      || operation !== 'generate'
      || inputMode !== 'text'
      || seconds !== 5
      || ratio !== '16:9'
      || resolution !== '720p'
      || (modelId !== 'auto' && modelId !== defaultModelId),
    );
  }

  function restoreTask(task: VideoTask) {
    if (!task.input) return onNotify('这条任务没有保存完整参数，无法恢复');
    if (hasDraft() && !window.confirm('恢复历史参数会替换左侧当前草稿，是否继续？')) return;

    const plan = buildVideoRestorePlan(task, models, providers, defaultModelId);
    setPrompt(plan.prompt);
    setModelId(plan.modelId);
    setOperation(plan.operation);
    setInputMode(plan.inputMode);
    setSeconds(plan.seconds);
    setRatio(plan.ratio);
    setResolution(plan.resolution);
    setFirstFrame(plan.firstFrame);
    setLastFrame(plan.lastFrame);
    setReferenceImages(plan.referenceImages);
    setReferenceVideo(plan.referenceVideo);
    setAudios(plan.audios);
    setAgnesWidth(plan.agnesWidth);
    setAgnesHeight(plan.agnesHeight);
    setAgnesNumFrames(plan.agnesNumFrames);
    setAgnesFrameRate(plan.agnesFrameRate);
    setReferenceMentionOpen(false);
    setPreviewImage(null);
    setSelectedTaskId(task.id);
    onNotify(plan.warnings.length ? `已恢复参数；${plan.warnings.join('；')}` : '已恢复这条任务的全部参数');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim()) return onNotify('请先输入视频提示词');
    if (!models.length) return onNotify('请先在模型库启用一个视频模型');
    if (inputMode === 'first-frame' && !firstFrame) return onNotify('请先添加首帧图片');
    if (inputMode === 'frames' && (!firstFrame || !lastFrame)) return onNotify(`${uses65535Policy ? '双参考图' : '首尾帧'}模式请先添加首帧和尾帧图片`);
    if (inputMode === 'reference' && !referenceImages.length && !(usesAgnes25 && (referenceVideo || audios.length))) return onNotify('参考图模式请先添加图片、视频或音频素材');
    if (referenceImages.length > modelLimits.maxReferenceImages) return onNotify(`当前模型最多接收 ${modelLimits.maxReferenceImages} 张参考图`);
    if (audios.length > modelLimits.maxAudios) return onNotify(`当前模型最多接收 ${modelLimits.maxAudios} 段音频`);
    if (usesAgnesV20 && (!Number.isInteger(agnesNumFrames) || agnesNumFrames < 1 || agnesNumFrames > 441 || (agnesNumFrames - 1) % 8 !== 0)) return onNotify('Agnes V2.0 帧数必须不超过 441 且满足 8n + 1');
    if (usesAgnesV20 && (!Number.isInteger(agnesWidth) || !Number.isInteger(agnesHeight) || agnesWidth < 64 || agnesHeight < 64 || agnesWidth > 3840 || agnesHeight > 3840 || agnesWidth % 64 !== 0 || agnesHeight % 64 !== 0)) return onNotify('Agnes V2.0 宽度和高度必须是 64 的倍数，范围为 64–3840');
    if (usesAgnesV20 && (!Number.isInteger(agnesFrameRate) || agnesFrameRate < 1 || agnesFrameRate > 60)) return onNotify('Agnes V2.0 帧率必须在 1–60 之间');
    if (uses65535Policy && audios.length && !can('video-audio')) return onNotify('当前 65535 视频模型未声明音频输入，已自动阻止提交；移除音频即可继续生成。');
    const referenceSelection = selectCreativeReferences(prompt, referenceCandidates);
    if (referenceSelection.invalidNumbers.length) return onNotify(`提示词中的引用编号无效：${referenceSelection.invalidNumbers.map((number) => `@${number}`).join('、')}`);
    if (referenceSelection.hasMentions && inputMode !== 'reference' && operation === 'generate') return onNotify('提示词中有 @引用，请先切换到参考图输入方式');
    const selectedReferenceImages = referenceSelection.references.filter((reference) => reference.kind === 'image');
    const selectedReferenceVideos = referenceSelection.references.filter((reference) => reference.kind === 'video');
    setBusy(true);
    try {
      const inheritsVideoSettings = operation !== 'generate' && (modelLimits.inheritVideoSettingsFor?.includes(operation) || false);
      const omitsAspectRatioResolution = inheritsVideoSettings || (operation !== 'generate' && (modelLimits.omitAspectRatioResolutionFor?.includes(operation) || false));
      const input: VideoGenerationInput = {
        prompt,
        operation,
        ...(!usesAgnesV20 && !inheritsVideoSettings ? { seconds } : {}),
        ...(!usesAgnesV20 && !omitsAspectRatioResolution ? { aspectRatio: ratio, resolution } : {}),
        firstFrame: inputMode === 'first-frame' || inputMode === 'frames' ? firstFrame?.url : undefined,
        lastFrame: inputMode === 'frames' ? lastFrame?.url : undefined,
        referenceImages: inputMode === 'reference' ? selectedReferenceImages.map((item) => item.url!).filter(Boolean) : [],
        referenceVideos: inputMode === 'reference' ? selectedReferenceVideos.map((item) => item.url!).filter(Boolean) : [],
        referenceVideo: usesAgnes
          ? (!usesAgnesV20 && !usesAgnesFlash && inputMode === 'reference' ? selectedReferenceVideos[0]?.url : undefined)
          : (inputMode === 'reference' || operation !== 'generate') ? selectedReferenceVideos[0]?.url || (referenceSelection.hasMentions ? undefined : referenceVideo?.url) : undefined,
        audios: usesAgnes ? (usesAgnes25 && inputMode === 'reference' ? audios.map((item) => item.url) : []) : audios.map((item) => item.url),
        audio: usesAgnes ? (usesAgnes25 && inputMode === 'reference' ? audios[0]?.url : undefined) : audios[0]?.url,
        ...(usesAgnes && !usesAgnesV20 ? { videoMode: inputMode === 'text' ? 'text' as const : inputMode === 'reference' ? 'reference' as const : 'keyframe' as const } : {}),
        ...(usesAgnesV20 ? { width: agnesWidth, height: agnesHeight, numFrames: agnesNumFrames, frameRate: agnesFrameRate } : {}),
        ...(usesAgnes25 ? { videoSize: resolution.toUpperCase() as '720P' | '960P' | '2K' } : {}),
      };
      const [compressedFirstFrame, compressedLastFrame, compressedReferences] = await Promise.all([
        input.firstFrame ? compressVideoImageDataUrl(input.firstFrame) : null,
        input.lastFrame ? compressVideoImageDataUrl(input.lastFrame) : null,
        Promise.all((input.referenceImages || []).map((value) => compressVideoImageDataUrl(value))),
      ]);
      const compressedInput: VideoGenerationInput = {
        ...input,
        firstFrame: compressedFirstFrame?.value,
        lastFrame: compressedLastFrame?.value,
        referenceImages: compressedReferences.map((result) => result.value),
      };
      const hasLocalRelayImage = usesMediaRelay && [compressedInput.firstFrame, compressedInput.lastFrame, ...(compressedInput.referenceImages || [])]
        .some((value) => Boolean(value && (/^data:image\//i.test(value) || /^\/(?:api\/)?storage\//i.test(value))));
      const compressionResults = [compressedFirstFrame, compressedLastFrame, ...compressedReferences].filter((result): result is NonNullable<typeof result> => Boolean(result));
      const compressedCount = compressionResults.filter((result) => result.changed).length;
      if (compressedCount) onNotify(`已自动压缩 ${compressedCount} 张视频参考图，保留原图比例后提交`);
      if (hasLocalRelayImage) onNotify('正在安全准备本地图片，完成后会自动清理临时副本…');
      if (nativeTask) {
        const localMedia = [compressedInput.firstFrame, compressedInput.lastFrame, ...(compressedInput.referenceImages || []), ...(compressedInput.referenceVideos || []), compressedInput.referenceVideo, ...(compressedInput.audios || [])].filter((value): value is string => Boolean(value));
        const inlineBytes = localMedia.reduce((total, value) => total + dataUriBytes(value), 0);
        if (inlineBytes > MAX_65535_INLINE_BYTES) throw new Error(`${uses65535Policy ? '65535 原生接口' : '当前原生异步接口'}的本地素材请求不能超过 64 MiB（当前约 ${formatBytes(inlineBytes)}）。请换用更小的视频/图片；已阻止提交，不会扣费。`);
      }
      const response = await fetch('/api/video/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ model: modelId, ...compressedInput }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && !data.task) throw new Error(data.error || '提交视频任务失败');
      if (data.task) {
        setTasks((old) => [data.task, ...old.filter((task) => task.id !== data.task.id)]);
        setSelectedTaskId(data.task.id);
      }
      onNotify('视频任务已提交，完成后会自动保存到本地');
    } catch (error) { onNotify(error instanceof Error ? error.message : '视频生成失败'); }
    finally { setBusy(false); }
  }

  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedTaskId) || null, [selectedTaskId, tasks]);
  const previewTask = selectedTask?.status === 'done' && selectedTask.videoUrls?.length ? selectedTask : null;

  const hero = <div className="video-studio-hero">
    <div className="video-hero-copy">
      <span className="video-eyebrow">VIDEO STUDIO · 本地工作台</span>
      <h1>把想法变成一段会动的画面</h1>
      <p>统一接入 65535、OpenAI 兼容接口和即梦 CLI。任务会保存在本地，远程完成后自动下载。</p>
      <div className="video-hero-tags" aria-label="工作台特性"><span>本地任务</span><span>多模型兼容</span><span>完成自动下载</span></div>
    </div>
    <div className="video-hero-orb" aria-hidden="true"><img src="/brand-mark.png" alt="" /></div>
  </div>;

  return <section className="video-studio-page">
    {!models.length ? <>
      {hero}
      <div className="video-empty-state">
        <div className="video-empty-icon">▣</div><h2>还没有可用的视频模型</h2>
        <p>先在模型库启用并发布视频模型，图片模型不会出现在这里。</p>
        <button className="video-primary-button" type="button" onClick={onOpenModels}>去模型库选择</button>
      </div>
    </> : <div className="video-studio-grid">
      <div className="video-compose-column">
         {hero}
         {jimengProvider && <JimengAccountSummary account={jimengAccount} checkedAt={jimengAccountCheckedAt} error={jimengAccountError} loading={jimengAccountBusy} onRefresh={() => void refreshJimengAccount()} />}
         <form className="video-compose-card" onSubmit={submit}>
        <div className="video-compose-scroll">
           <div className="video-card-heading"><div><span>创作参数</span><small>先写画面，再补充镜头输入</small></div><span className={`video-live-pill ${usesAgnes && !selectedProvider?.credentialVerifiedAt ? 'needs-verification' : ''}`}>{usesAgnes ? selectedProvider?.credentialVerifiedAt ? '● Agnes Key 已验证' : '● Agnes Key 待验证' : '● 已连接'}</span></div>
      <label className="video-field video-prompt-field"><span>提示词</span><textarea ref={promptRef} value={prompt} onChange={(event) => { setPrompt(event.target.value); setReferenceMentionOpen(referenceMentionIsOpen(event.target.value, event.currentTarget.selectionStart)); }} onFocus={(event) => setReferenceMentionOpen(referenceMentionIsOpen(event.currentTarget.value, event.currentTarget.selectionStart))} onClick={(event) => setReferenceMentionOpen(referenceMentionIsOpen(event.currentTarget.value, event.currentTarget.selectionStart))} onKeyUp={(event) => { if (event.key !== 'Escape') setReferenceMentionOpen(referenceMentionIsOpen(event.currentTarget.value, event.currentTarget.selectionStart)); }} onKeyDown={(event) => { if (event.key === 'Escape') setReferenceMentionOpen(false); }} placeholder={usesJimengCli ? '描述主体、动作、镜头运动、光线和风格… 参考图会直接提交给即梦 CLI' : '描述主体、动作、镜头运动、光线和风格… 输入 @ 可引用图片或视频'} maxLength={6000} />{supportsReferenceMentions && referenceCandidates.length > 0 && <VideoReferenceMentionMenu refs={referenceCandidates} open={referenceMentionOpen} onSelect={insertReferenceMention} />}<small>{prompt.length}/6000</small></label>
         <div className={`video-fields-two ${showOperationField ? '' : 'video-fields-single'}`}>
          <label className="video-field"><span>视频模型</span><SelectMenu value={modelId} onChange={setModelId} options={modelOptions} ariaLabel="视频模型" /></label>
          {showOperationField && <label className="video-field"><span>操作类型</span><SelectMenu value={operation} onChange={setOperation} options={operationOptions} ariaLabel="操作类型" /></label>}
         </div>
         {inputModeOptions.length > 1 && <div className="video-input-mode-field"><span>生成方式</span><SelectMenu value={inputMode} onChange={setInputMode} options={inputModeOptions.map((option) => ({ ...option, label: option.value === 'text' ? '文生视频' : option.value === 'first-frame' ? '图生视频 · 首帧' : option.value === 'frames' ? (uses65535Policy ? '图生视频 · 双参考图' : '图生视频 · 首尾帧') : '参考图生视频' }))} ariaLabel="生成方式" /></div>}
         {modelLimits.notes.length > 0 && <div className="video-model-notice"><strong>当前模型限制</strong><span>{modelLimits.notes.join(' · ')}{usesAgnes25 && inputMode === 'reference' ? ' · 提示词中的素材请使用 <Picture N>、<Audio N>、<Video N>' : ''}</span></div>}
         {usesMediaRelay && inputMode !== 'text' && <div className={`video-model-notice video-media-relay-notice ${mediaStatus?.mode === 'unavailable' ? 'warning' : ''}`}>
           <div><strong>{mediaStatus?.mode === 'relay' ? '本地图片会自动安全处理' : mediaStatus?.mode === 'self-hosted' ? '本地图片已配置安全访问' : mediaStatus?.relayConfigured ? '自动图片中转暂不可达' : '正在检查图片处理服务'}</strong>
           <span>{mediaStatus?.mode === 'relay' ? '上传图片只会短暂保存，约 30 分钟后自动失效；公网图片不会重复上传。' : mediaStatus?.mode === 'self-hosted' ? '当前使用已配置的自托管媒体地址，提交前会自动生成临时访问链接。' : mediaStatus?.relayConfigured ? '后台正在重建临时通道，恢复后无需重启；也可以点击重新检查。' : '普通用户无需配置地址；如果检查失败，请稍后点击重试，或联系管理员。'}</span></div>
          <div className="video-media-relay-actions"><button type="button" onClick={() => void refreshMediaStatus()} disabled={mediaStatusBusy}>{mediaStatusBusy ? '检查中…' : '重新检查'}</button>{mediaStatus?.mode === 'unavailable' && onOpenProviders && <button type="button" onClick={onOpenProviders}>高级设置</button>}</div>
         </div>}
        {nativeTask && <div className="video-model-notice"><strong>{uses65535Policy ? '本地素材已自动处理' : '原生任务素材处理'}</strong><span>{uses65535Policy ? '65535 仅接受 first_frame 或 reference；首尾帧会按两张参考图提交。本地视频在 64 MiB 内会自动直传，超过限制时会在提交前拦截，不会扣费。' : '本地素材会按当前原生异步接口的要求处理；超出接口安全上限时会在提交前拦截，不会扣费。'}</span></div>}
        {operation !== 'generate' && modelLimits.inheritVideoSettingsFor?.includes(operation) && <div className="video-model-notice warning"><strong>参数沿用原视频</strong><span>当前操作不会使用自定义时长、比例和分辨率，输出将继承输入视频设置。</span></div>}
        {operation !== 'generate' && !modelLimits.inheritVideoSettingsFor?.includes(operation) && modelLimits.omitAspectRatioResolutionFor?.includes(operation) && <div className="video-model-notice warning"><strong>比例与分辨率沿用原视频</strong><span>当前续写操作不提交自定义比例和分辨率，仅使用续写时长。</span></div>}
          {!usesAgnesV20 && <div className="video-option-segment"><span>{usesJimengMultiframe ? '转场参数' : '基础参数'}</span><div><label>{usesJimengMultiframe ? '转场时长' : '时长'}<SelectMenu value={seconds} onChange={setSeconds} options={durationOptions} ariaLabel={usesJimengMultiframe ? '转场时长' : '视频时长'} /></label><label>比例<SelectMenu value={ratio} onChange={setRatio} options={ratioOptions} ariaLabel="视频比例" /></label><label>分辨率<SelectMenu value={resolution} onChange={setResolution} options={resolutionOptions} ariaLabel="视频分辨率" /></label></div></div>}
         {usesAgnesV20 && <div className="video-option-segment video-v20-parameter-panel">
          <div className="video-v20-heading"><span>V2.0 专属参数</span><small>旧版接口用帧数控制时长，不能直接填写秒数。</small></div>
          <div className="video-v20-preset-group">
           <span>快速选时长</span>
           <div className="video-v20-preset-list" role="group" aria-label="Agnes V2.0 时长预设">
            {AGNES_V20_DURATION_PRESETS.map((preset) => <button key={preset.frames} type="button" className={selectedAgnesV20Duration?.frames === preset.frames ? 'selected' : ''} onClick={() => applyAgnesV20Duration(preset)}><b>{preset.label}</b><small>{preset.frames} 帧 / {preset.frameRate} FPS</small></button>)}
           </div>
          </div>
          <div className="video-v20-preset-group">
           <span>快速选画幅</span>
           <div className="video-v20-preset-list" role="group" aria-label="Agnes V2.0 画幅预设">
            {AGNES_V20_DIMENSION_PRESETS.map((preset) => <button key={preset.label} type="button" className={selectedAgnesV20Dimensions?.width === preset.width && selectedAgnesV20Dimensions?.height === preset.height ? 'selected' : ''} onClick={() => applyAgnesV20Dimensions(preset)}><b>{preset.label}</b><small>{preset.width} × {preset.height}</small></button>)}
           </div>
          </div>
          <div className="video-v20-advanced-label"><span>高级自定义</span><small>宽高须为 64 的倍数；帧数须满足 8n + 1。</small></div>
          <div className="video-v20-advanced-fields">
           <label>宽度（px）<input aria-label="宽度" type="number" min={64} max={3840} step={64} value={agnesWidth} onChange={(event) => setAgnesWidth(Math.max(64, Math.min(3840, Math.round((Number(event.target.value) || 64) / 64) * 64)))} /></label>
           <label>高度（px）<input aria-label="高度" type="number" min={64} max={3840} step={64} value={agnesHeight} onChange={(event) => setAgnesHeight(Math.max(64, Math.min(3840, Math.round((Number(event.target.value) || 64) / 64) * 64)))} /></label>
           <label>帧数（8n+1）<input aria-label="帧数" type="number" min={1} max={441} step={8} value={agnesNumFrames} onChange={(event) => setAgnesNumFrames(Math.max(1, Math.min(441, Math.round((Number(event.target.value) || 1) / 8) * 8 + 1)))} /></label>
           <label>帧率（FPS）<input aria-label="帧率" type="number" min={1} max={60} step={1} value={agnesFrameRate} onChange={(event) => setAgnesFrameRate(Math.max(1, Math.min(60, Number(event.target.value) || 1)))} /></label>
          </div>
          <small className="video-model-parameter-help">预计时长约 {((Math.max(1, agnesNumFrames)) / Math.max(1, agnesFrameRate)).toFixed(1)} 秒（按官方 num_frames ÷ frame_rate 估算）</small>
         </div>}
        <div className="video-input-heading"><span>画面与素材</span><small>模型不支持的输入会自动收起</small></div>
          <div className="video-upload-grid">
          {(inputMode === 'first-frame' || inputMode === 'frames') && <UploadSlot label="首帧" value={firstFrame} onClick={() => inputRefs.current.first?.click()} onRemove={() => setFirstFrame(null)} onPreview={setPreviewImage} inputRef={(node) => { inputRefs.current.first = node; }} accept="image/*" onChange={() => void selectFile('first', setFirstFrame, 'image')} />}
          {inputMode === 'frames' && <UploadSlot label="尾帧" value={lastFrame} onClick={() => inputRefs.current.last?.click()} onRemove={() => setLastFrame(null)} onPreview={setPreviewImage} inputRef={(node) => { inputRefs.current.last = node; }} accept="image/*" onChange={() => void selectFile('last', setLastFrame, 'image')} />}
          {inputMode === 'reference' && <ReferenceImageTray items={referenceImages} maxItems={modelLimits.maxReferenceImages} onAdd={addReferences} onRemove={(index) => setReferenceImages((old) => old.filter((_, itemIndex) => itemIndex !== index))} onClear={clearReferences} onMove={moveReference} onReorder={reorderReferences} onPreview={setPreviewImage} inputRef={(node) => { inputRefs.current.refs = node; }} />}
           {((operation === 'edit' || operation === 'extend') || (usesAgnes25 && !usesAgnesFlash && inputMode === 'reference')) && <UploadSlot label="参考视频" value={referenceVideo} onClick={() => inputRefs.current.video?.click()} onRemove={() => setReferenceVideo(null)} inputRef={(node) => { inputRefs.current.video = node; }} accept="video/*" onChange={() => void selectFile('video', setReferenceVideo, 'video')} />}
          {supportsAudio && <AudioUploadTray items={audios} maxItems={modelLimits.maxAudios} onAdd={addAudios} onRemove={(index) => setAudios((old) => old.filter((_, itemIndex) => itemIndex !== index))} inputRef={(node) => { inputRefs.current.audio = node; }} />}
          </div>
        </div>
        <button className="video-primary-button video-submit" type="submit" disabled={busy}><span>{busy ? '提交中…' : '开始生成视频'}</span><b>↗</b></button>
        </form>
      </div>
      <aside className="video-preview-column">
        <div className="video-preview-card">
          <div className="video-card-heading"><div><span>预览与任务</span><small>{selectedTask ? `${selectedTask.modelName || '自动模型'} · ${statusLabel(selectedTask.status)}` : tasks.length ? `${tasks.length} 个本地任务` : '生成后会显示在这里'}</small></div><button className="video-quiet-button" type="button" onClick={() => void refreshTasks()}>刷新</button></div>
          {previewTask ? <video className="video-preview-player" src={previewTask.videoUrls?.[0]} controls playsInline /> : <div className={`video-preview-empty ${selectedTask ? `video-preview-${selectedTask.status}` : ''}`}><div className="video-play-orb">{selectedTask?.status === 'failed' ? '!' : selectedTask?.status === 'pending' || selectedTask?.status === 'running' ? '…' : '▶'}</div><span>{selectedTask?.status === 'failed' ? '视频任务失败' : selectedTask?.status === 'pending' || selectedTask?.status === 'running' ? '正在等待服务商完成…' : selectedTask ? '任务已完成，但没有可预览的视频' : '完成的视频会自动出现在这里'}</span><small>{selectedTask?.error || (selectedTask ? '可点击“恢复参数”继续创作' : '支持下载、复制地址与再次生成')}</small></div>}
        </div>
        <div className="video-task-list">
          <div className="video-task-list-heading"><span>最近任务</span><small>点击任务切换预览 · 列表可滚动</small></div>
          <div className="video-task-list-scroll">
            {tasks.length ? tasks.slice(0, 8).map((task) => {
              const selected = task.id === selectedTaskId;
              return <article className={`video-task-card ${task.status} ${selected ? 'selected' : ''}`} key={task.id} role="button" tabIndex={0} aria-pressed={selected} onClick={() => setSelectedTaskId(task.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedTaskId(task.id); } }}>
                {task.status !== 'done' && <span className="video-task-scan" aria-hidden="true" />}
                <div className="video-task-meta"><span className="video-status-pill">{statusLabel(task.status)}</span><time>{formatTime(task.createdAt)}</time></div>
                <div className="video-task-copy"><strong>{task.input?.prompt || '未命名视频任务'}</strong><div className="video-task-details"><small>{task.modelName || '自动模型'} · {operationLabel(task.operation)}</small><small className="video-task-param-summary">{taskParameterSummary(task)}</small></div></div>
                {task.status === 'done' && task.videoUrls?.length ? <>{task.error && <p className="video-task-error">远程完成，但本地保存失败：{task.error}</p>}<div className="video-task-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><button type="button" className="video-task-restore" title="恢复这条任务的生成参数" aria-label="恢复这条任务的生成参数" onClick={() => restoreTask(task)}><span className="video-action-icon" aria-hidden="true">↺</span><span>恢复参数</span></button><a href={task.videoUrls[0]} download target="_blank" rel="noreferrer" title="下载生成的视频" aria-label="下载生成的视频"><span className="video-action-icon" aria-hidden="true">↓</span><span>下载</span></a><button type="button" title="复制视频地址" aria-label="复制视频地址" onClick={() => void navigator.clipboard?.writeText(task.remoteVideoUrls?.[0] || task.videoUrls?.[0] || '').then(() => onNotify('视频地址已复制'))}><span className="video-action-icon" aria-hidden="true">⧉</span><span>复制</span></button>{task.error && <button type="button" title="再次保存本地视频" aria-label="再次保存本地视频" onClick={async () => { const response = await fetch(`/api/video/tasks/${task.id}`, { method: 'POST' }); const data = await response.json().catch(() => ({})); if (!response.ok) onNotify(data.error || '再次保存失败'); else { onNotify('已再次保存视频'); void refreshTasks(); } }}><span className="video-action-icon" aria-hidden="true">↻</span><span>再次保存</span></button>}</div></> : task.status === 'failed' ? <><p className="video-task-error">{task.error || '视频任务失败'}</p><div className="video-task-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><button type="button" className="video-task-restore" title="恢复这条失败任务的生成参数" aria-label="恢复这条失败任务的生成参数" onClick={() => restoreTask(task)}><span className="video-action-icon" aria-hidden="true">↺</span><span>恢复参数</span></button></div></> : <><small className="video-task-waiting">正在等待服务商完成…</small><div className="video-task-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><button type="button" className="video-task-restore" title="恢复这条任务的生成参数" aria-label="恢复这条任务的生成参数" onClick={() => restoreTask(task)}><span className="video-action-icon" aria-hidden="true">↺</span><span>恢复参数</span></button></div></>}
              </article>;
            }) : <div className="video-task-list-empty">暂无任务，提交第一段视频吧。</div>}
          </div>
        </div>
      </aside>
    </div>}
    {previewImage && <div className="video-media-dialog" role="dialog" aria-modal="true" aria-label="查看参考图" onClick={() => setPreviewImage(null)}><div className="video-media-dialog-inner" onClick={(event) => event.stopPropagation()}><button type="button" className="video-media-dialog-close" aria-label="关闭预览" onClick={() => setPreviewImage(null)}>×</button><img src={previewImage.url} alt={previewImage.name} /><span>{previewImage.name}</span></div></div>}
  </section>;
}

function ReferenceImageTray({ items, maxItems, onAdd, onRemove, onClear, onMove, onReorder, onPreview, inputRef }: { items: UploadSlot[]; maxItems: number; onAdd: (files: FileList | null) => void; onRemove: (index: number) => void; onClear: () => void; onMove: (index: number, direction: -1 | 1) => void; onReorder: (from: number, to: number) => void; onPreview: (item: UploadSlot) => void; inputRef: (node: HTMLInputElement | null) => void }) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  return <div className="video-reference-tray">
    <div className="video-reference-tray-head"><div className="video-reference-tray-title"><strong>参考图</strong><small>{items.length}/{maxItems} · 点击查看，拖动或用箭头排序</small></div><div className="video-reference-tray-actions" aria-label="参考图操作"><label className={`video-reference-add ${items.length >= maxItems ? 'disabled' : ''}`}><input ref={inputRef} type="file" accept="image/*" multiple disabled={items.length >= maxItems} onChange={(event) => { onAdd(event.target.files); event.currentTarget.value = ''; }} /><span>{items.length >= maxItems ? '已达到上限' : items.length ? '＋ 继续添加' : '＋ 添加图片'}</span></label>{items.length > 0 && <button type="button" className="video-reference-clear" onClick={onClear}>清除全部</button>}</div></div>
    {items.length ? <div className="video-reference-grid">{items.map((item, index) => <div className={`video-reference-item ${dragIndex === index ? 'dragging' : ''}`} key={`${item.name}-${index}`} draggable onDragStart={() => setDragIndex(index)} onDragEnd={() => setDragIndex(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragIndex !== null) onReorder(dragIndex, index); setDragIndex(null); }}><button type="button" className="video-reference-preview" onClick={() => onPreview(item)} aria-label={`查看第 ${index + 1} 张参考图`}><img src={item.url} alt="" /><b>{index + 1}</b><span>{item.name}</span></button><div className="video-reference-actions"><button type="button" onClick={() => onMove(index, -1)} disabled={index === 0} aria-label="向前移动">←</button><button type="button" onClick={() => onMove(index, 1)} disabled={index === items.length - 1} aria-label="向后移动">→</button><button type="button" onClick={() => onRemove(index)} aria-label={`删除第 ${index + 1} 张参考图`}>×</button></div></div>)}</div> : <label className="video-reference-empty"><input type="file" accept="image/*" multiple onChange={(event) => { onAdd(event.target.files); event.currentTarget.value = ''; }} /><span>＋</span><strong>添加参考图</strong><small>支持多选，最多 {maxItems} 张</small></label>}
  </div>;
}

function AudioUploadTray({ items, maxItems, onAdd, onRemove, inputRef }: { items: UploadSlot[]; maxItems: number; onAdd: (files: FileList | null) => void; onRemove: (index: number) => void; inputRef: (node: HTMLInputElement | null) => void }) {
  return <div className="video-audio-tray">
    <label className={`video-audio-add ${items.length >= maxItems ? 'disabled' : ''}`}>
      <input ref={inputRef} type="file" accept="audio/*" multiple disabled={items.length >= maxItems} onChange={(event) => { onAdd(event.target.files); event.currentTarget.value = ''; }} />
      <span className="video-upload-plus">♫</span><strong>{items.length >= maxItems ? '音频已达到上限' : '添加音频'}</strong><small>{items.length}/{maxItems} 段 · 支持多选</small>
    </label>
    {items.length > 0 && <div className="video-audio-list">{items.map((item, index) => <div className="video-audio-item" key={`${item.name}-${index}`}><span className="video-file-icon">♫</span><span title={item.name}>{item.name}</span><button type="button" onClick={() => onRemove(index)} aria-label={`删除第 ${index + 1} 段音频`}>×</button></div>)}</div>}
  </div>;
}

function VideoReferenceMentionMenu({ refs, open, onSelect }: { refs: CreativeReference[]; open: boolean; onSelect: (index: number) => void }) {
  if (!open || !refs.length) return null;
  return <div className="reference-mention-menu video-reference-mention-menu" role="listbox">
    <div className="reference-mention-title">选择引用 · 输入 @编号</div>
    {refs.map((ref, index) => <button type="button" key={`${ref.name}-${index}`} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(index)}>
      <span className="reference-mention-thumb">{ref.kind === 'video' ? <span className="reference-type-icon video">▶<small>视频</small></span> : <img src={ref.url} alt="" />}<b>@{index + 1}</b></span>
      <span><strong>{ref.kind === 'video' ? '参考视频' : '参考图'} {index + 1}</strong><small>{ref.name}</small></span>
    </button>)}
  </div>;
}

function UploadSlot({ label, value, count, onClick, onRemove, onPreview, inputRef, accept, multiple, onChange, onFiles }: { label: string; value: UploadSlot | null; count?: number; onClick: () => void; onRemove: () => void; onPreview?: (value: UploadSlot) => void; inputRef: (node: HTMLInputElement | null) => void; accept: string; multiple?: boolean; onChange?: () => void; onFiles?: (files: FileList | null) => void }) {
  return <div className={`video-upload-slot ${value ? 'has-file' : ''}`}><input ref={inputRef} type="file" accept={accept} multiple={multiple} onChange={(event) => onFiles ? void onFiles(event.target.files) : onChange?.()} /><button type="button" className="video-upload-button" onClick={(event) => {
    if (value?.kind === 'image' && onPreview && event.target instanceof HTMLImageElement) {
      onPreview(value);
      return;
    }
    onClick();
  }}>{value ? <>{value.kind === 'image' ? <img src={value.url} alt={value.name} title="点击查看完整图片" /> : <span className="video-file-icon">{value.kind === 'video' ? '▶' : '♫'}</span>}<span className="video-upload-name">{count && count > 1 ? `${count} 张参考图` : value.name}</span><i onClick={(event) => { event.stopPropagation(); onRemove(); }}>×</i></> : <><span className="video-upload-plus">＋</span><span>{label}</span><small>点击或拖入</small></>}</button></div>;
}
