'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderConnection, RegistryModel, VideoGenerationInput } from '@/lib/types';
import SelectMenu from '@/components/SelectMenu';
import { allRatios, getVideoModelLimits } from '@/lib/video-model-limits';
import { is65535Provider, isJimengProvider } from '@/lib/video-platform';

type VideoTask = {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
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
  onOpenModels: () => void;
  onNotify: (message: string) => void;
};

type UploadSlot = { name: string; url: string; kind: 'image' | 'video' | 'audio' };
type VideoOperation = 'generate' | 'edit' | 'extend';
const MAX_65535_INLINE_BYTES = 64 * 1024 * 1024;
const MAX_VIDEO_IMAGE_EDGE = 2048;
const MAX_VIDEO_IMAGE_BYTES = 4 * 1024 * 1024;

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

export default function VideoStudio({ models, providers, defaultModelId, promptPrefill, onPromptPrefillConsumed, onOpenModels, onNotify }: Props) {
  const [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState(defaultModelId || 'auto');
  const [operation, setOperation] = useState<VideoOperation>('generate');
  const [inputMode, setInputMode] = useState<'text' | 'first-frame' | 'frames' | 'reference'>('text');
  const [seconds, setSeconds] = useState(5);
  const [ratio, setRatio] = useState('16:9');
  const [resolution, setResolution] = useState('720p');
  const [firstFrame, setFirstFrame] = useState<UploadSlot | null>(null);
  const [lastFrame, setLastFrame] = useState<UploadSlot | null>(null);
  const [referenceImages, setReferenceImages] = useState<UploadSlot[]>([]);
  const [referenceVideo, setReferenceVideo] = useState<UploadSlot | null>(null);
  const [audios, setAudios] = useState<UploadSlot[]>([]);
  const [previewImage, setPreviewImage] = useState<UploadSlot | null>(null);
  const [referenceMentionOpen, setReferenceMentionOpen] = useState(false);
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [busy, setBusy] = useState(false);
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
  const nativeTask = selectedProvider?.videoTransport === 'native-task' || selectedProvider?.platform === '65535';
  const uses65535Policy = is65535Provider(selectedProvider);
  const usesJimengCli = isJimengProvider(selectedProvider);
  const supportsReferenceMentions = !usesJimengCli;
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
  // 65535's documented native task schema currently has no audio input field.
  // Only expose audio there when the model metadata explicitly advertises it;
  // other compatible providers keep the existing flexible control.
  const supportsAudio = can('video-audio') || !uses65535Policy;
  const modelOptions = [{ value: 'auto', label: '自动选择', description: '使用当前默认视频模型' }, ...models.map((model) => ({ value: model.id, label: model.displayName, description: model.providerName }))];
  const operationOptions = [{ value: 'generate' as const, label: '生成视频', description: '根据提示词和画面输入生成视频' }, ...(supportsEdit ? [{ value: 'edit' as const, label: '视频编辑', description: '参考已有视频进行修改' }] : []), ...(supportsExtend ? [{ value: 'extend' as const, label: '视频扩展', description: '延续已有视频的镜头' }] : [])];
  const inputModeOptions = useMemo(() => [{ value: 'text' as const, label: '纯文本 · 不使用图片', description: '从提示词直接生成' }, ...(supportsFirst ? [{ value: 'first-frame' as const, label: '首帧 · 控制开场画面', description: '上传一张开场参考图' }, { value: 'frames' as const, label: '首尾帧 · 约束镜头起止', description: '上传首帧和尾帧' }] : []), ...(supportsReference ? [{ value: 'reference' as const, label: '参考图 · 保持主体风格', description: `最多添加 ${modelLimits.maxReferenceImages} 张参考图` }] : [])], [modelLimits.maxReferenceImages, supportsFirst, supportsReference]);
  const durationOptions = useMemo(() => {
    const values = modelLimits.fixedSeconds ? [modelLimits.fixedSeconds] : modelLimits.allowedSeconds || [1, 3, 5, 8, 10, 15, 30, 60];
    return values.filter((value) => value >= modelLimits.minSeconds && value <= modelLimits.maxSeconds).map((value) => ({ value, label: `${value} 秒` }));
  }, [modelLimits]);
  const ratioOptions = allRatios.map((value) => ({ value, label: value === 'auto' ? 'Auto' : value, description: value === 'auto' ? '模型自选 / 跟随首帧' : value.includes(':') ? (value.split(':')[0] === value.split(':')[1] ? '方形' : Number(value.split(':')[0]) > Number(value.split(':')[1]) ? '横屏' : '竖屏') : '模型自选' }));
  const resolutionOptions = modelLimits.resolutions.map((value) => ({ value, label: value, description: value === '480p' ? '快速生成' : value === '1080p' ? '高清' : '推荐' }));

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
    setAudios((old) => old.length > modelLimits.maxAudios ? old.slice(0, modelLimits.maxAudios) : old);
  }, [durationOptions, modelLimits, resolution, seconds]);

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

  function referenceMentionIsOpen(value: string, cursor: number) {
    return supportsReferenceMentions && inputMode === 'reference' && referenceImages.length > 0 && /@\d*$/.test(value.slice(0, cursor));
  }

  function insertReferenceMention(index: number) {
    const cursor = promptRef.current?.selectionStart ?? prompt.length;
    const before = prompt.slice(0, cursor);
    const match = before.match(/@\d*$/);
    const start = match ? cursor - match[0].length : cursor;
    const mention = `@${index + 1} `;
    const next = `${prompt.slice(0, start)}${mention}${prompt.slice(cursor)}`;
    setPrompt(next);
    setReferenceMentionOpen(false);
    requestAnimationFrame(() => {
      promptRef.current?.focus();
      const nextCursor = start + mention.length;
      promptRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function clearReferences() {
    setReferenceImages([]);
    setReferenceMentionOpen(false);
    setPrompt((value) => value.replace(/@(?:[1-9]|1[0-6])\s*/g, '').replace(/[ \t]{2,}/g, ' '));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim()) return onNotify('请先输入视频提示词');
    if (!models.length) return onNotify('请先在模型库启用一个视频模型');
    if (inputMode === 'first-frame' && !firstFrame) return onNotify('请先添加首帧图片');
    if (inputMode === 'frames' && (!firstFrame || !lastFrame)) return onNotify('首尾帧模式请先添加首帧和尾帧图片');
    if (inputMode === 'reference' && !referenceImages.length) return onNotify('参考图模式请先添加至少一张图片');
    if (referenceImages.length > modelLimits.maxReferenceImages) return onNotify(`当前模型最多接收 ${modelLimits.maxReferenceImages} 张参考图`);
    if (audios.length > modelLimits.maxAudios) return onNotify(`当前模型最多接收 ${modelLimits.maxAudios} 段音频`);
    if (uses65535Policy && audios.length && !can('video-audio')) return onNotify('当前 65535 视频模型未声明音频输入，已自动阻止提交；移除音频即可继续生成。');
    const mentionedReferenceNumbers = Array.from(prompt.matchAll(/(?:^|\s)@(\d+)\b/g), (match) => Number(match[1]));
    if (mentionedReferenceNumbers.length && inputMode !== 'reference') return onNotify('提示词中有 @引用，请先切换到参考图输入方式');
    if (mentionedReferenceNumbers.some((number) => number < 1 || number > referenceImages.length)) return onNotify('提示词中的 @编号没有对应参考图，请重新选择或清除引用');
    setBusy(true);
    try {
      const inheritsVideoSettings = operation !== 'generate' && (modelLimits.inheritVideoSettingsFor?.includes(operation) || false);
      const omitsAspectRatioResolution = inheritsVideoSettings || (operation !== 'generate' && (modelLimits.omitAspectRatioResolutionFor?.includes(operation) || false));
      const input: VideoGenerationInput = {
        prompt,
        operation,
        ...(inheritsVideoSettings ? {} : { seconds }),
        ...(omitsAspectRatioResolution ? {} : { aspectRatio: ratio, resolution }),
        firstFrame: inputMode === 'first-frame' || inputMode === 'frames' ? firstFrame?.url : undefined,
        lastFrame: inputMode === 'frames' ? lastFrame?.url : undefined,
        referenceImages: inputMode === 'reference' ? referenceImages.map((item) => item.url) : [],
        referenceVideo: referenceVideo?.url,
        audios: audios.map((item) => item.url),
        audio: audios[0]?.url,
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
      const compressionResults = [compressedFirstFrame, compressedLastFrame, ...compressedReferences].filter((result): result is NonNullable<typeof result> => Boolean(result));
      const compressedCount = compressionResults.filter((result) => result.changed).length;
      if (compressedCount) onNotify(`已自动压缩 ${compressedCount} 张视频参考图，保留原图比例后提交`);
      if (nativeTask) {
        const localMedia = [compressedInput.firstFrame, compressedInput.lastFrame, ...(compressedInput.referenceImages || []), compressedInput.referenceVideo, ...(compressedInput.audios || [])].filter((value): value is string => Boolean(value));
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
      if (data.task) setTasks((old) => [data.task, ...old.filter((task) => task.id !== data.task.id)]);
      onNotify('视频任务已提交，完成后会自动保存到本地');
    } catch (error) { onNotify(error instanceof Error ? error.message : '视频生成失败'); }
    finally { setBusy(false); }
  }

  const previewTask = useMemo(() => tasks.find((task) => task.status === 'done' && task.videoUrls?.length), [tasks]);

  return <section className="video-studio-page">
    <div className="video-studio-hero">
      <div>
        <span className="video-eyebrow">VIDEO STUDIO · 本地工作台</span>
        <h1>把想法变成一段会动的画面</h1>
        <p>统一接入 65535、OpenAI 兼容接口和即梦 CLI。任务会保存在本地，远程完成后自动下载。</p>
      </div>
      <div className="video-hero-orb" aria-hidden="true">✦</div>
    </div>
    {!models.length ? <div className="video-empty-state">
      <div className="video-empty-icon">▣</div><h2>还没有可用的视频模型</h2>
      <p>先在模型库启用并发布视频模型，图片模型不会出现在这里。</p>
      <button className="video-primary-button" type="button" onClick={onOpenModels}>去模型库选择</button>
    </div> : <div className="video-studio-grid">
      <form className="video-compose-card" onSubmit={submit}>
        <div className="video-compose-scroll">
          <div className="video-card-heading"><div><span>创作参数</span><small>先写画面，再补充镜头输入</small></div><span className="video-live-pill">● 已连接</span></div>
          <label className="video-field video-prompt-field"><span>提示词</span><textarea ref={promptRef} value={prompt} onChange={(event) => { setPrompt(event.target.value); setReferenceMentionOpen(referenceMentionIsOpen(event.target.value, event.currentTarget.selectionStart)); }} onFocus={(event) => setReferenceMentionOpen(referenceMentionIsOpen(event.currentTarget.value, event.currentTarget.selectionStart))} onKeyDown={(event) => { if (event.key === 'Escape') setReferenceMentionOpen(false); }} placeholder={usesJimengCli ? '描述主体、动作、镜头运动、光线和风格… 参考图会直接提交给即梦 CLI' : '描述主体、动作、镜头运动、光线和风格… 输入 @ 可引用参考图'} maxLength={6000} />{supportsReferenceMentions && referenceImages.length > 0 && <VideoReferenceMentionMenu refs={referenceImages} open={referenceMentionOpen} onSelect={insertReferenceMention} />}<small>{prompt.length}/6000</small></label>
        <div className={`video-fields-two ${operationOptions.length === 1 ? 'video-fields-single' : ''}`}>
          <label className="video-field"><span>视频模型</span><SelectMenu value={modelId} onChange={setModelId} options={modelOptions} ariaLabel="视频模型" /></label>
          <label className="video-field"><span>操作类型</span><SelectMenu value={operation} onChange={setOperation} options={operationOptions} ariaLabel="操作类型" /></label>
        </div>
        {inputModeOptions.length > 1 && <div className="video-input-mode-field"><span>生成方式</span><SelectMenu value={inputMode} onChange={setInputMode} options={inputModeOptions.map((option) => ({ ...option, label: option.value === 'text' ? '文生视频' : option.value === 'first-frame' ? '图生视频 · 首帧' : option.value === 'frames' ? '图生视频 · 首尾帧' : '参考图生视频' }))} ariaLabel="生成方式" /></div>}
        {modelLimits.notes.length > 0 && <div className="video-model-notice"><strong>当前模型限制</strong><span>{modelLimits.notes.join(' · ')}</span></div>}
        {nativeTask && <div className="video-model-notice"><strong>{uses65535Policy ? '本地素材已自动处理' : '原生任务素材处理'}</strong><span>{uses65535Policy ? '65535 支持图片 data URI；本地视频在 64 MiB 内会自动直传，超过限制时会在提交前拦截，不会扣费。' : '本地素材会按当前原生异步接口的要求处理；超出接口安全上限时会在提交前拦截，不会扣费。'}</span></div>}
        {operation !== 'generate' && modelLimits.inheritVideoSettingsFor?.includes(operation) && <div className="video-model-notice warning"><strong>参数沿用原视频</strong><span>当前操作不会使用自定义时长、比例和分辨率，输出将继承输入视频设置。</span></div>}
        {operation !== 'generate' && !modelLimits.inheritVideoSettingsFor?.includes(operation) && modelLimits.omitAspectRatioResolutionFor?.includes(operation) && <div className="video-model-notice warning"><strong>比例与分辨率沿用原视频</strong><span>当前续写操作不提交自定义比例和分辨率，仅使用续写时长。</span></div>}
        <div className="video-option-segment"><span>基础参数</span><div><label>{usesJimengMultiframe ? '转场时长' : '时长'}<SelectMenu value={seconds} onChange={setSeconds} options={durationOptions} ariaLabel={usesJimengMultiframe ? '转场时长' : '视频时长'} /></label><label>比例<SelectMenu value={ratio} onChange={setRatio} options={ratioOptions} ariaLabel="视频比例" /></label><label>分辨率<SelectMenu value={resolution} onChange={setResolution} options={resolutionOptions} ariaLabel="视频分辨率" /></label></div></div>
        <div className="video-input-heading"><span>画面与素材</span><small>模型不支持的输入会自动收起</small></div>
          <div className="video-upload-grid">
          {(inputMode === 'first-frame' || inputMode === 'frames') && <UploadSlot label="首帧" value={firstFrame} onClick={() => inputRefs.current.first?.click()} onRemove={() => setFirstFrame(null)} onPreview={setPreviewImage} inputRef={(node) => { inputRefs.current.first = node; }} accept="image/*" onChange={() => void selectFile('first', setFirstFrame, 'image')} />}
          {inputMode === 'frames' && <UploadSlot label="尾帧" value={lastFrame} onClick={() => inputRefs.current.last?.click()} onRemove={() => setLastFrame(null)} onPreview={setPreviewImage} inputRef={(node) => { inputRefs.current.last = node; }} accept="image/*" onChange={() => void selectFile('last', setLastFrame, 'image')} />}
          {inputMode === 'reference' && <ReferenceImageTray items={referenceImages} maxItems={modelLimits.maxReferenceImages} onAdd={addReferences} onRemove={(index) => setReferenceImages((old) => old.filter((_, itemIndex) => itemIndex !== index))} onClear={clearReferences} onMove={moveReference} onReorder={reorderReferences} onPreview={setPreviewImage} inputRef={(node) => { inputRefs.current.refs = node; }} />}
          {(operation === 'edit' || operation === 'extend') && <UploadSlot label="参考视频" value={referenceVideo} onClick={() => inputRefs.current.video?.click()} onRemove={() => setReferenceVideo(null)} inputRef={(node) => { inputRefs.current.video = node; }} accept="video/*" onChange={() => void selectFile('video', setReferenceVideo, 'video')} />}
          {supportsAudio && <AudioUploadTray items={audios} maxItems={modelLimits.maxAudios} onAdd={addAudios} onRemove={(index) => setAudios((old) => old.filter((_, itemIndex) => itemIndex !== index))} inputRef={(node) => { inputRefs.current.audio = node; }} />}
          </div>
        </div>
        <button className="video-primary-button video-submit" type="submit" disabled={busy}><span>{busy ? '提交中…' : '开始生成视频'}</span><b>↗</b></button>
      </form>
      <aside className="video-preview-column">
        <div className="video-preview-card"><div className="video-card-heading"><div><span>预览与任务</span><small>{tasks.length ? `${tasks.length} 个本地任务` : '生成后会显示在这里'}</small></div><button className="video-quiet-button" type="button" onClick={() => void refreshTasks()}>刷新</button></div>{previewTask ? <video className="video-preview-player" src={previewTask.videoUrls?.[0]} controls playsInline /> : <div className="video-preview-empty"><div className="video-play-orb">▶</div><span>完成的视频会自动出现在这里</span><small>支持下载、复制地址与再次生成</small></div>}</div>
        <div className="video-task-list"><div className="video-task-list-heading"><span>最近任务</span><small>状态会自动更新</small></div>{tasks.length ? tasks.slice(0, 8).map((task) => <article className={`video-task-card ${task.status}`} key={task.id}>{task.status !== 'done' && <span className="video-task-scan" aria-hidden="true" />}<div className="video-task-meta"><span className="video-status-pill">{statusLabel(task.status)}</span><time>{formatTime(task.createdAt)}</time></div><strong>{task.input?.prompt || '未命名视频任务'}</strong><small>{task.modelName || '自动模型'} · {task.operation === 'extend' ? '扩展' : task.operation === 'edit' ? '编辑' : '生成'}</small>{task.status === 'done' && task.videoUrls?.length ? <>{task.error && <p className="video-task-error">远程完成，但本地保存失败：{task.error}</p>}<div className="video-task-actions"><a href={task.videoUrls[0]} download target="_blank" rel="noreferrer">下载视频</a><button type="button" onClick={() => void navigator.clipboard?.writeText(task.remoteVideoUrls?.[0] || task.videoUrls?.[0] || '').then(() => onNotify('视频地址已复制'))}>复制地址</button>{task.error && <button type="button" onClick={async () => { const response = await fetch(`/api/video/tasks/${task.id}`, { method: 'POST' }); const data = await response.json().catch(() => ({})); if (!response.ok) onNotify(data.error || '再次保存失败'); else { onNotify('已再次保存视频'); void refreshTasks(); } }}>再次保存</button>}</div></> : task.status === 'failed' ? <p className="video-task-error">{task.error || '视频任务失败'}</p> : <small className="video-task-waiting">正在等待服务商完成…</small>}</article>) : <div className="video-task-list-empty">暂无任务，提交第一段视频吧。</div>}</div>
      </aside>
    </div>}
    {previewImage && <div className="video-media-dialog" role="dialog" aria-modal="true" aria-label="查看参考图" onClick={() => setPreviewImage(null)}><div className="video-media-dialog-inner" onClick={(event) => event.stopPropagation()}><button type="button" className="video-media-dialog-close" aria-label="关闭预览" onClick={() => setPreviewImage(null)}>×</button><img src={previewImage.url} alt={previewImage.name} /><span>{previewImage.name}</span></div></div>}
  </section>;
}

function ReferenceImageTray({ items, maxItems, onAdd, onRemove, onClear, onMove, onReorder, onPreview, inputRef }: { items: UploadSlot[]; maxItems: number; onAdd: (files: FileList | null) => void; onRemove: (index: number) => void; onClear: () => void; onMove: (index: number, direction: -1 | 1) => void; onReorder: (from: number, to: number) => void; onPreview: (item: UploadSlot) => void; inputRef: (node: HTMLInputElement | null) => void }) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  return <div className="video-reference-tray">
    <div className="video-reference-tray-head"><div><strong>参考图</strong><small>{items.length}/{maxItems} · 点击查看，拖动或用箭头排序</small></div><div className="video-reference-tray-actions"><label className={`video-reference-add ${items.length >= maxItems ? 'disabled' : ''}`}><input ref={inputRef} type="file" accept="image/*" multiple disabled={items.length >= maxItems} onChange={(event) => { onAdd(event.target.files); event.currentTarget.value = ''; }} /><span>{items.length >= maxItems ? '已达到上限' : items.length ? '＋ 继续添加' : '＋ 添加图片'}</span></label>{items.length > 0 && <button type="button" className="video-reference-clear" onClick={onClear}>清除全部</button>}</div></div>
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

function VideoReferenceMentionMenu({ refs, open, onSelect }: { refs: UploadSlot[]; open: boolean; onSelect: (index: number) => void }) {
  if (!open || !refs.length) return null;
  return <div className="reference-mention-menu video-reference-mention-menu" role="listbox">
    <div className="reference-mention-title">选择参考图 · 输入 @编号</div>
    {refs.map((ref, index) => <button type="button" key={`${ref.name}-${index}`} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(index)}>
      <span className="reference-mention-thumb"><img src={ref.url} alt="" /><b>@{index + 1}</b></span>
      <span><strong>参考图 {index + 1}</strong><small>{ref.name}</small></span>
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
