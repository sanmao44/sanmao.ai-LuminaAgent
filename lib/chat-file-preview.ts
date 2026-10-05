import type { ChatFile } from "./client-history";

const OFFICE_ARTIFACT_PATTERN = /\.(docx|xlsx|pptx|zip)$/;

export function isPreviewableChatFile(file: ChatFile | null | undefined) {
  const mimeType = String(file?.mimeType || "").split(";", 1)[0].trim().toLowerCase();
  const name = String(file?.name || "").trim().toLowerCase();
  if (mimeType === "text/html" || mimeType === "application/xhtml+xml" || name.endsWith(".html") || name.endsWith(".htm")) return true;
  return isOfficeArtifactChatFile(file);
}

export function chatFilePreviewKindLabel(file: ChatFile | null | undefined) {
  const name = String(file?.name || "").trim().toLowerCase();
  if (name.endsWith(".docx")) return "Word 预览";
  if (name.endsWith(".xlsx")) return "Excel 预览";
  if (name.endsWith(".pptx")) return "PPT 预览";
  if (name.endsWith(".zip")) return "压缩包预览";
  return "HTML 预览";
}

export function isOfficeArtifactChatFile(file: ChatFile | null | undefined) {
  const name = String(file?.name || "").trim().toLowerCase();
  return typeof file?.artifactId === "string" && file.artifactId.trim().length > 0 && OFFICE_ARTIFACT_PATTERN.test(name);
}

export function getChatFilePreviewContent(file: ChatFile | null | undefined) {
  if (file?.encoding !== "base64") return String(file?.content || "");
  const binary = atob(String(file?.content || "").replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("gb18030").decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

export function buildChatFilePreviewContent(content: unknown) {
  const source = String(content || "").replace(/prefers-reduced-motion\s*:\s*reduce/gi, "prefers-reduced-motion: no-preference");
  const bootstrap = "<script data-sanmao-preview-motion>(function(){try{var nativeMatchMedia=window.matchMedia&&window.matchMedia.bind(window);window.matchMedia=function(query){var text=String(query);if(/prefers-reduced-motion/i.test(text))return{media:text,matches:false,onchange:null,addListener:function(){},removeListener:function(){},addEventListener:function(){},removeEventListener:function(){},dispatchEvent:function(){return false}};return nativeMatchMedia?nativeMatchMedia(text):{media:text,matches:false,onchange:null,addListener:function(){},removeListener:function(){},addEventListener:function(){},removeEventListener:function(){},dispatchEvent:function(){return false}}};}catch(e){}})();</script>";
  const head = source.match(/<head\b[^>]*>/i);
  if (head) return source.replace(head[0], `${head[0]}${bootstrap}`);
  const doctype = source.match(/^\s*<!doctype\b[^>]*>\s*/i);
  if (doctype) return `${doctype[0]}${bootstrap}${source.slice(doctype[0].length)}`;
  return `${bootstrap}${source}`;
}

export function formatFileSize(size?: number) {
  if (!size || size < 1) return "文件";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function chatFileTypeLabel(file: ChatFile | null | undefined) {
  const match = String(file?.name || "").toLowerCase().match(/\.(docx|xlsx|pptx|pdf|zip)$/);
  return match ? `${match[1].toUpperCase()} 文件 ` : "";
}
