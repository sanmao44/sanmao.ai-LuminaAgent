"use client";

import { useMemo, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { groupBounds, isCanvasReferenceableNode, nodeById } from "@/lib/canvas/model";
import { canvasNodePaintZIndex } from "@/lib/canvas/layers";
import type { CanvasDocument, CanvasGroup } from "@/lib/canvas/types";
import CanvasInlineNameEditor from "@/components/canvas/CanvasInlineNameEditor";

type Props = {
  document: CanvasDocument;
  groups: readonly CanvasGroup[];
  zoom: number;
  selectedGroupId: string | null;
  draggingNodeIds: ReadonlySet<string>;
  cursorTask: string;
  composingGroupId: string | null;
  onGroupPointerDown: (event: ReactPointerEvent, group: CanvasGroup) => void;
  onComposeGroup: (groupId: string) => void;
  renamingGroupId?: string | null;
  onRename?: (group: CanvasGroup, name: string) => void;
  onRenamingChange?: (group: CanvasGroup, editing: boolean) => void;
};

/** Paints identity above member cards while leaving group frames below nodes. */
export default function CanvasGroupLabelLayer({
  document, groups, zoom, selectedGroupId, draggingNodeIds, cursorTask,
  composingGroupId, onGroupPointerDown, onComposeGroup, renamingGroupId,
  onRename, onRenamingChange,
}: Props) {
  const availableImageCountByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of document.groups) {
      counts.set(group.id, group.nodeIds.filter((id) => {
        const node = nodeById(document, id);
        return Boolean(node && isCanvasReferenceableNode(node) && node.data.kind === "image" && node.data.url);
      }).length);
    }
    return counts;
  }, [document]);

  return (
    <div className="canvas-group-label-layer">
      {groups.map((group) => {
        const bounds = groupBounds(document, group.id);
        const availableImageCount = availableImageCountByGroup.get(group.id) || 0;
        const composing = composingGroupId === group.id;
        const groupInteraction = selectedGroupId === group.id && group.nodeIds.length > 0 && group.nodeIds.every((id) => draggingNodeIds.has(id)) && draggingNodeIds.size > 0 && (cursorTask === "dragging" || cursorTask === "resizing");
        const zIndex = Math.max(0, ...group.nodeIds.map((id) => {
          const node = nodeById(document, id);
          return node ? canvasNodePaintZIndex(document, node, groupInteraction) : 0;
        })) + 2;
        return (
          <div
            key={group.id}
            className="canvas-group-label canvas-group-world-label"
            data-canvas-group-label="true"
            data-canvas-group-id={group.id}
            data-canvas-group-label-id={group.id}
            style={{ left: bounds.x + 13, top: bounds.y + 11, zIndex, "--canvas-group-color": group.color || "var(--accent)", "--group-color": group.color || "var(--accent)", "--canvas-name-inverse-zoom": 1 / Math.max(zoom, 0.04) } as CSSProperties}
            onPointerDown={(event) => onGroupPointerDown(event, group)}
          >
            <button type="button" className={`canvas-group-compose ${composing ? "composing" : ""}`} disabled={availableImageCount < 2 || Boolean(composingGroupId)} aria-label={availableImageCount >= 2 ? `宫格拼接组内 ${availableImageCount} 张图片` : "组内至少需要 2 张可用图片才能宫格拼接"} title={availableImageCount >= 2 ? `宫格拼接组内 ${availableImageCount} 张图片` : "组内至少需要 2 张可用图片才能宫格拼接"} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onComposeGroup(group.id); }}>{composing ? "…" : "▦"}</button>
            <span className="canvas-group-color-mark" aria-hidden="true" title={group.color ? `组颜色 ${group.color}` : "主题默认组颜色"} />
            <span aria-hidden="true">⌘</span>
            <CanvasInlineNameEditor value={group.name} fallback={group.name} ariaLabel="对象组名称" editing={renamingGroupId === group.id} onEditingChange={(editing) => onRenamingChange?.(group, editing)} onCommit={(name) => onRename?.(group, name)} className="canvas-group-name" inputClassName="canvas-group-name-input" style={{ "--canvas-name-inverse-zoom": 1 / Math.max(zoom, 0.04) } as CSSProperties} />
            <small>{group.nodeIds.length} 个对象</small>
          </div>
        );
      })}
    </div>
  );
}
