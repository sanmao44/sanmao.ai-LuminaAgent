"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import type { CanvasReferenceDraft } from "@/lib/canvas/reuse";

export default function CanvasReferenceDraftStrip({
  references,
  onFiles,
  onRemove,
  onReorder,
  onPaste,
  onClear,
  onPreview,
  onNodeDrop,
  max = 16,
  disabled = false,
  emptyLabel = "添加参考图",
  trailing,
}: {
  references: CanvasReferenceDraft[];
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onPaste?: () => void;
  onClear?: () => void;
  onPreview?: (reference: CanvasReferenceDraft) => void;
  onNodeDrop?: (nodeId: string) => void;
  max?: number;
  disabled?: boolean;
  emptyLabel?: string;
  trailing?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const acceptFiles = (files: File[]) => {
    const valid = files.filter(
      (file) => file.type.startsWith("image/") || file.type.startsWith("video/"),
    );
    if (valid.length) onFiles(valid);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragIndex(null);
    if (disabled) return;
    if (event.dataTransfer.files.length) {
      acceptFiles([...event.dataTransfer.files]);
      return;
    }
    const nodeId = event.dataTransfer.getData("application/x-sanmao-canvas-node");
    if (nodeId) onNodeDrop?.(nodeId);
  };

  return (
    <section
      className="canvas-reference-draft-strip"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      onPaste={(event) => {
        if (!onPaste || disabled) return;
        const image = [...event.clipboardData.items].find((item) =>
          item.type.startsWith("image/"),
        );
        if (image) {
          event.preventDefault();
          const file = image.getAsFile();
          if (file) onFiles([file]);
        }
      }}
    >
      <div className="canvas-reference-draft-head">
        <span>
          <b>参考图</b>
          <small>{references.length}/{max}</small>
        </span>
        <div>
          {onPaste && (
            <button type="button" disabled={disabled} onClick={onPaste}>
              粘贴
            </button>
          )}
          {references.length > 0 && onClear && (
            <button type="button" className="danger" disabled={disabled} onClick={onClear}>
              清空
            </button>
          )}
          {trailing}
        </div>
      </div>
      <div className="canvas-reference-draft-items">
        {references.map((reference, index) => (
          <div
            className={`canvas-reference-draft-item${dragIndex === index ? " dragging" : ""}${reference.pending ? " pending" : ""}`}
            key={reference.id}
            draggable={!disabled && !reference.pending}
            title={reference.name}
            onDragStart={(event) => {
              setDragIndex(index);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", String(index));
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const from = Number(event.dataTransfer.getData("text/plain"));
              if (Number.isInteger(from)) onReorder(from, index);
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
          >
            <button
              type="button"
              className="canvas-reference-draft-preview"
              onClick={() => onPreview?.(reference)}
              disabled={disabled}
            >
              {reference.kind === "video" ? (
                <video src={reference.url} muted playsInline />
              ) : (
                <img src={reference.url} alt={reference.name} />
              )}
              <span>{index + 1}</span>
              {reference.pending && <i>准备中</i>}
            </button>
            <button
              type="button"
              className="canvas-reference-draft-remove"
              aria-label={`移除参考图 ${index + 1}`}
              disabled={disabled}
              onClick={() => onRemove(reference.id)}
            >
              ×
            </button>
          </div>
        ))}
        {references.length < max && (
          <button
            type="button"
            className="canvas-reference-draft-add"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <span>＋</span>
            <small>{references.length ? "继续添加" : emptyLabel}</small>
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        hidden
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
        onChange={(event) => {
          if (event.target.files) acceptFiles([...event.target.files]);
          event.currentTarget.value = "";
        }}
      />
    </section>
  );
}
