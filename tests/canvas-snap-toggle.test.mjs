import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../app/canvas.css", import.meta.url),
  "utf8",
);

test("canvas exposes a visible node-snap toggle with an accessible state", () => {
  assert.match(component, /const \[snapEnabled, setSnapEnabled\] = useState\(true\)/);
  assert.match(component, /className=\{`canvas-soft-button canvas-snap-button \$\{snapEnabled \? "active" : ""\}`\}/);
  assert.match(component, /aria-pressed=\{snapEnabled\}/);
  assert.match(component, /节点吸附\$\{snapEnabled \? "已开启" : "已关闭"\}/);
  assert.match(component, /吸附 \{snapEnabled \? "开" : "关"\}/);
  assert.match(component, /onClick=\{toggleSnap\}/);
});

test("turning off node snap bypasses alignment while retaining the normal drag path", () => {
  assert.match(component, /const snapResult = snapEnabled\s*\n\s*\? snapCanvasNodePositions\(/);
  assert.match(component, /: \{ positions: proposedPositions, guides: \[\] as CanvasSnapGuide\[\] \}/);
  assert.match(component, /JSON\.stringify\(\{ connectionStyle, snapEnabled \}\)/);
  assert.match(styles, /\.canvas-snap-button\.active\{/);
  assert.match(styles, /\.canvas-snap-button:not\(\.active\)/);
});
