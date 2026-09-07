import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("recognizes only the requested HTML preview types", () => {
  const detector = functionBody(page, "isPreviewableChatFile");
  assert.match(detector, /mimeType === 'text\/html'/);
  assert.match(detector, /mimeType === 'application\/xhtml\+xml'/);
  assert.match(detector, /name\.endsWith\('\.html'\)/);
  assert.match(detector, /name\.endsWith\('\.htm'\)/);
  assert.doesNotMatch(detector, /\.json|\.csv|\.txt/);
});

test("adds preview only when ChatFileList receives a preview handler", () => {
  assert.match(page, /function ChatFileList\(\{ files, onDownload, onPreview, onRemove \}\)/);
  assert.match(page, /className: "message-file-actions"/);
  assert.match(page, /name: "preview"/);
  assert.match(page, /onPreview && isPreviewableChatFile\(file\)/);
  assert.match(page, /onClick: \(\)=>onPreview\(file\)/);

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
  assert.match(dialog, /sandbox: "allow-scripts"/);
  assert.doesNotMatch(dialog, /allow-same-origin/);
  assert.match(page, /new TextDecoder\('utf-8', \{ fatal: true \}\)\.decode\(bytes\)/);
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
