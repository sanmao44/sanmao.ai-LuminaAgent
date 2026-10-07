import { compressReferenceDataUrl, optimizeCanvasUploadFile } from "../canvas/api";
import type { ChatFile } from "../client-history";
import type { CreativeReference } from "../creative-references";

export type AgentAttachmentTarget = "agent" | "generate" | "angle";
export type AttachmentIdFactory = (prefix: string) => string;

type CreativeReferenceFileOptions = {
  compressForChat?: boolean;
  target?: AgentAttachmentTarget;
  createId: AttachmentIdFactory;
};

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "csv", "tsv", "html", "htm", "css",
  "js", "jsx", "ts", "tsx", "py", "java", "sql", "xml", "svg", "yaml",
  "yml", "sh", "ps1",
]);
const BINARY_ATTACHMENT_EXTENSIONS = new Set(["docx", "xlsx", "pptx", "pdf"]);
const BINARY_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

async function fileToMediaReference(
  file: File,
  options: CreativeReferenceFileOptions,
) {
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
    throw new Error("只能上传图片或视频文件");
  }
  const prepared = file.type.startsWith("image/")
    ? await optimizeCanvasUploadFile(file)
    : { file, changed: false, originalSize: file.size, uploadedSize: file.size };
  const sourceFile = prepared.file;
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(file.type.startsWith("video/") ? "读取视频失败" : "读取图片失败"));
    reader.readAsDataURL(sourceFile);
  });
  const dataUrl = options.compressForChat && file.type.startsWith("image/")
    ? await compressReferenceDataUrl(rawDataUrl)
    : rawDataUrl;
  return {
    id: options.createId("ref"),
    kind: file.type.startsWith("video/") ? "video" as const : "image" as const,
    name: file.name || (file.type.startsWith("video/") ? "参考视频" : "参考图"),
    url: dataUrl,
    dataUrl,
    mimeType: file.type || undefined,
    optimized: prepared.changed,
    originalSize: prepared.originalSize,
    uploadedSize: prepared.uploadedSize,
  } satisfies CreativeReference & {
    dataUrl: string;
    optimized: boolean;
    originalSize: number;
    uploadedSize: number;
  };
}

async function binaryAttachmentToChatFile(
  file: File,
  extension: string,
  createId: AttachmentIdFactory,
) {
  if (!file.size) throw new Error(`${file.name} 是空文件，没有可读取的内容`);
  if (file.size > BINARY_ATTACHMENT_MAX_BYTES) throw new Error(`${file.name} 超过 20MB，请拆分后上传`);
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/attachments/extract", {
    method: "POST",
    body: form,
  });
  const data = await response.json().catch(() => null) as { text?: unknown; error?: unknown; truncated?: unknown } | null;
  const content = typeof data?.text === "string" ? data.text : "";
  if (!response.ok || !content.trim()) {
    throw new Error(typeof data?.error === "string" ? data.error : `${file.name} 没有可读取的文字内容`);
  }
  return {
    id: createId("file"),
    name: file.name || `附件.${extension}`,
    mimeType: "text/plain;charset=utf-8",
    content,
    encoding: "utf8" as const,
    size: new TextEncoder().encode(content).length,
    sourceSize: file.size,
    truncated: Boolean(data?.truncated),
  } satisfies ChatFile & { sourceSize: number; truncated: boolean };
}

export async function readAgentChatFile(file: File, createId: AttachmentIdFactory) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (BINARY_ATTACHMENT_EXTENSIONS.has(extension)) {
    return binaryAttachmentToChatFile(file, extension, createId);
  }
  if (!file.type.startsWith("text/") && !TEXT_ATTACHMENT_EXTENSIONS.has(extension) && ![
    "application/json", "application/xml", "image/svg+xml",
  ].includes(file.type)) {
    throw new Error(`${file.name} 暂不支持直接分析；Word/Excel/PPT/PDF 请上传 .docx、.xlsx、.pptx、.pdf，其它内容请转换为 TXT、Markdown、JSON 或 CSV`);
  }
  if (file.size > 2 * 1024 * 1024) throw new Error(`${file.name} 超过 2MB，请先拆分文件`);
  const content = await file.text();
  if (!content.trim()) throw new Error(`${file.name} 没有可读取的文字内容`);
  return {
    id: createId("file"),
    name: file.name || "上传文件.txt",
    mimeType: file.type || "text/plain;charset=utf-8",
    content,
    encoding: "utf8" as const,
    size: file.size,
  } satisfies ChatFile;
}

export function chatFileToCreativeReference(file: ChatFile, createId: AttachmentIdFactory) {
  return {
    id: file.id || createId("ref"),
    kind: "text" as const,
    name: file.name || "文本附件",
    text: file.content,
    mimeType: file.mimeType || "text/plain;charset=utf-8",
  } satisfies CreativeReference;
}

export async function createCreativeReferenceFromFile(
  file: File,
  options: CreativeReferenceFileOptions,
) {
  if (options.target === "angle" && !file.type.startsWith("image/")) {
    throw new Error("角度控制台只接受图片参考");
  }
  if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
    return fileToMediaReference(file, options);
  }
  return chatFileToCreativeReference(await readAgentChatFile(file, options.createId), options.createId);
}
