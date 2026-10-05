import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTsRequire } from "./ts-require.mjs";

const MessageReferencePreviewModal = createTsRequire(new URL("../components", import.meta.url).pathname)("./MessageReferencePreviewModal").default;
const Icon = ({ name, size }) => createElement("i", { "data-icon": name, "data-size": size });

test("renders an image reference preview with close actions", () => {
  const markup = renderToStaticMarkup(createElement(MessageReferencePreviewModal, {
    preview: { name: "reference.png", kind: "image", url: "blob:reference" },
    Icon,
    onClose: () => {},
  }));
  assert.match(markup, /class="reference-preview-backdrop"/);
  assert.match(markup, /role="?dialog"?/);
  assert.match(markup, /src="blob:reference"/);
  assert.match(markup, /alt="reference.png"/);
  assert.match(markup, /data-icon="close"/);
});

test("renders video and text references through the same presentation boundary", () => {
  const video = renderToStaticMarkup(createElement(MessageReferencePreviewModal, {
    preview: { name: "clip.mp4", kind: "video", url: "blob:clip" },
    Icon,
    onClose: () => {},
  }));
  const text = renderToStaticMarkup(createElement(MessageReferencePreviewModal, {
    preview: { name: "notes.txt", kind: "text", text: "hello" },
    Icon,
    onClose: () => {},
  }));
  assert.match(video, /<video[^>]+src="blob:clip"/);
  assert.match(video, /controls/);
  assert.match(text, /<pre>hello<\/pre>/);
  assert.match(text, /reference-preview-footer/);
});
