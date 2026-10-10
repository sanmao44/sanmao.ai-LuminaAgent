"use client";

import { zipSync } from "fflate";
import { encodeCanvasDepthVideoFrameSequence, probeCanvasVideoFrameRate, uploadCanvasAsset } from "./canvas/api";
import { depthQualityProfile, type DepthQuality, type DepthQualityProfile } from "./canvas/depth-settings";

export type LocalDepthVideoProgress = {
  phase: "loading" | "processing" | "encoding";
  progress: number;
  message: string;
};

const MODEL_ID = "onnx-community/depth-anything-v2-small";
const CACHE_NAME = "sanmao-local-depth-v1";
const MAX_DURATION_SECONDS = 30;

export type LocalDepthVideoOptions = {
  quality?: DepthQuality;
  profile?: Partial<DepthQualityProfile>;
};

type DepthPipeline = ((image: unknown) => Promise<{ depth: { toCanvas: () => HTMLCanvasElement } }>) & {
  dispose?: () => Promise<void>;
  mode?: "model";
  processor?: {
    image_processor?: {
      size?: { width: number; height: number };
    };
  };
};

function stageError(stage: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "未知错误");
  const normalized = message.trim() || "未知错误";
  return new Error(`${stage}失败：${normalized.slice(0, 240)}`);
}

let pipelinePromise: Promise<DepthPipeline> | null = null;
let depthInferenceQueue: Promise<void> = Promise.resolve();

function configureDepthInferenceSize(estimator: DepthPipeline, side: number) {
  const imageProcessor = estimator.processor?.image_processor;
  if (!imageProcessor) {
    throw new Error("深度模型处理器不支持性能档位");
  }
  const normalizedSide = Math.max(224, Math.round(side));
  imageProcessor.size = { width: normalizedSide, height: normalizedSide };
}

function runDepthInference(estimator: DepthPipeline, image: HTMLCanvasElement, side: number) {
  const turn = depthInferenceQueue.then(async () => {
    configureDepthInferenceSize(estimator, side);
    return estimator(image);
  });
  depthInferenceQueue = turn.then(() => undefined, () => undefined);
  return turn;
}

function emitProgress(onProgress: ((progress: LocalDepthVideoProgress) => void) | undefined, value: LocalDepthVideoProgress) {
  onProgress?.({ ...value, progress: Math.max(0, Math.min(100, value.progress)) });
}

async function loadPipeline(onProgress?: (progress: LocalDepthVideoProgress) => void) {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      emitProgress(onProgress, { phase: "loading", progress: 2, message: "正在加载深度模型…" });
      const transformers = await import("@huggingface/transformers");
      const env = transformers.env as typeof transformers.env & {
        useBrowserCache?: boolean;
        useWasmCache?: boolean;
        cacheKey?: string;
        remoteHost?: string;
        remotePathTemplate?: string;
        allowRemoteModels?: boolean;
        allowLocalModels?: boolean;
      };
      env.useBrowserCache = typeof caches !== "undefined";
      env.useWasmCache = typeof caches !== "undefined";
      env.cacheKey = CACHE_NAME;
      env.allowRemoteModels = true;
      env.allowLocalModels = false;
      if (typeof window !== "undefined" && window.location.origin) {
        env.remoteHost = `${window.location.origin}/api/canvas/depth-model/`;
        env.remotePathTemplate = "{model}/resolve/{revision}/";
      }
      const device = typeof navigator !== "undefined" && "gpu" in navigator ? "webgpu" : "wasm";
      try {
        const loaded = await transformers.pipeline("depth-estimation", MODEL_ID, {
          device,
          dtype: device === "webgpu" ? "fp16" : "q8",
          progress_callback: (info: unknown) => {
            if (info && typeof info === "object" && "progress" in info) {
              emitProgress(onProgress, { phase: "loading", progress: Number((info as { progress?: number }).progress) || 0, message: "正在下载深度模型…" });
            }
          },
        }) as unknown as DepthPipeline;
        loaded.mode = "model";
        return loaded;
      } catch (error) {
        if (device === "webgpu") {
          const loaded = await transformers.pipeline("depth-estimation", MODEL_ID, {
            device: "wasm",
            dtype: "q8",
            progress_callback: (info: unknown) => {
              if (info && typeof info === "object" && "progress" in info) {
                emitProgress(onProgress, { phase: "loading", progress: Number((info as { progress?: number }).progress) || 0, message: "正在准备 CPU 模型…" });
              }
            },
          }) as unknown as DepthPipeline;
          loaded.mode = "model";
          return loaded;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`深度模型加载失败，未生成伪深度图：${message.slice(0, 240)}`);
      }
    })();
    pipelinePromise.catch(() => { pipelinePromise = null; });
  }
  return pipelinePromise;
}

function seek(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 0.002) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("读取视频帧失败")); };
    const cleanup = () => { video.removeEventListener("seeked", onSeeked); video.removeEventListener("error", onError); };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = time;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法编码深度图帧")), type, quality);
  });
}

async function depthFrameArchive(frames: Blob[]) {
  const entries = await Promise.all(frames.map(async (frame, index) => [
    `frame-${String(index).padStart(6, "0")}.webp`,
    new Uint8Array(await frame.arrayBuffer()),
  ] as const));
  return new Blob([zipSync(Object.fromEntries(entries), { level: 6 })], { type: "application/zip" });
}

export async function generateLocalDepthVideo(
  sourceUrl: string,
  sourceName = "video",
  onProgress?: (progress: LocalDepthVideoProgress) => void,
  knownDurationSeconds?: number,
  options: LocalDepthVideoOptions = {},
) {
  if (!sourceUrl) throw new Error("缺少视频输入");
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.src = sourceUrl;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("无法读取视频，请重新导入 MP4/WebM 视频"));
  });
  const mediaDuration = Number(video.duration);
  const fallbackDuration = Number(knownDurationSeconds);
  const duration = Number.isFinite(mediaDuration) && mediaDuration > 0
    ? mediaDuration
    : fallbackDuration;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取视频时长，请重新导入视频后重试");
  if (duration > MAX_DURATION_SECONDS) throw new Error(`为保证本机稳定处理，深度图节点暂支持 30 秒以内的视频；请先在视频剪辑中裁剪后再试`);
  const profile = {
    ...depthQualityProfile(options.quality),
    ...(options.profile || {}),
  };
  let sourceResponse: Response;
  try {
    sourceResponse = await fetch(sourceUrl, { cache: "no-store" });
  } catch (error) {
    throw stageError("读取原视频", error);
  }
  if (!sourceResponse.ok) throw new Error(`读取原视频失败：HTTP ${sourceResponse.status}`);
  let sourceBlob: Blob;
  try {
    sourceBlob = await sourceResponse.blob();
  } catch (error) {
    throw stageError("读取原视频内容", error);
  }
  const sourceFile = new File([sourceBlob], sourceName, { type: sourceBlob.type || "video/mp4" });
  emitProgress(onProgress, { phase: "loading", progress: 4, message: "正在识别原视频帧率…" });
  let fps: number;
  try {
    fps = await probeCanvasVideoFrameRate(sourceFile);
  } catch (error) {
    throw stageError("识别原视频帧率", error);
  }
  let estimator: DepthPipeline;
  try {
    estimator = await loadPipeline(onProgress);
  } catch (error) {
    throw stageError("加载深度模型", error);
  }
  const frameCount = Math.max(1, Math.round(duration * fps));
  const sourceWidth = Math.max(2, video.videoWidth);
  const sourceHeight = Math.max(2, video.videoHeight);
  const inferenceScale = Math.min(1, profile.inferenceSide / Math.max(sourceWidth, sourceHeight));
  const inferenceWidth = Math.max(2, Math.round(sourceWidth * inferenceScale));
  const inferenceHeight = Math.max(2, Math.round(sourceHeight * inferenceScale));
  const exportScale = Math.min(1, profile.exportSide / Math.max(sourceWidth, sourceHeight));
  const exportWidth = Math.max(2, Math.round(sourceWidth * exportScale));
  const exportHeight = Math.max(2, Math.round(sourceHeight * exportScale));
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = inferenceWidth; sourceCanvas.height = inferenceHeight;
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) throw new Error("当前浏览器不支持视频帧处理");
  const canvas = document.createElement("canvas");
  canvas.width = exportWidth; canvas.height = exportHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持深度视频编码");
  const frames: Blob[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    await seek(video, Math.min(duration, index / fps));
    sourceContext.drawImage(video, 0, 0, inferenceWidth, inferenceHeight);
    let result: { depth: { toCanvas: () => HTMLCanvasElement } };
    try {
      result = await runDepthInference(estimator, sourceCanvas, profile.inferenceSide);
    } catch (error) {
      throw stageError(`推理第 ${index + 1}/${frameCount} 帧`, error);
    }
    const depthCanvas = result.depth.toCanvas() as HTMLCanvasElement;
    context.clearRect(0, 0, exportWidth, exportHeight);
    context.drawImage(depthCanvas, 0, 0, exportWidth, exportHeight);
    try {
      frames.push(await canvasBlob(canvas, "image/webp", profile.frameQuality));
    } catch (error) {
      throw stageError(`编码第 ${index + 1}/${frameCount} 帧`, error);
    }
    emitProgress(onProgress, { phase: "processing", progress: ((index + 1) / frameCount) * 100, message: `正在处理第 ${index + 1}/${frameCount} 帧…` });
  }
  const base = sourceName.replace(/\.[^.]+$/, "") || "video";
  emitProgress(onProgress, { phase: "encoding", progress: 1, message: "正在整理深度帧…" });
  let archive: Blob;
  try {
    archive = await depthFrameArchive(frames);
  } catch (error) {
    throw stageError("整理深度帧", error);
  }
  emitProgress(onProgress, { phase: "encoding", progress: 18, message: "正在按原帧率合成兼容剪辑软件的 MP4…" });
  let mp4Blob: Blob;
  try {
    mp4Blob = await encodeCanvasDepthVideoFrameSequence(
      new File([archive], `${base}-depth-frames.zip`, { type: "application/zip" }),
      fps,
      frames.length,
    );
  } catch (error) {
    throw stageError("编码深度图 MP4", error);
  }
  let asset: Awaited<ReturnType<typeof uploadCanvasAsset>>;
  try {
    asset = await uploadCanvasAsset(new File([mp4Blob], `${base}-depth.mp4`, { type: "video/mp4" }));
  } catch (error) {
    throw stageError("上传深度图视频", error);
  }
  return { ...asset, fps, frameCount, inferenceMode: estimator.mode || "model" };
}

export function localDepthModelInfo() {
  return { modelId: MODEL_ID, cacheName: CACHE_NAME };
}
