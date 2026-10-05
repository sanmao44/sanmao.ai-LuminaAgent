"use client";

import { useEffect, useState, type ComponentType } from "react";
import type { ChatFile } from "@/lib/client-history";

export type ChatFilePreview = ChatFile & { label?: string };

type ChatFilePreviewDialogProps = {
  file: ChatFilePreview;
  Icon: ComponentType<{ name: string; size?: number }>;
  onClose: () => void;
};

export default function ChatFilePreviewDialog({ file, Icon, onClose }: ChatFilePreviewDialogProps) {
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    let url = "";
    try {
      if (typeof URL !== "undefined" && typeof Blob !== "undefined") {
        url = URL.createObjectURL(new Blob([file.content || ""], { type: "text/html;charset=utf-8" }));
      }
    } catch {
      // srcDoc remains available when an object URL cannot be created.
    }
    setPreviewUrl(url);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [file.content]);

  return (
    <div
      className="chat-file-preview-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="chat-file-preview-modal" role="dialog" aria-modal="true" aria-labelledby="chat-file-preview-title">
        <header className="chat-file-preview-head">
          <div>
            <small>{file.label || "HTML 预览"}</small>
            <h2 id="chat-file-preview-title" title={file.name}>{file.name}</h2>
          </div>
          <button type="button" className="chat-file-preview-close" onClick={onClose} aria-label="关闭预览" title="关闭预览">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="chat-file-preview-stage">
          {file.content ? (
            <iframe
              className="chat-file-preview-frame"
              title={`${file.name} 预览`}
              srcDoc={file.content}
              src={previewUrl || undefined}
              sandbox="allow-scripts"
              allow="autoplay; fullscreen"
              loading="eager"
              referrerPolicy="no-referrer"
            />
          ) : (
            <p style={{ display: "grid", placeItems: "center", height: "100%", margin: 0, color: "var(--muted)", fontSize: 13 }}>
              正在生成预览…
            </p>
          )}
        </div>
        <footer className="chat-file-preview-foot">
          <button type="button" className="secondary-action compact" onClick={onClose}>关闭</button>
        </footer>
      </section>
    </div>
  );
}
