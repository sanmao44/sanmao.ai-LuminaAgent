import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTsRequire } from "./ts-require.mjs";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const dialogSource = await readFile(new URL("../components/ChatFilePreviewDialog.tsx", import.meta.url), "utf8");
const preview = createTsRequire(new URL("../lib", import.meta.url).pathname)("./chat-file-preview");
const downloadChatFile = createTsRequire(new URL("../lib", import.meta.url).pathname)("./agent/chat-file-download").downloadChatFile;
const ChatFilePreviewDialog = createTsRequire(new URL("../components", import.meta.url).pathname)("./ChatFilePreviewDialog").default;

test("recognizes only the requested HTML preview types", () => {
  assert.equal(preview.isPreviewableChatFile({ name: "page.html", mimeType: "text/html" }), true);
  assert.equal(preview.isPreviewableChatFile({ name: "page.htm", mimeType: "text/plain" }), true);
  assert.equal(preview.isPreviewableChatFile({ name: "data.json", mimeType: "application/json" }), false);
  assert.equal(preview.isPreviewableChatFile({ name: "rows.csv", mimeType: "text/csv" }), false);
  assert.equal(preview.isPreviewableChatFile({ name: "notes.txt", mimeType: "text/plain" }), false);
});

test("adds preview only when ChatFileList receives a preview handler", () => {
  assert.match(page, /_jsx\(AgentChatFileList, \{/);
  assert.match(page, /isPreviewable: isPreviewableChatFile/);

  const assistantFiles = page.slice(page.indexOf("message.files?.length ? /*#__PURE__*/ _jsx(AgentChatFileList"));
  assert.match(assistantFiles, /onPreview: message\.role === 'assistant' \? openChatFilePreview : undefined/);

  const composerFiles = page.slice(page.indexOf("agentFiles.length > 0 && /*#__PURE__*/ _jsx(AgentChatFileList"));
  assert.doesNotMatch(composerFiles.slice(0, composerFiles.indexOf("agentFollowUp")), /onPreview: openChatFilePreview/);
});

test("renders HTML through srcDoc in a script-sandboxed iframe", () => {
  const markup = renderToStaticMarkup(createElement(ChatFilePreviewDialog, {
    file: { id: "file-1", name: "preview.html", mimeType: "text/html", content: "<h1>Hello</h1>", label: "HTML 预览" },
    Icon: ({ name }) => createElement("i", { "data-icon": name }),
    onClose: () => {},
  }));
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /srcDoc="&lt;h1&gt;Hello&lt;\/h1&gt;"/);
  assert.match(markup, /sandbox="allow-scripts"/);
  assert.doesNotMatch(markup, /allow-same-origin/);
  assert.match(preview.getChatFilePreviewContent({ encoding: "base64", content: "aGVsbG8=" }), /hello/);
  assert.match(markup, /allow="autoplay; fullscreen"/);
  assert.match(preview.buildChatFilePreviewContent("<html><head></head><body></body></html>"), /data-sanmao-preview-motion/);
  assert.match(preview.buildChatFilePreviewContent("prefers-reduced-motion: reduce"), /prefers-reduced-motion: no-preference/);
  assert.match(page, /buildChatFilePreviewContent\(getChatFilePreviewContent\(file\)\)/);
});

test("keeps the download path and provides multiple close paths", () => {
  assert.equal(typeof downloadChatFile, "function");
  const markup = renderToStaticMarkup(createElement(ChatFilePreviewDialog, {
    file: { id: "file-1", name: "preview.html", mimeType: "text/html", content: "<h1>Hello</h1>" },
    Icon: ({ name }) => createElement("i", { "data-icon": name }),
    onClose: () => {},
  }));
  assert.match(markup, /class="chat-file-preview-close"/);
  assert.match(markup, /aria-label="关闭预览"/);
  assert.match(dialogSource, /event\.target === event\.currentTarget/);
  assert.match(page, /if \(event\.key === 'Escape'\) setChatFilePreview\(null\)/);
  assert.match(styles, /\.chat-file-preview-backdrop\{position:fixed;inset:0/);
  assert.match(styles, /\.chat-file-preview-frame\{display:block;width:100%;height:100%/);
  assert.match(styles, /@media\(max-width:780px\)\{\.chat-file-preview-backdrop\{padding:0\}/);
});
