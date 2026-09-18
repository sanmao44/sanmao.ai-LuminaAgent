import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);

function sliceBetween(startMarker, endMarker) {
  const start = component.indexOf(startMarker);
  const end = component.indexOf(endMarker);
  assert.notEqual(start, -1, `找不到 ${startMarker}`);
  assert.notEqual(end, -1, `找不到 ${endMarker}`);
  return component.slice(start, end);
}

test("Ctrl+Shift+G dissolves the group behind the current selection", () => {
  const breakGroup = sliceBetween(
    "const breakGroup = useCallback",
    "const removeNodeFromGroup = useCallback",
  );

  // 框选 / Shift 追加选择会清空 selectedGroupId，所以解组必须能按选中范围反推分组。
  assert.match(breakGroup, /groupForNode\(docRef\.current, nodeId\)/);
  assert.match(breakGroup, /groupsInSelection\.size === 1/);
  assert.match(breakGroup, /groupById\(docRef\.current, candidate\)/);
  // 没有可解散的分组时给出提示，而不是静默什么都不做。
  assert.match(breakGroup, /notify\("请先选中一个对象组再解散。", "error"\)/);
  assert.match(breakGroup, /\[clearSelection, commit, notify, selectedGroupId, selectedIds\]/);
});

test("marquee and Shift selection still clear selectedGroupId", () => {
  const selectNode = sliceBetween(
    "const selectNode = useCallback",
    "const startNodeDrag = useCallback",
  );
  assert.match(selectNode, /setSelectedGroupId\(additive \? null : group\.id\)/);

  const finishInteraction = sliceBetween(
    "const finishInteraction = useCallback",
    "const cancelPointerInteraction = useCallback",
  );
  assert.match(finishInteraction, /setSelectedGroupId\(null\)/);
});
