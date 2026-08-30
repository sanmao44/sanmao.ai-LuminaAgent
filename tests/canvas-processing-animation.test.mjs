import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(
  new URL("../app/canvas.css", import.meta.url),
  "utf8",
);
const component = await readFile(
  new URL(
    "../components/canvas/CanvasProcessingIndicator.tsx",
    import.meta.url,
  ),
  "utf8",
);
const canvas = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);

test("processing feedback uses one restrained signal animation system", () => {
  const motionStart = styles.lastIndexOf("/* Unified processing system");
  assert.ok(motionStart >= 0, "unified processing motion should be present");
  const motion = styles.slice(motionStart);

  assert.match(motion, /canvas-processing-orbit/);
  assert.match(motion, /canvas-processing-signal/);
  assert.match(motion, /canvas-processing-indeterminate/);
  assert.match(motion, /canvas-processing-node-signal/);
  assert.match(motion, /canvas-processing-edge/);
  assert.ok(
    motion.includes(".canvas-node.status-running::after") &&
      motion.includes("inset:0"),
  );
  assert.ok(
    motion.includes(".canvas-processing-indicator.compact{") &&
      motion.includes("min-height:78px"),
  );
  assert.equal(
    (styles.match(/(?:^|\n)\.canvas-processing-indicator\{/g) || []).length,
    1,
    "processing styles should not be duplicated later in the cascade",
  );
  assert.match(motion, /prefers-reduced-motion:reduce/);
});

test("all running canvas node kinds share the indicator and elapsed clock", () => {
  for (const kind of ["image", "video", "agent", "generator", "upscale"])
    assert.match(component, new RegExp(`\\| "${kind}"|kind === "${kind}"`));

  assert.match(component, /useSyncExternalStore/);
  assert.match(component, /visibilitychange/);
  assert.match(component, /formatProcessingTime/);
  assert.match(component, /className="canvas-processing-elapsed"/);
  assert.match(component, /canvas-processing-progress.*indeterminate/);
  assert.match(canvas, /kind={processingKind}/);
  assert.equal(
    (canvas.match(/<CanvasProcessingIndicator/g) || []).length,
    4,
    "media, upscale, Agent and generator nodes should use the shared indicator",
  );
});
