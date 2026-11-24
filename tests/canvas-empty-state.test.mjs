import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const canvasModules = createTsRequire(process.cwd());
const CanvasEmptyState = canvasModules("./components/canvas/CanvasEmptyState").default;

function findButtons(node, result = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => findButtons(child, result));
  } else if (node && typeof node === "object" && "type" in node) {
    if (node.type === "button") result.push(node);
    findButtons(node.props?.children, result);
  }
  return result;
}

test("empty canvas guidance is absent once the canvas has content", () => {
  const markup = renderToStaticMarkup(createElement(CanvasEmptyState, {
    visible: false,
    onImport: () => {},
    onOpenCreateMenu: () => {},
    onAskAgent: () => {},
  }));

  assert.equal(markup, "");
});

test("empty canvas guidance exposes accessible import, create, and Agent actions", () => {
  const markup = renderToStaticMarkup(createElement(CanvasEmptyState, {
    visible: true,
    onImport: () => {},
    onOpenCreateMenu: () => {},
    onAskAgent: () => {},
  }));

  assert.match(markup, /role="region" aria-labelledby="canvas-empty-state-title"/u);
  assert.match(markup, /从一个节点开始/u);
  assert.match(markup, /导入素材/u);
  assert.match(markup, /创建节点/u);
  assert.match(markup, /让 Agent 起稿/u);
});

test("empty canvas actions stop stage clicks and invoke their existing callbacks", () => {
  const calls = [];
  let stopped = 0;
  const tree = CanvasEmptyState({
    visible: true,
    onImport: () => calls.push(["import"]),
    onOpenCreateMenu: (clientX, clientY) => calls.push(["create", clientX, clientY]),
    onAskAgent: () => calls.push(["agent"]),
  });
  const buttons = findButtons(tree);
  const event = (clientX, clientY) => ({
    clientX,
    clientY,
    stopPropagation: () => { stopped += 1; },
  });

  assert.equal(buttons.length, 3);
  buttons[0].props.onClick(event(120, 220));
  buttons[1].props.onClick(event(240, 360));
  buttons[2].props.onClick(event(420, 520));

  assert.deepEqual(calls, [["import"], ["create", 240, 360], ["agent"]]);
  assert.equal(stopped, 3);
});
