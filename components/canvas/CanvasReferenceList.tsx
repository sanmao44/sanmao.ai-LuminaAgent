"use client";

import type { DragEvent as ReactDragEvent } from "react";
import type { CanvasDocument, CanvasNode } from "@/lib/canvas/types";
import { incomingContext, isCanvasMentionableNode, isCanvasReferenceableNode } from "@/lib/canvas/model";

export type CanvasReferenceListProps = {
  document: CanvasDocument;
  ownerId?: string;
  nodes?: CanvasNode[];
  onReorder: (ownerId: string, draggedId: string, targetId: string) => void;
  onRemove?: (nodeId: string) => void;
  onClear?: () => void;
  onAdd?: () => void;
  onPaste?: () => void;
  onPreview?: (node: CanvasNode) => void;
  variant?: "card" | "deck";
};

export default function CanvasReferenceList({
  document,
  ownerId,
  nodes,
  onReorder,
  onRemove,
  onClear,
  onAdd,
  onPaste,
  onPreview,
  variant = "card",
}: CanvasReferenceListProps) {
  const references = ownerId
    ? incomingContext(document, ownerId).filter(isCanvasMentionableNode)
    : nodes || [];
  return (
    <div className={`canvas-reference-list-shell ${variant}`}>
      <div className={`canvas-reference-list ${variant}`}>
        {references.map((item, index) => (
          <div
            className="canvas-reference-item"
            key={item.id}
            draggable={Boolean(ownerId && isCanvasReferenceableNode(item))}
            title={ownerId ? "拖动调整参考顺序" : item.data.name || "参考素材"}
            onPointerDown={(event) => event.stopPropagation()}
            onDragStart={(event: ReactDragEvent<HTMLDivElement>) => {
              if (!ownerId || !isCanvasReferenceableNode(item)) return;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", item.id);
            }}
            onDragOver={(event) => {
              if (ownerId) event.preventDefault();
            }}
            onDrop={(event: ReactDragEvent<HTMLDivElement>) => {
              event.preventDefault();
              const draggedId = event.dataTransfer.getData("text/plain");
              if (ownerId && draggedId && isCanvasReferenceableNode(item)) onReorder(ownerId, draggedId, item.id);
            }}
          >
            <button type="button" className="canvas-reference-preview-button" aria-label={`预览引用 ${index + 1}`} onClick={(event) => { event.stopPropagation(); onPreview?.(item); }}>
              <span className="canvas-reference-index">{index + 1}</span>
              {item.type === "prompt" || item.type === "generator" ? (
                <span className="canvas-reference-text-thumb"><b>{item.type === "generator" ? "✦" : "▤"}</b><small>{String(item.data.agentResponse || item.data.text || item.data.prompt || "文本引用").replace(/\s+/g, " ").trim().slice(0, 42)}</small></span>
              ) : item.data.kind === "video" ? (
                <video src={item.data.url} muted playsInline />
              ) : (
                <img src={item.data.url} alt={item.data.name || "参考素材"} />
              )}
            </button>
            <b>{item.data.name || (item.type === "prompt" ? "文本引用" : item.data.kind === "video" ? "视频素材" : "图片素材")}</b>
            {onRemove && <button type="button" className="canvas-reference-remove" aria-label={`移除引用 ${index + 1}`} onClick={(event) => { event.stopPropagation(); onRemove(item.id); }}>×</button>}
          </div>
        ))}
        {!references.length && <small className="canvas-reference-empty">连接素材后显示参考顺序</small>}
      </div>
      {(onAdd || onPaste || (onClear && references.length > 0)) && (
        <div className="canvas-reference-list-actions">
          <span>{references.length}/16</span>
          {onAdd && <button type="button" onClick={onAdd}>＋ 添加</button>}
          {onPaste && <button type="button" onClick={onPaste}>粘贴</button>}
          {onClear && references.length > 0 && <button type="button" className="danger" onClick={onClear}>清空</button>}
        </div>
      )}
    </div>
  );
}
