import { Zip, ZipPassThrough, zipSync } from "fflate";

export type CanvasImageDownloadItem = {
  id: string;
  name?: string;
  url: string;
};

export type CanvasMediaDownloadItem = CanvasImageDownloadItem & {
  kind: "image" | "video";
};

type CanvasGroupDownloadNode = {
  id: string;
  type: string;
  data: { kind?: unknown; name?: unknown; url?: unknown; status?: unknown };
};

export type CanvasImageZip = {
  blob: Blob;
  fileNames: string[];
};

const MIME_EXTENSIONS: Record<string, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

const SAFE_EXTENSION = /^(?:avif|gif|jpe?g|png|svg|webp)$/i;
const VIDEO_MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
};
const SAFE_VIDEO_EXTENSION = /^(?:m4v|mov|mp4|ogv|webm)$/i;

export function canvasGroupDownloadItems(nodes: CanvasGroupDownloadNode[]): CanvasMediaDownloadItem[] {
  return nodes.flatMap((node) => {
    const kind = node.data.kind;
    const url = typeof node.data.url === "string" ? node.data.url.trim() : "";
    if (
      (node.type !== "media" && node.type !== "upscale") ||
      (kind !== "image" && kind !== "video") ||
      ["queued", "running", "failed"].includes(String(node.data.status || "")) ||
      !url
    ) return [];
    return [{
      id: node.id,
      name: String(node.data.name || (kind === "video" ? "视频素材" : "图片素材")),
      url,
      kind,
    }];
  });
}

export function orderCanvasImageItems(
  items: CanvasImageDownloadItem[],
  selectedIds: Iterable<string>,
) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return [...selectedIds]
    .map((id) => byId.get(id))
    .filter((item): item is CanvasImageDownloadItem => Boolean(item));
}

export function selectedCanvasVideoDownloadItems(
  nodes: CanvasGroupDownloadNode[],
  selectedIds: Iterable<string>,
): CanvasMediaDownloadItem[] {
  const videos = canvasGroupDownloadItems(nodes).filter((item) => item.kind === "video");
  const byId = new Map(videos.map((item) => [item.id, item]));
  return [...selectedIds]
    .map((id) => byId.get(id))
    .filter((item): item is CanvasMediaDownloadItem => Boolean(item));
}

function safeStem(name: string | undefined, kind: CanvasMediaDownloadItem["kind"]) {
  const mediaExtension = kind === "video"
    ? /\.(?:m4v|mov|mp4|ogv|webm)$/i
    : /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;
  const normalized = String(name || "SANMAO素材")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 96)
    .trim();
  return (normalized || "SANMAO素材").replace(mediaExtension, "");
}

function imageExtension(item: CanvasImageDownloadItem, contentType: string) {
  const mimeExtension = MIME_EXTENSIONS[contentType.toLowerCase().split(";", 1)[0]];
  if (mimeExtension) return mimeExtension;
  const nameExtension = String(item.name || "").match(/\.([a-z0-9]{2,5})$/i)?.[1];
  if (nameExtension && SAFE_EXTENSION.test(nameExtension)) return nameExtension.toLowerCase().replace("jpeg", "jpg");
  try {
    const urlExtension = new URL(item.url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1];
    if (urlExtension && SAFE_EXTENSION.test(urlExtension)) return urlExtension.toLowerCase().replace("jpeg", "jpg");
  } catch {
    // Data URLs and local asset URLs may not have a URL pathname.
  }
  return "png";
}

function mediaExtension(item: CanvasMediaDownloadItem, contentType: string) {
  if (item.kind === "image") return imageExtension(item, contentType);
  const mimeExtension = VIDEO_MIME_EXTENSIONS[contentType.toLowerCase().split(";", 1)[0]];
  if (mimeExtension) return mimeExtension;
  const nameExtension = String(item.name || "").match(/\.([a-z0-9]{2,5})$/i)?.[1];
  if (nameExtension && SAFE_VIDEO_EXTENSION.test(nameExtension)) return nameExtension.toLowerCase();
  try {
    const urlExtension = new URL(item.url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1];
    if (urlExtension && SAFE_VIDEO_EXTENSION.test(urlExtension)) return urlExtension.toLowerCase();
  } catch {
    // Data URLs and local asset URLs may not have a URL pathname.
  }
  return "mp4";
}

function uniqueFileName(item: CanvasMediaDownloadItem, index: number, total: number, contentType: string, used: Set<string>) {
  const prefix = String(index + 1).padStart(Math.max(2, String(total).length), "0");
  const extension = mediaExtension(item, contentType);
  const stem = safeStem(item.name, item.kind);
  const base = `${prefix}-${stem}`;
  let fileName = `${base}.${extension}`;
  let suffix = 2;
  while (used.has(fileName)) fileName = `${base}-${suffix++}.${extension}`;
  used.add(fileName);
  return fileName;
}

function rejectionMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : "未知错误";
}

export async function createCanvasImageZip(
  items: CanvasImageDownloadItem[],
  fetcher: typeof fetch = fetch,
): Promise<CanvasImageZip> {
  if (!items.length) throw new Error("没有可下载的图片");
  const results = await Promise.allSettled(
    items.map(async (item) => {
      const mediaItem = { ...item, kind: "image" as const };
      const response = await fetchCanvasMedia(mediaItem, fetcher);
      const blob = await response.blob();
      return { item: mediaItem, bytes: new Uint8Array(await blob.arrayBuffer()), contentType: blob.type };
    }),
  );
  const failures = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [`${items[index].name || "图片"}（${rejectionMessage(result.reason)}）`]
      : [],
  );
  if (failures.length) throw new Error(`图片下载失败：${failures.join("、")}`);

  const usedNames = new Set<string>();
  const files = results.map((result, index) => {
    if (result.status !== "fulfilled") throw new Error("图片下载失败");
    const fileName = uniqueFileName(result.value.item, index, items.length, result.value.contentType, usedNames);
    return [fileName, result.value.bytes] as const;
  });
  const archive = zipSync(Object.fromEntries(files), { level: 6 });
  return { blob: new Blob([archive], { type: "application/zip" }), fileNames: files.map(([name]) => name) };
}

async function fetchCanvasMedia(item: CanvasMediaDownloadItem, fetcher: typeof fetch) {
  let response: Response;
  try {
    response = await fetcher(item.url, {
      signal: AbortSignal.timeout(item.kind === "video" ? 180_000 : 15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    if (item.kind !== "image" || !/^https?:\/\//i.test(item.url)) throw error;
    const saved = await fetcher("/api/storage/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: [{ url: item.url }] }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!saved.ok) throw new Error(`原图保存失败（HTTP ${saved.status}）`);
    const data = await saved.json();
    const localUrl = data.images?.[0]?.url;
    if (typeof localUrl !== "string" || !localUrl.startsWith("/api/storage/file?")) {
      throw new Error("外链原图无法取回，请稍后重试或重新导入原图");
    }
    response = await fetcher(localUrl, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }
  return response;
}

async function pushResponseToZip(file: ZipPassThrough, response: Response) {
  if (!response.body) {
    file.push(new Uint8Array(await response.arrayBuffer()), true);
    return;
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        file.push(new Uint8Array(0), true);
        return;
      }
      file.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function createCanvasMediaZip(
  items: CanvasMediaDownloadItem[],
  fetcher: typeof fetch = fetch,
): Promise<CanvasImageZip> {
  if (!items.length) throw new Error("没有可下载的素材");
  if (items.every((item) => item.kind === "image")) return createCanvasImageZip(items, fetcher);
  const usedNames = new Set<string>();
  const fileNames: string[] = [];
  const failures: string[] = [];
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let resolveArchive!: (blob: Blob) => void;
  let rejectArchive!: (error: unknown) => void;
  const archiveResult = new Promise<Blob>((resolve, reject) => {
    resolveArchive = resolve;
    rejectArchive = reject;
  });
  void archiveResult.catch(() => undefined);
  const archive = new Zip((error, chunk, final) => {
    if (error) {
      rejectArchive(error);
      return;
    }
    const ownedChunk = new Uint8Array(chunk.byteLength);
    ownedChunk.set(chunk);
    chunks.push(ownedChunk);
    if (final) resolveArchive(new Blob(chunks, { type: "application/zip" }));
  });

  for (const [index, item] of items.entries()) {
    try {
      const response = await fetchCanvasMedia(item, fetcher);
      const fileName = uniqueFileName(item, index, items.length, response.headers.get("content-type") || "", usedNames);
      fileNames.push(fileName);
      const file = new ZipPassThrough(fileName);
      archive.add(file);
      await pushResponseToZip(file, response);
    } catch (error) {
      failures.push(`${item.name || (item.kind === "video" ? "视频" : "图片")}（${rejectionMessage(error)}）`);
    }
  }
  if (failures.length) {
    archive.terminate();
    const mediaLabel = items.every((item) => item.kind === "image") ? "图片" : "素材";
    throw new Error(`${mediaLabel}下载失败：${failures.join("、")}`);
  }
  archive.end();
  const blob = await archiveResult;
  return {
    blob,
    fileNames,
  };
}
