import type { CanvasRuntimeState } from "./types";
import type { AgentDeliverable } from "../agent-intent";
import type { CreativeReference } from "../creative-references";
import {
  requestAgent,
  type AgentResponse,
  type AgentStreamEvent,
} from "../agent-client";

export type CanvasAsset = {
  id: string;
  kind: "image" | "video";
  name: string;
  url: string;
  mime: string;
  size: number;
  optimized?: boolean;
  originalSize?: number;
  uploadedSize?: number;
};

export const CANVAS_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const CANVAS_IMAGE_MAX_EDGE = 6144;

export type CanvasUploadPreparation = {
  file: File;
  changed: boolean;
  originalSize: number;
  uploadedSize: number;
};

export type CanvasAgentTask =
  | "reverse_prompt"
  | "one_take_video_prompt"
  | "optimize_prompt";

export function inferCanvasAgentTask(
  prompt: string,
  hasImageReferences: boolean,
): CanvasAgentTask | undefined {
  if (!hasImageReferences) return undefined;
  const value = String(prompt || "").replace(/\s+/g, " ").trim();
  if (
    /(?:反推|提取|识别|分析).{0,24}(?:提示词|prompt)/i.test(value) ||
    /(?:提示词|prompt).{0,24}(?:反推|提取|识别)/i.test(value)
  )
    return "reverse_prompt";
  if (/(?:一镜到底|串联成一段|按顺序).{0,32}(?:视频|video|prompt|提示词)/i.test(value))
    return "one_take_video_prompt";
  if (/(?:优化|润色|改写|扩写).{0,24}(?:提示词|prompt)/i.test(value))
    return "optimize_prompt";
  return undefined;
}

function loadUploadImage(file: File) {
  const objectUrl = URL.createObjectURL(file);
  return new Promise<{ image: HTMLImageElement; objectUrl: string }>(
    (resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ image, objectUrl });
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("读取图片尺寸失败"));
      };
      image.src = objectUrl;
    },
  );
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
) {
  return new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, type, quality);
    } catch {
      resolve(null);
    }
  });
}

function hasTransparentPixels(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  mime: string,
) {
  if (/jpe?g/i.test(mime)) return false;
  try {
    const pixels = context.getImageData(0, 0, width, height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 255) return true;
    }
    return false;
  } catch {
    // If the browser cannot inspect alpha, use an alpha-capable format rather
    // than risking a transparent source being flattened into JPEG.
    return true;
  }
}

function extensionForImageMime(mime: string) {
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg")) return "jpg";
  return "png";
}

function fileNameForImageMime(name: string, mime: string) {
  const original = name.trim() || "画布图片";
  const dot = original.lastIndexOf(".");
  const base = dot > 0 ? original.slice(0, dot) : original;
  return `${base}.${extensionForImageMime(mime)}`;
}

function renderUploadCanvas(
  image: HTMLImageElement,
  maxEdge: number,
) {
  const sourceWidth = Math.max(1, image.naturalWidth || image.width);
  const sourceHeight = Math.max(1, image.naturalHeight || image.height);
  const sourceMaxEdge = Math.max(sourceWidth, sourceHeight);
  const scale = Math.min(1, maxEdge / sourceMaxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持本地图片处理");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, context, sourceWidth, sourceHeight, sourceMaxEdge };
}

function optimizedUploadFile(blob: Blob, original: File) {
  const mime = blob.type || "image/png";
  const file = new File([blob], fileNameForImageMime(original.name, mime), {
    type: mime,
    lastModified: original.lastModified,
  });
  return {
    file,
    changed: true,
    originalSize: original.size,
    uploadedSize: file.size,
  } satisfies CanvasUploadPreparation;
}

/**
 * Convert a chat reference to the same compact browser image used by the
 * main Agent surface. Providers can reject a perfectly valid image_url when
 * the original canvas asset is too large or uses an unsupported encoding.
 */
export async function compressReferenceDataUrl(dataUrl: string) {
  if (!dataUrl || !/^data:image\//i.test(dataUrl)) return dataUrl;

  const source = new Image();
  await new Promise<void>((resolve, reject) => {
    source.onload = () => resolve();
    source.onerror = () => reject(new Error("读取参考图片尺寸失败"));
    source.src = dataUrl;
  });

  const maxEdge = 1400;
  let scale = Math.min(
    1,
    maxEdge / Math.max(source.naturalWidth, source.naturalHeight),
  );
  let compressed = dataUrl;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    let preserveAlpha = !/jpe?g/i.test(
      dataUrl.slice(5, dataUrl.indexOf(";")),
    );
    if (preserveAlpha) {
      try {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        preserveAlpha = false;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] < 255) {
            preserveAlpha = true;
            break;
          }
        }
      } catch {
        preserveAlpha = true;
      }
    }

    compressed = canvas.toDataURL(
      preserveAlpha ? "image/webp" : "image/jpeg",
      Math.max(0.56, 0.78 - attempt * 0.05),
    );
    if (compressed.length <= 900000) break;
    scale *= 0.82;
  }
  return compressed;
}

/**
 * Prepare one image for a canvas upload. Videos and images within both limits
 * are returned unchanged; an image that needs processing is never replaced by
 * its original file when local optimization fails.
 */
export async function optimizeCanvasUploadFile(
  file: File,
): Promise<CanvasUploadPreparation> {
  const unchanged = {
    file,
    changed: false,
    originalSize: file.size,
    uploadedSize: file.size,
  } satisfies CanvasUploadPreparation;
  if (!file.type.startsWith("image/")) return unchanged;

  let loaded: { image: HTMLImageElement; objectUrl: string } | null = null;
  try {
    loaded = await loadUploadImage(file);
  } catch {
    if (file.size <= CANVAS_IMAGE_MAX_BYTES)
      return unchanged;
    throw new Error(
      "图片过大且浏览器无法处理，请改用 JPG/WebP 或更小的图片。",
    );
  }

  try {
    const sourceWidth = Math.max(
      1,
      loaded.image.naturalWidth || loaded.image.width,
    );
    const sourceHeight = Math.max(
      1,
      loaded.image.naturalHeight || loaded.image.height,
    );
    const sourceMaxEdge = Math.max(sourceWidth, sourceHeight);
    if (
      file.size <= CANVAS_IMAGE_MAX_BYTES &&
      sourceMaxEdge <= CANVAS_IMAGE_MAX_EDGE
    ) {
      return unchanged;
    }

    let maxEdge = Math.min(CANVAS_IMAGE_MAX_EDGE, sourceMaxEdge);
    let quality = 0.86;
    let encodedImage = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const rendered = renderUploadCanvas(loaded.image, maxEdge);
      const preserveAlpha = hasTransparentPixels(
        rendered.context,
        rendered.canvas.width,
        rendered.canvas.height,
        file.type,
      );
      const outputTypes = preserveAlpha
        ? ["image/webp", "image/png"]
        : ["image/jpeg"];
      for (const outputType of outputTypes) {
        const blob = await canvasToBlob(
          rendered.canvas,
          outputType,
          outputType === "image/png" ? undefined : quality,
        );
        if (!blob) continue;
        encodedImage = true;
        if (blob.size <= CANVAS_IMAGE_MAX_BYTES) {
          return optimizedUploadFile(blob, file);
        }
      }
      maxEdge = Math.max(1024, Math.floor(maxEdge * 0.84));
      quality = Math.max(0.52, quality - 0.05);
    }

    if (!encodedImage)
      throw new Error(
        "图片压缩失败，请改用 JPG/WebP 或更小的图片后重试。",
      );
    throw new Error(
      "图片过大，自动优化后仍超过 25MB，请改用更小的图片。",
    );
  } finally {
    URL.revokeObjectURL(loaded.objectUrl);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...options });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && ("error" in body || "message" in body)
        ? String(
            (body as { error?: unknown; message?: unknown }).error ||
              (body as { message?: unknown }).message,
          )
        : `请求失败：${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function loadCanvasRuntime() {
  return request<CanvasRuntimeState>("/api/state");
}

export async function asDataUrl(url: string) {
  if (!url || url.startsWith("data:")) return url;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取画布参考素材，请重新导入。");
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("参考素材读取失败。"));
    reader.readAsDataURL(blob);
  });
}

export const CANVAS_AGENT_REFERENCE_CACHE_LIMIT = 16;
const canvasAgentReferenceCache = new Map<string, Promise<string>>();

async function cachedCanvasAgentReference(url: string) {
  const cached = canvasAgentReferenceCache.get(url);
  if (cached) {
    canvasAgentReferenceCache.delete(url);
    canvasAgentReferenceCache.set(url, cached);
    return cached;
  }
  const prepared = asDataUrl(url).then(compressReferenceDataUrl);
  canvasAgentReferenceCache.set(url, prepared);
  while (canvasAgentReferenceCache.size > CANVAS_AGENT_REFERENCE_CACHE_LIMIT) {
    const oldest = canvasAgentReferenceCache.keys().next().value as string | undefined;
    if (!oldest) break;
    canvasAgentReferenceCache.delete(oldest);
  }
  try {
    return await prepared;
  } catch (error) {
    if (canvasAgentReferenceCache.get(url) === prepared)
      canvasAgentReferenceCache.delete(url);
    throw error;
  }
}

export async function prepareCanvasAgentReferences(
  references: Array<{ url: string; name?: string }> = [],
) {
  return Promise.all(references.slice(0, 16).map(async (reference) => ({
    ...reference,
    url: await cachedCanvasAgentReference(reference.url),
  })));
}

export async function uploadCanvasAsset(file: File) {
  const prepared = await optimizeCanvasUploadFile(file);
  const asset = await request<CanvasAsset>("/api/canvas/assets", {
    method: "POST",
    headers: {
      "Content-Type": prepared.file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(prepared.file.name),
    },
    body: prepared.file,
  });
  return {
    ...asset,
    optimized: prepared.changed,
    originalSize: prepared.originalSize,
    uploadedSize: prepared.uploadedSize,
  };
}

export async function generateCanvasImage(input: {
  taskId?: string;
  prompt: string;
  model?: string;
  count?: number;
  aspect?: string;
  resolution?: string;
  quality?: string;
  width?: number;
  height?: number;
  outputFormat?: "png" | "jpeg" | "webp";
  background?: "transparent" | "opaque";
  maskUrl?: string;
  references?: Array<{ url: string; name?: string }>;
}) {
  const references = await Promise.all(
    (input.references || [])
      .slice(0, 16)
      .map(async (item) => compressReferenceDataUrl(await asDataUrl(item.url))),
  );
  const mask = input.maskUrl ? await asDataUrl(input.maskUrl) : undefined;
  return request<{
    images: Array<{ url: string; revisedPrompt?: string }>;
    model?: { id?: string; name?: string; provider?: string };
  }>("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "canvas",
      ...(input.taskId ? { taskId: input.taskId } : {}),
      prompt: input.prompt,
      model: input.model || "auto",
      count: Math.max(1, Math.min(8, Number(input.count || 1))),
      aspectRatio: input.aspect || "自动",
      resolution: input.resolution || "自动",
      quality: input.quality || "自动",
      ...(input.width && input.height
        ? { width: input.width, height: input.height }
        : {}),
      ...(input.outputFormat ? { outputFormat: input.outputFormat } : {}),
      ...(input.background ? { background: input.background } : {}),
      ...(mask ? { mask } : {}),
      references,
      referenceImages: (input.references || [])
        .slice(0, 16)
        .map((item, index) => ({
          name: item.name || `参考图 ${index + 1}`,
          url: item.url,
        })),
    }),
  });
}

export async function generateCanvasVideo(input: {
  prompt: string;
  model?: string;
  operation?: "generate" | "edit" | "extend";
  inputMode?: "text" | "first-frame" | "frames" | "reference";
  duration?: number;
  aspect?: string;
  resolution?: string;
  references?: Array<{ url: string; name?: string }>;
  referenceVideos?: Array<{ url: string; name?: string }>;
  /** Explicit frame slots supplied by the canvas resolver. */
  firstFrame?: string;
  lastFrame?: string;
  referenceVideo?: string;
  audio?: boolean;
}) {
  const referenceData = await Promise.all(
    (input.references || [])
      .slice(0, 16)
      .map(async (item) => compressReferenceDataUrl(await asDataUrl(item.url))),
  );
  const firstFrame =
    input.inputMode === "first-frame" || input.inputMode === "frames"
      ? input.firstFrame
        ? await compressReferenceDataUrl(await asDataUrl(input.firstFrame))
        : referenceData[0]
      : undefined;
  const lastFrame =
    input.inputMode === "frames"
      ? input.lastFrame
        ? await compressReferenceDataUrl(await asDataUrl(input.lastFrame))
        : referenceData[1]
      : undefined;
  if (input.inputMode === "first-frame" && !firstFrame) {
    throw new Error("首帧模式请先添加首帧图片。");
  }
  if (input.inputMode === "frames" && (!firstFrame || !lastFrame)) {
    throw new Error("首尾帧模式请先添加首帧和尾帧图片。");
  }
  const videoMode = input.inputMode === "reference"
    ? "reference"
    : input.inputMode === "frames"
      ? "keyframe"
      : input.inputMode === "text"
        ? "text"
        : undefined;
  const referenceVideo = input.inputMode === "reference" || input.operation === "edit" || input.operation === "extend"
    ? input.referenceVideo
    : undefined;
  const result = await request<{
    task: {
      id: string;
      status: string;
      progress?: number;
      videoUrls?: string[];
      error?: string;
      modelId?: string;
    };
  }>("/api/video/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      source: "canvas",
      model: input.model || "auto",
      operation: input.operation || "generate",
      input: {
        prompt: input.prompt,
        ...(input.operation ? { operation: input.operation } : {}),
        ...(videoMode ? { videoMode } : {}),
        seconds: Number(input.duration || 5),
        aspectRatio: input.aspect || "16:9",
        resolution: input.resolution || "720p",
        ...(firstFrame ? { firstFrame } : {}),
        ...(lastFrame ? { lastFrame } : {}),
        referenceImages:
          input.inputMode === "reference"
            ? referenceData
            : input.inputMode
              ? []
              : referenceData,
        ...(referenceVideo
          ? { referenceVideo }
          : {}),
        ...(input.referenceVideos?.length
          ? {
              referenceVideos: input.referenceVideos.slice(0, 10).map((item) => item.url),
              referenceVideo: referenceVideo || input.referenceVideos[0]?.url,
            }
          : {}),
      },
    }),
  });
  return result.task;
}

export async function generateCanvasUpscale(input: {
  taskId?: string;
  sourceImageId?: string;
  prompt?: string;
  model?: string;
  referenceUrl: string;
  scale: number;
  size?: string;
  seed?: number;
  colorCorrection?: string;
  resizeMethod?: string;
  cloud?: boolean;
  outputFormat?: "png" | "jpg" | "bmp";
  outputQuality?: number;
}) {
  const reference = await asDataUrl(input.referenceUrl);
  return request<{
    images: Array<{ url: string; revisedPrompt?: string }>;
    model?: { id?: string; name?: string; provider?: string };
    taskId?: string;
    status?: "queued" | "processing" | "succeeded" | "failed";
    sourceImageId?: string;
  }>("/api/upscale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "canvas",
      ...(input.taskId ? { taskId: input.taskId } : {}),
      prompt: input.prompt || "Upscale this image",
      model: input.model || "auto",
      reference,
      referenceImages: [{ name: "超分原图", url: input.referenceUrl }],
      ...(input.sourceImageId ? { sourceImageId: input.sourceImageId } : {}),
      scale: Math.max(1, Math.min(4, Number(input.scale || 2))),
      ...(input.cloud ? {
        ...(input.outputFormat ? { outputFormat: input.outputFormat } : {}),
        ...(input.outputFormat === "jpg" ? { outputQuality: Math.max(30, Math.min(100, Math.round(Number(input.outputQuality) || 95))) } : {}),
      } : {
        size: input.size || "1024x1024",
        seed: Math.max(0, Number(input.seed || 0)),
        colorCorrection: input.colorCorrection || "wavelet",
        resizeMethod: input.resizeMethod || "lanczos",
      }),
    }),
  });
}

export async function getCanvasUpscaleTask(taskId: string) {
  return request<{
    task: { id: string; status: "queued" | "processing" | "succeeded" | "failed"; error?: string; errorCode?: string; sourceImageId?: string };
    images: Array<{ url: string; revisedPrompt?: string }>;
    model?: { id?: string; name?: string; provider?: string };
  }>(`/api/upscale/tasks/${encodeURIComponent(taskId)}`, { cache: "no-store" });
}

export type CanvasAgentResponse = AgentResponse;
export type CanvasAgentStreamEvent = AgentStreamEvent;

export const CANVAS_AGENT_MAX_WAIT_MS = 5 * 60 * 1000;

export async function generateCanvasAgent(
  input: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    model?: string;
    webMode?: "off" | "auto" | "always";
    references?: Array<Pick<CreativeReference, "id" | "kind" | "name" | "url" | "text" | "mimeType" | "nodeId">>;
    task?: CanvasAgentTask;
    deliverable?: AgentDeliverable;
    intentReason?: string;
    signal?: AbortSignal;
  },
  onEvent?: (event: CanvasAgentStreamEvent) => void,
) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) abortFromCaller();
  else input.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("Agent 请求超时，请重试。"));
  }, CANVAS_AGENT_MAX_WAIT_MS);
  try {
    const preparedReferences = await Promise.all((input.references || []).slice(0, 16).map(async (reference, index) => {
      if (reference.kind === "text") {
        return { id: reference.id || `canvas-ref-${index + 1}`, kind: "text" as const, name: reference.name || `文本 ${index + 1}`, text: reference.text || "", ...(reference.mimeType ? { mimeType: reference.mimeType } : {}), ...(reference.nodeId ? { nodeId: reference.nodeId } : {}) };
      }
      const url = reference.url ? await cachedCanvasAgentReference(reference.url) : "";
      return { id: reference.id || `canvas-ref-${index + 1}`, kind: reference.kind || "image", name: reference.name || `参考图 ${index + 1}`, url, ...(reference.mimeType ? { mimeType: reference.mimeType } : {}), ...(reference.nodeId ? { nodeId: reference.nodeId } : {}) };
    }));
    const messages = input.messages.map((message, index, all) => ({
      ...message,
      references: index === all.length - 1 ? preparedReferences : [],
      files: [],
    }));
    return await requestAgent(
      {
        source: "canvas",
        messages,
        model: input.model || "auto",
        ...(input.task ? { task: input.task } : {}),
        webMode: input.webMode || "off",
        webSearch: input.webMode !== "off",
        references: preparedReferences,
        ...(input.deliverable ? { deliverable: input.deliverable } : {}),
        ...(input.intentReason ? { intentReason: input.intentReason } : {}),
      },
      { signal: controller.signal, onEvent },
    );
  } catch (error) {
    if (timedOut) throw new Error("Agent 请求超时，请重试。");
    throw error;
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function getCanvasVideoTask(id: string) {
  return request<{
    task: {
      id: string;
      status: string;
      progress?: number;
      videoUrls?: string[];
      error?: string;
      modelId?: string;
    };
  }>(`/api/video/tasks/${encodeURIComponent(id)}`);
}
