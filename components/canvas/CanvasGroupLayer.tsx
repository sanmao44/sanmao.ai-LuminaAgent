"use client";

import { useMemo, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { groupBounds, isCanvasReferenceableNode, nodeById } from "@/lib/canvas/model";
import { canvasGroupPaintZIndex } from "@/lib/canvas/layers";
import type { CanvasDocument, CanvasGroup } from "@/lib/canvas/types";
import CanvasInlineNameEditor from "@/components/canvas/CanvasInlineNameEditor";

type CanvasGroupLayerProps = {
  document: CanvasDocument;
  groups?: readonly CanvasGroup[];
  selectedGroupId: string | null;
  draggingNodeIds: ReadonlySet<string>;
  cursorTask: string;
  composingGroupId: string | null;
  connectionSourceId: string | null;
  connectionTargetId: string | null;
  assetDropGroupId: string | null;
  onGroupPointerDown: (event: ReactPointerEvent, group: CanvasGroup) => void;
  onGroupResize: (event: ReactPointerEvent, group: CanvasGroup) => void;
  onStartConnection: (
    event: ReactPointerEvent,
    id: string,
    port: "left" | "right",
  ) => void;
  onComposeGroup: (groupId: string) => void;
  renderLabels?: boolean;
  renamingGroupId?: string | null;
  onRename?: (group: CanvasGroup, name: string) => void;
  onRenamingChange?: (group: CanvasGroup, editing: boolean) => void;
};

export default function CanvasGroupLayer({
  document,
  groups = document.groups,
  selectedGroupId,
  draggingNodeIds,
  cursorTask,
  composingGroupId,
  connectionSourceId,
  connectionTargetId,
  assetDropGroupId,
  onGroupPointerDown,
  onGroupResize,
  onStartConnection,
  onComposeGroup,
  renderLabels = true,
  renamingGroupId,
  onRename,
  onRenamingChange,
}: CanvasGroupLayerProps) {
  const groupMetrics = useMemo(() => {
    const metrics = new Map<string, { bounds: ReturnType<typeof groupBounds>; availableImageCount: number }>();
    for (const group of document.groups) {
      const availableImageCount = group.nodeIds.filter((id) => {
        const node = nodeById(document, id);
        return Boolean(
          node &&
            isCanvasReferenceableNode(node) &&
            node.data.kind === "image" &&
            node.data.url,
        );
      }).length;
      metrics.set(group.id, {
        bounds: groupBounds(document, group.id),
        availableImageCount,
      });
    }
    return metrics;
  }, [document.nodes, document.groups]);

  return (
    <div className="canvas-group-layer">
      {groups.map((group) => {
        const metrics = groupMetrics.get(group.id);
        if (!metrics) return null;
        const { bounds, availableImageCount } = metrics;
        const composing = composingGroupId === group.id;
        const groupLabelScale = Math.min(
          8,
          Math.max(1, 1.2 / Math.max(0.12, document.camera.zoom || 1)),
        );
        const groupInteraction =
          selectedGroupId === group.id &&
          group.nodeIds.length > 0 &&
          group.nodeIds.every((id) => draggingNodeIds.has(id)) &&
          draggingNodeIds.size > 0 &&
          (cursorTask === "dragging" || cursorTask === "resizing");

        return (
          <div
            key={group.id}
            className={`canvas-group ${selectedGroupId === group.id ? "selected" : ""} ${selectedGroupId === group.id && draggingNodeIds.size > 0 ? "dragging" : ""} ${connectionSourceId === group.id ? "connection-source" : ""} ${connectionTargetId === group.id ? "connection-target" : ""} ${assetDropGroupId === group.id ? "asset-drop-target" : ""}`}
            data-canvas-connectable-id={group.id}
            data-canvas-group-id={group.id}
            style={{
              left: bounds.x,
              top: bounds.y,
              width: bounds.w,
              height: bounds.h,
              zIndex: canvasGroupPaintZIndex(document, group, groupInteraction),
              "--canvas-group-color": group.color || "var(--accent)",
            } as CSSProperties}
            onPointerDown={(event) => onGroupPointerDown(event, group)}
          >
            <button
              type="button"
              className="canvas-group-port left"
              aria-label={`从${group.name}左侧发起连线`}
              title={`从${group.name}左侧发起连线`}
              onPointerDown={(event) => onStartConnection(event, group.id, "left")}
            />
            <button
              type="button"
              className="canvas-group-port right"
              aria-label={`从${group.name}右侧发起连线`}
              title={`从${group.name}右侧发起连线`}
              onPointerDown={(event) => onStartConnection(event, group.id, "right")}
            />
            <button
              type="button"
              className="canvas-group-resize"
              aria-label="调整对象组大小"
              onPointerDown={(event) => onGroupResize(event, group)}
            />
            {renderLabels && <div
              className="canvas-group-label"
              style={{ "--canvas-group-label-scale": groupLabelScale } as CSSProperties}
            >
              <button
                type="button"
                className={`canvas-group-compose ${composing ? "composing" : ""}`}
                disabled={availableImageCount < 2 || Boolean(composingGroupId)}
                title={
                  availableImageCount >= 2
                    ? `宫格拼接组内 ${availableImageCount} 张图片`
                    : "组内至少需要 2 张可用图片才能宫格拼接"
                }
                aria-label={
                  availableImageCount >= 2
                    ? `宫格拼接组内 ${availableImageCount} 张图片`
                    : "组内至少需要 2 张可用图片才能宫格拼接"
                }
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onComposeGroup(group.id);
                }}
              >
                {composing ? "…" : "▦"}
              </button>
              <span className="canvas-group-color-mark" aria-hidden="true" title={group.color ? `组颜色 ${group.color}` : "主题默认组颜色"} />
              <span aria-hidden="true">⌘</span>
              <CanvasInlineNameEditor
                value={group.name}
                fallback={group.name}
                ariaLabel={`对象组名称`}
                editing={renamingGroupId === group.id}
                onEditingChange={(editing) => onRenamingChange?.(group, editing)}
                onCommit={(name) => onRename?.(group, name)}
                className="canvas-group-name"
                inputClassName="canvas-group-name-input"
              />
              <small>{group.nodeIds.length} 个对象</small>
            </div>}
          </div>
        );
      })}
    </div>
  );
}
