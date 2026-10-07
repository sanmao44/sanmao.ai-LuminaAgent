import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTsRequire } from "./ts-require.mjs";

const AssistantMarkdown = createTsRequire(new URL("..", import.meta.url).pathname)("./components/AssistantMarkdown").default;
const Icon = ({ name }) => createElement("i", { "data-icon": name });

test("assistant markdown renders headings, lists, links and block code", () => {
  const markup = renderToStaticMarkup(createElement(AssistantMarkdown, {
    content: "# Title\n\nA **bold** note with [link](https://example.com).\n\n- one\n- two\n\n```js\nconst answer = 42;\n```",
    Icon,
    onNotify: () => {},
  }));
  assert.match(markup, /<h1>Title<\/h1>/);
  assert.match(markup, /<strong>bold<\/strong>/);
  assert.match(markup, /href="https:\/\/example.com"/);
  assert.match(markup, /<ul>/);
  assert.match(markup, /assistant-code-block/);
});

test("assistant markdown inserts direction actions at the response boundary", () => {
  const markup = renderToStaticMarkup(createElement(AssistantMarkdown, {
    content: "### ??????\n\n1. ????",
    Icon,
    onNotify: () => {},
    directionPicker: { kind: "chat", directions: ["????"], disabled: false, onSelect: () => {} },
  }));
  assert.match(markup, /chat-direction-section/);
  assert.match(markup, /agent-direction-option/);
  assert.match(markup, /aria-label="[^"]+"/);
});
