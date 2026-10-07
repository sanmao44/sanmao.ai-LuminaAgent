import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTsRequire } from "./ts-require.mjs";

const CompareViewer = createTsRequire(new URL("..", import.meta.url).pathname)("./components/CompareViewer").default;
const Icon = ({ name }) => createElement("i", { "data-icon": name });
const item = { id: "current", url: "blob:current", prompt: "current prompt", modelName: "model", createdAt: 1 };
const parent = { id: "parent", url: "blob:parent", prompt: "parent prompt", createdAt: 0 };

test("compare viewer renders both compare modes and zoom controls", () => {
  const markup = renderToStaticMarkup(createElement(CompareViewer, { item, parent, Icon, onClose: () => {} }));
  assert.match(markup, /class="compare-viewer"/);
  assert.match(markup, /blob:parent/);
  assert.match(markup, /blob:current/);
  assert.match(markup, /aria-label="[^"]+"/);
  assert.match(markup, /class="compare-divider"/);
  assert.match(markup, /data-icon="zoomOut"/);
  assert.match(markup, /data-icon="zoomIn"/);
});

test("compare viewer preserves reference source labeling", () => {
  const markup = renderToStaticMarkup(createElement(CompareViewer, {
    item,
    parent,
    source: { item: { ...parent, id: "reference-1", url: "blob:reference", prompt: "reference prompt" }, kind: "reference", label: "reference" },
    Icon,
    onClose: () => {},
  }));
  assert.match(markup, /blob:reference/);
  assert.match(markup, /reference/);
});
