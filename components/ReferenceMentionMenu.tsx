"use client";

import type { ReactNode } from "react";

export type ReferenceMentionKind = "image" | "video" | "text";

export type ReferenceMentionOption = {
  id: string;
  kind: ReferenceMentionKind;
  name: string;
  url?: string;
  text?: string;
  /** A generated result can provide a real preview while retaining text semantics. */
  thumbnailUrl?: string;
  thumbnailKind?: "image" | "video";
};

function previewText(value: string, max = 72) {
  return value.replace(/\s+/g, " ").trim().slice(0, max) || "文本引用";
}

function kindLabel(kind: ReferenceMentionKind) {
  return kind === "video" ? "参考视频" : kind === "text" ? "引用文本" : "参考图";
}

export function ReferenceMentionThumbnail({ reference }: { reference: ReferenceMentionOption }) {
  const thumbnailUrl = reference.thumbnailUrl || reference.url;
  if (thumbnailUrl && (reference.thumbnailKind === "video" || reference.kind === "video")) {
    return <video src={thumbnailUrl} muted playsInline preload="metadata" aria-hidden="true" />;
  }
  if (thumbnailUrl) {
    return <img src={thumbnailUrl} alt="" />;
  }
  if (reference.kind === "text") {
    return (
      <span className="reference-mention-text-thumbnail">
        <b>TXT</b>
        <small>{previewText(reference.text || "", 42)}</small>
      </span>
    );
  }
  return <span className="reference-mention-fallback-thumbnail">{reference.kind === "video" ? "▶" : "✦"}</span>;
}

export default function ReferenceMentionMenu({
  references,
  open,
  query = "",
  onSelect,
  className = "",
  limit = 12,
  title = "选择引用 · 输入 @编号",
}: {
  references: readonly ReferenceMentionOption[];
  open: boolean;
  query?: string;
  onSelect: (index: number) => void;
  className?: string;
  limit?: number;
  title?: ReactNode;
}) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const visibleReferences = references
    .map((reference, index) => ({ reference, index }))
    .filter(({ reference, index }) => {
      if (!normalizedQuery) return true;
      if (/^\d+$/.test(normalizedQuery) && String(index + 1).startsWith(normalizedQuery)) return true;
      return [
        kindLabel(reference.kind),
        index + 1,
        reference.name,
        reference.text,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .slice(0, Math.max(1, limit));

  if (!open || !visibleReferences.length) return null;

  return (
    <div className={`reference-mention-menu ${className}`.trim()} role="listbox">
      <div className="reference-mention-title">{title}</div>
      {visibleReferences.map(({ reference, index }) => (
        <button
          type="button"
          role="option"
          key={reference.id}
          aria-label={`引用 @${index + 1}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(index)}
        >
          <span className="reference-mention-thumb">
            <ReferenceMentionThumbnail reference={reference} />
          </span>
          <span className="reference-mention-index">@{index + 1}</span>
        </button>
      ))}
    </div>
  );
}
