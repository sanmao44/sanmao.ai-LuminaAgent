import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const canvasModules = createTsRequire(new URL("../", import.meta.url).pathname);
const CanvasMinimap = canvasModules(
  "./components/canvas/CanvasMinimap",
).default;
const CanvasFitButton = canvasModules(
  "./components/canvas/CanvasMinimap",
).CanvasFitButton;

test("collapsed navigation retains a visible fit-all action", () => {
  const markup = renderToStaticMarkup(createElement(CanvasMinimap, {
    document: {
      nodes: [],
      edges: [],
      groups: [],
      camera: { x: -120_000, y: 80_000, zoom: 0.12 },
    },
    connectionStyle: "bezier",
    selectedIds: new Set(),
    bounds: { x: -100, y: -100, w: 200, h: 200 },
    stageSize: { width: 1200, height: 760 },
    zoomAt: () => {},
    fitView: () => {},
    onNavigate: () => {},
    onMoveNodes: () => {},
    nodeLabel: (node) => node.id,
  }));

  assert.match(markup, /class="canvas-minimap-fit canvas-minimap-fit-compact"/u);
  assert.match(markup, /aria-label="适应全部画布内容"/u);
});

test("narrow-screen fit action names and describes its camera reset", () => {
  const markup = renderToStaticMarkup(createElement(CanvasFitButton, {
    className: "canvas-minimap-fit canvas-minimap-fit-mobile",
    onFit: () => {},
  }));

  assert.match(markup, /class="canvas-minimap-fit canvas-minimap-fit-mobile"/u);
  assert.match(markup, /aria-label="适应全部画布内容"/u);
  assert.match(markup, /title="将所有画布内容适应到视口"/u);
});

test("fit-all action invokes the supplied camera command without starting canvas interaction", () => {
  let fitCount = 0;
  let propagationStopped = false;
  const button = CanvasFitButton({
    className: "canvas-minimap-fit canvas-minimap-fit-mobile",
    onFit: () => { fitCount += 1; },
  });

  button.props.onClick({ stopPropagation: () => { propagationStopped = true; } });

  assert.equal(fitCount, 1);
  assert.equal(propagationStopped, true);
});
