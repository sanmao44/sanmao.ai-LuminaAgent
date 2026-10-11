import type { CanvasDocument } from "./types";

export type CanvasGroupShortcutSelection = {
  nodeIds: readonly string[];
  groupId?: string;
};

export type CanvasGroupShortcutAction = "group" | "ungroup";

export function canvasGroupShortcutAction(
  event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "repeat">,
): CanvasGroupShortcutAction | null {
  if (
    event.repeat ||
    !(event.ctrlKey || event.metaKey) ||
    (event.key.toLowerCase() !== "g" && event.code !== "KeyG")
  ) return null;
  return event.shiftKey ? "ungroup" : "group";
}

export function canvasGroupShortcutTarget(
  document: Pick<CanvasDocument, "groups">,
  selection: CanvasGroupShortcutSelection,
) {
  const selectedGroup = document.groups.find((group) => group.id === selection.groupId);
  if (selectedGroup) return selectedGroup.id;
  const selectedNodeIds = new Set(selection.nodeIds);
  const groupsInSelection = new Set(
    document.groups
      .filter((group) => group.nodeIds.some((nodeId) => selectedNodeIds.has(nodeId)))
      .map((group) => group.id),
  );
  return groupsInSelection.size === 1 ? [...groupsInSelection][0] : null;
}
