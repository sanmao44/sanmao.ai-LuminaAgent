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
    /if \(interaction\.doubleClick\)[\s\S]*?else if \(!interaction\.shiftKey\)[\s\S]*?setQuickToolbarNodeId\(node\.id\)/,
  );

  assert.match(
    component,
    /selectedSingle &&\s*quickToolbarNodeId === selectedSingle\.id &&\s*!nodeGestureActive/,
  );
});

test("shift-click keeps multi-selection without opening the node editor", () => {
  const startNodeDrag = component.slice(
    component.indexOf("const startNodeDrag = useCallback"),
    component.indexOf("const startGroupDrag = useCallback"),
  );
  assert.match(startNodeDrag, /shiftKey: event\.shiftKey/);

  const finishInteraction = component.slice(
    component.indexOf("const finishInteraction = useCallback"),
    component.indexOf("const cancelPointerInteraction = useCallback"),
  );
  const finishNodePress = finishInteraction.slice(
    finishInteraction.indexOf('if (interaction.kind === "nodePress")'),
    finishInteraction.indexOf('if (interaction.kind === "marquee")'),
  );
  assert.match(finishNodePress, /else if \(!interaction\.shiftKey\)/);
  assert.match(
    finishNodePress,
    /else if \(!interaction\.shiftKey\)[\s\S]*?setQuickToolbarNodeId\(node\.id\)[\s\S]*?setPendingClickNodeId\(node\.id\)/,
  );
});

test("grouped card drag is constrained and never auto-detaches", () => {
  const moveInteraction = component.slice(
    component.indexOf("const moveInteraction = useCallback"),
    component.indexOf("const finishInteraction = useCallback"),
  );
  assert.match(moveInteraction, /clampCanvasNodePositionToGroup/);
  assert.match(moveInteraction, /interaction\.originGroupId && interaction\.originGroupBounds/);

  const finishInteraction = component.slice(
    component.indexOf("const finishInteraction = useCallback"),
    component.indexOf("const cancelPointerInteraction = useCallback"),
  );
  assert.doesNotMatch(finishInteraction, /detachNodesFromGroups/);
  assert.match(finishInteraction, /if \(!interaction\.originGroupId && dropTarget\)/);
});

test("grouped cards keep the existing card context menu entry point", () => {
  const contextHandler = component.slice(
    component.indexOf("const handleContextMenu = useCallback"),
    component.indexOf("const deck = deckSource()"),
  );
  assert.match(contextHandler, /data-canvas-group-id/);
  assert.match(contextHandler, /if \(groupElement && !node && !isolatedTarget\?\.closest\("\.canvas-context-menu"\)\)/);
  assert.match(contextHandler, /event\.preventDefault\(\)[\s\S]*?menu: "node"[\s\S]*?nodeId: groupMember\.id/);
  assert.doesNotMatch(contextHandler, /\.canvas-group,/);
  assert.match(component, /const group = groupForNode\(document, node\.id\);/);
  assert.match(component, /\{group && \([\s\S]*?className="canvas-node-group-remove"/);

  assert.match(component, /label: "下载"/);
  assert.match(component, /label: "加入资产"/);
  assert.match(component, /label: "复制节点"/);
  assert.match(component, /label: "创建副本"/);
  assert.match(component, /label: "置于顶层"/);
  assert.match(component, /label: "置于底层"/);
  assert.match(component, /label: "上移一层"/);
  assert.match(component, /label: "下移一层"/);
});
