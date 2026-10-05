import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const preview = createTsRequire(new URL("../lib", import.meta.url).pathname)("./chat-file-preview");

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("recognizes only the requested HTML preview types", () => {
  assert.equal(preview.isPreviewableChatFile({ name: "page.html", mimeType: "text/html" }), true);
  assert.equal(preview.isPreviewableChatFile({ name: "page.htm", mimeType: "text/plain" }), true);
  assert.equal(preview.isPreviewableChatFile({ name: "data.json", mimeType: "application/json" }), false);
  assert.equal(preview.isPreviewableChatFile({ name: "rows.csv", mimeType: "text/csv" }), false);
  assert.equal(preview.isPreviewableChatFile({ name: "notes.txt", mimeType: "text/plain" }), false);
});

test("adds preview only when ChatFileList receives a preview handler", () => {
  assert.match(page, /function ChatFileList\(\{ files, onDownload, onPreview, onRemove \}\)/);
  assert.match(page, /AgentChatFileList/);
  assert.match(page, /isPreviewable: isPreviewableChatFile/);

  const assistantFiles = page.slice(page.indexOf("message.files?.length ? /*#__PURE__*/ _jsx(ChatFileList"));
  assert.match(assistantFiles, /onPreview: message\.role === 'assistant' \? openChatFilePreview : undefined/);

  const composerFiles = page.slice(page.indexOf("agentFiles.length > 0 && /*#__PURE__*/ _jsx(ChatFileList"));
  assert.doesNotMatch(composerFiles.slice(0, composerFiles.indexOf("agentFollowUp")), /onPreview: openChatFilePreview/);
});

test("renders HTML through srcDoc in a script-sandboxed iframe", () => {
  const dialog = functionBody(page, "ChatFilePreviewDialog");
  assert.match(dialog, /role: "dialog"/);
  assert.match(dialog, /"aria-modal": "true"/);
  assert.match(dialog, /srcDoc: file\.content/);
  assert.match(dialog, /URL\.createObjectURL\(new Blob/);
  assert.match(dialog, /src: previewUrl \|\| undefined/);
  assert.match(dialog, /sandbox: "allow-scripts"/);
  assert.doesNotMatch(dialog, /allow-same-origin/);
  assert.match(preview.getChatFilePreviewContent({ encoding: "base64", content: "aGVsbG8=" }), /hello/);
  assert.match(dialog, /allow: "autoplay; fullscreen"/);
  assert.match(preview.buildChatFilePreviewContent("<html><head></head><body></body></html>"), /data-sanmao-preview-motion/);
  assert.match(preview.buildChatFilePreviewContent("prefers-reduced-motion: reduce"), /prefers-reduced-motion: no-preference/);
  assert.match(page, /buildChatFilePreviewContent\(getChatFilePreviewContent\(file\)\)/);
});

test("keeps the download path and provides multiple close paths", () => {
  const download = functionBody(page, "downloadChatFile");
  assert.match(download, /new Blob/);
  assert.match(download, /anchor\.download = file\.name/);
  assert.match(download, /anchor\.click\(\)/);
  assert.match(page, /className: "chat-file-preview-close"[\s\S]*?onClick: onClose/);
  assert.match(page, /if \(event\.target === event\.currentTarget\) onClose\(\)/);
  assert.match(page, /if \(event\.key === 'Escape'\) setChatFilePreview\(null\)/);
  assert.match(styles, /\.chat-file-preview-backdrop\{position:fixed;inset:0/);
  assert.match(styles, /\.chat-file-preview-frame\{display:block;width:100%;height:100%/);
  assert.match(styles, /@media\(max-width:780px\)\{\.chat-file-preview-backdrop\{padding:0\}/);
});
