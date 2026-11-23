"use client";

import { useRef, useState, type MouseEvent } from "react";

export type CanvasMediaRecoveryActionsProps = {
  kind: "image" | "video";
  onRetry: (event: MouseEvent<HTMLButtonElement>) => void;
  onReplace: (file: File) => Promise<void>;
};

/** File picker state is transient; replacement is delegated to the Core boundary. */
export default function CanvasMediaRecoveryActions({ kind, onRetry, onReplace }: CanvasMediaRecoveryActionsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="canvas-media-recovery" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
      <div className="canvas-media-recovery-actions" aria-busy={busy}>
        <button type="button" className="canvas-media-retry canvas-media-replace" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "正在替换…" : "上传替换"}
        </button>
        <button type="button" className="canvas-media-retry" disabled={busy} onClick={onRetry}>重试加载</button>
        <input
          ref={inputRef}
          type="file"
          accept={`${kind}/*`}
          aria-label={`选择替换${kind === "video" ? "视频" : "图片"}`}
          hidden
          disabled={busy}
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file || busyRef.current) return;
            busyRef.current = true;
            setBusy(true);
            setError("");
            try {
              await onReplace(file);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "素材替换失败，请重试。");
            } finally {
              busyRef.current = false;
              setBusy(false);
            }
          }}
        />
      </div>
      {error && <p className="canvas-media-recovery-error" role="alert">{error}</p>}
    </div>
  );
}
