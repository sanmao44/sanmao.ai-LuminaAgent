"use client";

import { zipSync } from "fflate";
import { encodeCanvasDepthVideoFrameSequence, probeCanvasVideoFrameRate, uploadCanvasAsset } from "./canvas/api";

export type LocalDepthVideoProgress = {
  phase: "loading" | "processing" | "encoding";
  progress: number;
  message: string;
};

const MODEL_ID = "onnx-community/depth-anything-v2-small";
const CACHE_NAME = "sanmao-local-depth-v1";
// Keep inference high enough for meaningful contours, but avoid 4K WebGPU/WASM stalls.
const MAX_INFERENCE_SIDE = 1024;
// Re-expand the inferred depth map for export without making a browser-sized 4K video.
const MAX_EXPORT_SIDE = 1920;
const MAX_DURATION_SECONDS = 30;

type DepthPipeline = ((image: unknown) => Promise<{ depth: { toCanvas: () => HTMLCanvasElement } }>) & {
  dispose?: () => Promise<void>;
};

let pipelinePromise: Promise<DepthPipeline> | null = null;

function emitProgress(onProgress: ((progress: LocalDepthVideoProgress) => void) | undefined, value: LocalDepthVideoProgress) {
  onProgress?.({ ...value, progress: Math.max(0, Math.min(100, value.progress)) });
}

async function loadPipeline(onProgress?: (progress: LocalDepthVideoProgress) => void) {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      emitProgress(onProgress, { phase: "loading", progress: 2, message: "正在加载深度模型…" });
      const transformers = await import("@huggingface/transformers");
      const env = transformers.env as typeof transformers.env & { useBrowserCache?: boolean; useWasmCache?: boolean; cacheKey?: string };
      env.useBrowserCache = typeof caches !== "undefined";
      env.useWasmCache = typeof caches !== "undefined";
      env.cacheKey = CACHE_NAME;
      const device = typeof navigator !== "undefined" && "gpu" in navigator ? "webgpu" : "wasm";
      try {
        return await transformers.pipeline("depth-estimation", MODEL_ID, {
          device,
          dtype: device === "webgpu" ? "fp16" : "q8",
          progress_callback: (info: unknown) => {
            if (info && typeof info === "object" && "progress" in info) {
              emitProgress(onProgress, { phase: "loading", progress: Number((info as { progress?: number }).progress) || 0, message: "正在下载深度模型…" });
            }
          },
        }) as unknown as DepthPipeline;
      } catch (error) {
        if (device !== "webgpu") throw error;
        return await transformers.pipeline("depth-estimation", MODEL_ID, {
          device: "wasm",
          dtype: "q8",
          progress_callback: (info: unknown) => {
            if (info && typeof info === "object" && "progress" in info) {
              emitProgress(onProgress, { phase: "loading", progress: Number((info as { progress?: number }).progress) || 0, message: "正在准备 CPU 模型…" });
            }
          },
        }) as unknown as DepthPipeline;
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
  const sourceResponse = await fetch(sourceUrl, { cache: "no-store" });
  if (!sourceResponse.ok) throw new Error(`无法读取原视频：HTTP ${sourceResponse.status}`);
  const sourceBlob = await sourceResponse.blob();
  const sourceFile = new File([sourceBlob], sourceName, { type: sourceBlob.type || "video/mp4" });
  emitProgress(onProgress, { phase: "loading", progress: 4, message: "正在识别原视频帧率…" });
  const fps = await probeCanvasVideoFrameRate(sourceFile);
  const estimator = await loadPipeline(onProgress);
  const frameCount = Math.max(1, Math.round(duration * fps));
  const sourceWidth = Math.max(2, video.videoWidth);
  const sourceHeight = Math.max(2, video.videoHeight);
  const inferenceScale = Math.min(1, MAX_INFERENCE_SIDE / Math.max(sourceWidth, sourceHeight));
  const inferenceWidth = Math.max(2, Math.round(sourceWidth * inferenceScale));
  const inferenceHeight = Math.max(2, Math.round(sourceHeight * inferenceScale));
  const exportScale = Math.min(1, MAX_EXPORT_SIDE / Math.max(sourceWidth, sourceHeight));
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
    const result = await estimator(sourceCanvas);
    const depthCanvas = result.depth.toCanvas() as HTMLCanvasElement;
    context.clearRect(0, 0, exportWidth, exportHeight);
    context.drawImage(depthCanvas, 0, 0, exportWidth, exportHeight);
    frames.push(await canvasBlob(canvas, "image/webp", 0.88));
    emitProgress(onProgress, { phase: "processing", progress: ((index + 1) / frameCount) * 100, message: `正在处理第 ${index + 1}/${frameCount} 帧…` });
  }
  const base = sourceName.replace(/\.[^.]+$/, "") || "video";
  emitProgress(onProgress, { phase: "encoding", progress: 1, message: "正在整理深度帧…" });
  const archive = await depthFrameArchive(frames);
  emitProgress(onProgress, { phase: "encoding", progress: 18, message: "正在按原帧率合成兼容剪辑软件的 MP4…" });
  const mp4Blob = await encodeCanvasDepthVideoFrameSequence(
    new File([archive], `${base}-depth-frames.zip`, { type: "application/zip" }),
    fps,
    frames.length,
  );
  const asset = await uploadCanvasAsset(new File([mp4Blob], `${base}-depth.mp4`, { type: "video/mp4" }));
  return { ...asset, fps, frameCount };
}

export function localDepthModelInfo() {
  return { modelId: MODEL_ID, cacheName: CACHE_NAME };
}
