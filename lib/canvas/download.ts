import { zipSync } from "fflate";

export type CanvasImageDownloadItem = {
  id: string;
  name?: string;
  url: string;
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
  "image/webp": "webp",
};

const SAFE_EXTENSION = /^(?:avif|gif|jpe?g|png|webp)$/i;

export function orderCanvasImageItems(
  items: CanvasImageDownloadItem[],
  selectedIds: Iterable<string>,
) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return [...selectedIds]
    .map((id) => byId.get(id))
    .filter((item): item is CanvasImageDownloadItem => Boolean(item));
}

function safeStem(name: string | undefined) {
  const normalized = String(name || "SANMAO素材")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 96)
    .trim();
  return (normalized || "SANMAO素材").replace(/\.(?:avif|gif|jpe?g|png|webp)$/i, "");
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

function uniqueFileName(item: CanvasImageDownloadItem, index: number, total: number, contentType: string, used: Set<string>) {
  const prefix = String(index + 1).padStart(Math.max(2, String(total).length), "0");
  const extension = imageExtension(item, contentType);
  const stem = safeStem(item.name);
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
      const response = await fetcher(item.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      return {
        item,
        bytes: new Uint8Array(await blob.arrayBuffer()),
        contentType: blob.type,
      };
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
    const fileName = uniqueFileName(
      result.value.item,
      index,
      items.length,
      result.value.contentType,
      usedNames,
    );
    return [fileName, result.value.bytes] as const;
  });
  const archive = zipSync(Object.fromEntries(files), { level: 6 });
  return {
    blob: new Blob([archive], { type: "application/zip" }),
    fileNames: files.map(([fileName]) => fileName),
  };
}
