"use client";

import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from "react";

const PRESETS = ["#e06c75", "#e5a84b", "#d8b04f", "#8fbd57", "#4db6ac", "#4ea6d8", "#6c8ee8", "#8d7be2", "#b277cf", "#d57da7", "#a58b72", "#81909b"] as const;

export default function CanvasGroupColorPopover({ value, position, onChange, onClose }: { value?: string; position: { left: number; top: number; width: number }; onChange: (value?: string) => void; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  const [draft, setDraft] = useState(value || "");
  const normalizedDraft = /^#[0-9a-f]{6}$/iu.test(draft) ? draft.toLowerCase() : "";
  closeRef.current = onClose;
  useEffect(() => setDraft(value || ""), [value]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".canvas-group-color-trigger") || target?.closest(".canvas-group-quick-color-trigger")) return;
      closeRef.current();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") closeRef.current(); };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("pointerdown", close, true); window.removeEventListener("keydown", escape, true); };
  }, []);
  return (
    <div ref={rootRef} className="canvas-group-color-popover" role="dialog" aria-label="组颜色" style={{ position: "fixed", left: position.left, top: position.top, width: position.width, transform: "none", zIndex: "var(--canvas-z-portal-popover)" }} onPointerDown={(event) => event.stopPropagation()}>
      <div className="canvas-group-color-popover-head"><b>组颜色</b><button type="button" aria-label="关闭组颜色" onClick={onClose}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg></button></div>
      <div className="canvas-group-color-swatches" aria-label="预设组颜色">
        {PRESETS.map((color, index) => <button key={color} type="button" aria-label={`颜色 ${index + 1} ${color}`} aria-pressed={normalizedDraft === color} className={normalizedDraft === color ? "selected" : ""} style={{ "--swatch-color": color } as CSSProperties} onClick={(event) => { event.stopPropagation(); setDraft(color); onChange(color); }} />)}
      </div>
      <label className="canvas-group-color-custom"><span>自定义颜色</span><input type="color" value={/^#[0-9a-f]{6}$/iu.test(draft) ? draft : "#7d72e8"} aria-label="选择自定义组颜色" onPointerDown={(event) => event.stopPropagation()} onChange={(event: ChangeEvent<HTMLInputElement>) => { setDraft(event.target.value); onChange(event.target.value); }} /></label>
      <button type="button" className="canvas-group-color-reset" onClick={(event) => { event.stopPropagation(); setDraft(""); onChange(undefined); }}>恢复默认</button>
    </div>
  );
}
