import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(
  new URL("../app/canvas.css", import.meta.url),
  "utf8",
);

test("processing feedback uses a restrained signal animation", () => {
  const motionStart = styles.lastIndexOf("/* Processing motion refinement");
  assert.ok(motionStart >= 0, "processing motion refinement should be present");
  const motion = styles.slice(motionStart);

  assert.match(motion, /canvas-processing-orbit/);
  assert.match(motion, /canvas-processing-core/);
  assert.match(motion, /canvas-processing-ambient/);
  assert.match(motion, /canvas-processing-edge/);
  assert.ok(
    motion.includes(".canvas-node.status-running::after") &&
      motion.includes("inset:0"),
  );
  assert.match(motion, /legacy pending selector targeted every descendant span/);
  assert.ok(
    motion.includes(".canvas-processing-indicator.compact{") &&
      motion.includes("min-height:72px"),
  );
});
