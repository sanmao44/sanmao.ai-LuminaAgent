import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);

test("canvas node quick toolbar is shown only after a confirmed click", () => {
  assert.match(
    component,
    /const \[quickToolbarNodeId, setQuickToolbarNodeId\] = useState<string \| null>\(\s*null,?\s*\)/,
  );

  const startNodeDrag = component.slice(
    component.indexOf("const startNodeDrag = useCallback"),
    component.indexOf("const startGroupDrag = useCallback"),
  );
  assert.match(startNodeDrag, /setQuickToolbarNodeId\(null\)/);

  const nodePressPromotion = component.slice(
    component.indexOf("const moveInteraction = useCallback"),
    component.indexOf("const finishInteraction = useCallback"),
  );
  assert.match(nodePressPromotion, /setQuickToolbarNodeId\(null\)/);

  const finishInteraction = component.slice(
    component.indexOf("const finishInteraction = useCallback"),
    component.indexOf("const cancelPointerInteraction = useCallback"),
  );
  const finishNodePress = finishInteraction.slice(
    finishInteraction.indexOf('if (interaction.kind === "nodePress")'),
    finishInteraction.indexOf('if (interaction.kind === "marquee")'),
  );
  assert.match(
    finishNodePress,
    /if \(interaction\.doubleClick\)[\s\S]*?else \{[\s\S]*?setQuickToolbarNodeId\(node\.id\)/,
  );

  assert.match(
    component,
    /selectedSingle &&\s*quickToolbarNodeId === selectedSingle\.id &&\s*!nodeGestureActive/,
  );
});
