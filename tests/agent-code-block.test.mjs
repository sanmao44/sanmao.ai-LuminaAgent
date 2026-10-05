import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTsRequire } from "./ts-require.mjs";

const AssistantCodeBlock = createTsRequire(new URL("..", import.meta.url).pathname)("./components/AssistantCodeBlock").default;
const Icon = ({ name }) => createElement("i", { "data-icon": name });

test("code blocks render language, numbered lines, highlighting and actions", () => {
  const markup = renderToStaticMarkup(createElement(AssistantCodeBlock, { language: "typescript", code: "const answer = 42;\nreturn answer;", Icon, onNotify: () => {} }));
  assert.match(markup, /class="assistant-code-block/);
  assert.match(markup, />typescript<\/span>/);
  assert.match(markup, /assistant-code-number/);
  assert.match(markup, /code-token-keyword/);
  assert.match(markup, /data-icon="download"/);
  assert.match(markup, />??<\/button>/);
  assert.match(markup, />??<\/button>/);
});

test("only executable markup languages expose the run action", () => {
  const html = renderToStaticMarkup(createElement(AssistantCodeBlock, { language: "html", code: "<h1>Hi</h1>", Icon, onNotify: () => {} }));
  const python = renderToStaticMarkup(createElement(AssistantCodeBlock, { language: "python", code: "print(1)", Icon, onNotify: () => {} }));
  assert.match(html, /code-run-symbol/);
  assert.doesNotMatch(python, /code-run-symbol/);
});
