import type { CanvasRuntimeState } from "./types";

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
    (input.references || []).slice(0, 16).map((item) => asDataUrl(item.url)),
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
  referenceVideo?: string;
  audio?: boolean;
}) {
  const referenceData = await Promise.all(
    (input.references || []).slice(0, 16).map((item) => asDataUrl(item.url)),
  );
  const firstFrame =
    input.inputMode === "first-frame" || input.inputMode === "frames"
      ? referenceData[0]
      : undefined;
  const lastFrame = input.inputMode === "frames" ? referenceData[1] : undefined;
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
        seconds: Number(input.duration || 5),
        aspectRatio: input.aspect || "16:9",
        resolution: input.resolution || "720P",
        ...(firstFrame ? { firstFrame } : {}),
        ...(lastFrame ? { lastFrame } : {}),
        referenceImages:
          input.inputMode === "reference"
            ? referenceData
            : input.inputMode
              ? []
              : referenceData,
        ...(input.referenceVideo
          ? { referenceVideo: input.referenceVideo }
          : {}),
      },
    }),
  });
  return result.task;
}

export async function generateCanvasUpscale(input: {
  prompt?: string;
  model?: string;
  referenceUrl: string;
  scale: number;
  size?: string;
  seed?: number;
  colorCorrection?: string;
  resizeMethod?: string;
}) {
  const reference = await asDataUrl(input.referenceUrl);
  return request<{
    images: Array<{ url: string; revisedPrompt?: string }>;
    model?: { id?: string; name?: string; provider?: string };
  }>("/api/upscale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "canvas",
      prompt: input.prompt || "Upscale this image",
      model: input.model || "auto",
      reference,
      referenceImages: [{ name: "超分原图", url: input.referenceUrl }],
      scale: Math.max(1, Math.min(4, Number(input.scale || 2))),
      ...(input.size ? { size: input.size } : {}),
      seed: Math.max(0, Number(input.seed || 0)),
      colorCorrection: input.colorCorrection || "wavelet",
      resizeMethod: input.resizeMethod || "lanczos",
    }),
  });
}

export async function generateCanvasAgent(input: {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  webMode?: "off" | "auto" | "always";
  references?: Array<{ url: string; name?: string }>;
}) {
  const references = await Promise.all(
    (input.references || []).slice(0, 16).map((item) => asDataUrl(item.url)),
  );
  const messages = input.messages.slice(-15).map((message, index, all) => ({
    ...message,
    references: index === all.length - 1 ? references : [],
    files: [],
  }));
  return request<{
    ok?: boolean;
    message: string;
    model?: string;
    images?: Array<{ url: string; revisedPrompt?: string }>;
    error?: string;
  }>("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "canvas",
      messages,
      model: input.model || "auto",
      webMode: input.webMode || "off",
      webSearch: input.webMode !== "off",
      stream: false,
    }),
  });
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
