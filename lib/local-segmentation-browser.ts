import {
  LOCAL_SEGMENTATION_MODEL,
  registerLocalSegmentationProvider,
  type LocalSegmentationProvider,
  type LocalSegmentationResult,
  type LocalSegmentationStatus,
} from './local-segmentation';
import type { LocalEditPoint } from './local-edit';

/**
 * Browser-only, free local subject selection.
 *
 * The Transformers.js runtime is intentionally a dynamic import: opening the
 * canvas does not download or bundle the inference library until the user
 * chooses to install/use this optional feature.
 */
const MODEL_ID = 'Xenova/slimsam-77-uniform';
const MODEL_REVISION = '5850ab45f587c112167512ffef949107115e26a0';
const MODEL_DTYPE = 'q8';
const MODEL_DEVICE = 'wasm';
const MODEL_CACHE_NAME = 'sanmao-local-segmentation-v1';
const ESTIMATED_MODEL_BYTES = 13_787_000;
const MAX_INFERENCE_DIMENSION = 1536;
const REQUIRED_CACHE_FILES = [
  'config.json',
  'preprocessor_config.json',
  'onnx/vision_encoder_quantized.onnx',
  'onnx/prompt_encoder_mask_decoder_quantized.onnx',
] as const;

type TransformerRuntime = {
  model: {
    (inputs: unknown): Promise<any>;
    dispose?: () => Promise<unknown>;
  };
  processor: {
    (image: unknown, options?: unknown): Promise<any>;
    post_process_masks: (masks: unknown, originalSizes: unknown, reshapedInputSizes: unknown) => Promise<any[]>;
  };
  RawImage: {
    read: (input: string) => Promise<any>;
  };
  env: {
    useBrowserCache: boolean;
    useWasmCache: boolean;
    cacheKey: string;
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
  };
};

let status: LocalSegmentationStatus = 'unavailable';
let progress = 0;
let lastError = '';
let cached = false;
let runtime: TransformerRuntime | null = null;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function modelFileUrl(file: string) {
  return `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/${file}`;
}

async function hasCompleteBrowserCache() {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(MODEL_CACHE_NAME);
    const entries = await Promise.all(REQUIRED_CACHE_FILES.map(async (file) => {
      const remoteUrl = modelFileUrl(file);
      return Boolean(await cache.match(remoteUrl));
    }));
    return entries.every(Boolean);
  } catch {
    return false;
  }
}

function handleProgress(info: unknown) {
  if (!info || typeof info !== 'object') return;
  const data = info as Record<string, unknown>;
  if (data.status === 'progress_total' && typeof data.progress === 'number') {
    progress = clampProgress(data.progress);
    emit();
    return;
  }
  if (data.status === 'progress' && typeof data.loaded === 'number' && typeof data.total === 'number' && data.total > 0) {
    // The library's total callback is preferred, but this keeps the progress
    // bar useful in browsers/CDNs that do not expose file metadata.
    progress = Math.max(progress, clampProgress((data.loaded / data.total) * 100));
    emit();
  }
}

function configureTransformers(transformersEnv: TransformerRuntime['env']) {
  // Keep this cache bucket separate from any future Transformers.js feature in
  // the app, so the "清除本地模型" action cannot remove unrelated data.
  transformersEnv.useBrowserCache = typeof caches !== 'undefined';
  transformersEnv.useWasmCache = typeof caches !== 'undefined';
  transformersEnv.cacheKey = MODEL_CACHE_NAME;
  transformersEnv.allowRemoteModels = true;
  transformersEnv.allowLocalModels = false;
}

async function load() {
  if (status === 'ready' && runtime) return;
  if (loadPromise) return loadPromise;

  status = 'loading';
  progress = cached ? 8 : 0;
  lastError = '';
  emit();

  loadPromise = (async () => {
    try {
      const transformers = await import('@huggingface/transformers');
      const transformerRuntime = transformers as unknown as {
        AutoProcessor: { from_pretrained: (modelId: string, options?: unknown) => Promise<any> };
        SamModel: { from_pretrained: (modelId: string, options?: unknown) => Promise<any> };
        RawImage: TransformerRuntime['RawImage'];
        env: TransformerRuntime['env'];
      };
      configureTransformers(transformerRuntime.env);
      const options = {
        revision: MODEL_REVISION,
        device: MODEL_DEVICE,
        dtype: MODEL_DTYPE,
        progress_callback: handleProgress,
      };
      const processor = await transformerRuntime.AutoProcessor.from_pretrained(MODEL_ID, options);
      const model = await transformerRuntime.SamModel.from_pretrained(MODEL_ID, options);
      runtime = {
        model,
        processor,
        RawImage: transformerRuntime.RawImage,
        env: transformerRuntime.env,
      };
      cached = true;
      progress = 100;
      status = 'ready';
      lastError = '';
      emit();
    } catch (cause) {
      runtime = null;
      status = 'error';
      progress = 0;
      lastError = cause instanceof Error ? cause.message : '模型下载或加载失败';
      loadPromise = null;
      emit();
      throw cause;
    }
  })();

  return loadPromise;
}

async function segment(imageDataUrl: string, point: LocalEditPoint): Promise<LocalSegmentationResult> {
  await load();
  if (!runtime) throw new Error('本地主体识别模型暂时不可用，请改用手动标记。');

  let image = await runtime.RawImage.read(imageDataUrl);
  if (Math.max(image.width, image.height) > MAX_INFERENCE_DIMENSION) {
    const scale = MAX_INFERENCE_DIMENSION / Math.max(image.width, image.height);
    image = await image.resize(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  }

  const inputPoints = [[[point.x * image.width, point.y * image.height]]];
  const inputs = await runtime.processor(image, { input_points: inputPoints });
  const outputs = await runtime.model(inputs);
  const masks = await runtime.processor.post_process_masks(
    outputs.pred_masks,
    inputs.original_sizes,
    inputs.reshaped_input_sizes,
  );
  const scores = Array.from(outputs.iou_scores?.data ?? [], Number);
  const bestIndex = scores.length
    ? scores.reduce((best: number, score: number, index: number) => score > scores[best] ? index : best, 0)
    : 0;
  const maskBatch = masks[0];
  const mask = maskBatch?.[0]?.[bestIndex];
  if (!mask?.dims || mask.dims.length !== 2 || !mask.data) {
    throw new Error('智能识别没有返回有效主体遮罩，请改用手动标记。');
  }

  const [height, width] = mask.dims as [number, number];
  const rgba = new Uint8ClampedArray(width * height * 4);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const selected = Number(mask.data[y * width + x]) > 0;
      const offset = (y * width + x) * 4;
      rgba[offset] = 255;
      rgba[offset + 1] = 255;
      rgba[offset + 2] = 255;
      // SAM marks the clicked subject with 1. The editor uses the service
      // mask convention: transparent pixels are editable, opaque pixels are
      // protected, so the selected subject must become transparent here.
      rgba[offset + 3] = selected ? 0 : 255;
      if (selected) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    throw new Error('没有识别到主体，请换一个更靠近主体的位置，或改用手动标记。');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法生成主体遮罩，请改用手动标记。');
  context.putImageData(new ImageData(rgba, width, height), 0, 0);
  return {
    maskDataUrl: canvas.toDataURL('image/png'),
    bounds: {
      x: minX / width,
      y: minY / height,
      width: (maxX - minX + 1) / width,
      height: (maxY - minY + 1) / height,
    },
    label: '本地主体',
  };
}

async function clear() {
  if (status === 'loading') throw new Error('模型正在安装，请稍候再清除。');
  try {
    await runtime?.model.dispose?.();
  } finally {
    runtime = null;
    loadPromise = null;
    cached = false;
    progress = 0;
    status = 'unavailable';
    lastError = '';
    if (typeof caches !== 'undefined') await caches.delete(MODEL_CACHE_NAME);
    emit();
  }
}

const provider: LocalSegmentationProvider = {
  id: LOCAL_SEGMENTATION_MODEL.id,
  modelName: MODEL_ID,
  status: () => status,
  progress: () => progress,
  error: () => lastError,
  cached: () => cached,
  clear,
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  load,
  segment,
};

// Register on both server and client so the optional provider has one stable
// identity and the editor can render its install card for every user.
registerLocalSegmentationProvider(provider);
void hasCompleteBrowserCache().then((value) => {
  if (!value || cached) return;
  cached = true;
  emit();
});

export const LOCAL_SEGMENTATION_BROWSER_INFO = {
  modelId: MODEL_ID,
  revision: MODEL_REVISION,
  estimatedBytes: ESTIMATED_MODEL_BYTES,
  estimatedLabel: '约 14 MB',
  cacheName: MODEL_CACHE_NAME,
};

export function getBrowserLocalSegmentationProvider() {
  return provider;
}
