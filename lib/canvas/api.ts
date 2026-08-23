import type { CanvasRuntimeState } from "./types";

export type CanvasAsset = {
  id: string;
  kind: "image" | "video";
  name: string;
  url: string;
  mime: string;
  size: number;
};

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
  return request<CanvasAsset>("/api/canvas/assets", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
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
