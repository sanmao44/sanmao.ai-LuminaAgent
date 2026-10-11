"use client";

import { useEffect, useRef, type CSSProperties } from "react";

const PRESETS = ["#e06c75", "#e5a84b", "#d8b04f", "#8fbd57", "#4db6ac", "#4ea6d8", "#6c8ee8", "#8d7be2", "#b277cf", "#d57da7", "#a58b72", "#81909b"] as const;

export default function CanvasGroupColorPopover({ value, onChange, onClose }: { value?: string; onChange: (value?: string) => void; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      onClose();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("pointerdown", close, true); window.removeEventListener("keydown", escape, true); };
  }, [onClose]);
  return (
    <div ref={rootRef} className="canvas-group-color-popover" role="dialog" aria-label="组颜色">
      <div className="canvas-group-color-popover-head"><b>组颜色</b><button type="button" aria-label="关闭组颜色" onClick={onClose}>×</button></div>
      <div className="canvas-group-color-swatches" role="listbox" aria-label="预设组颜色">
        {PRESETS.map((color) => <button key={color} type="button" role="option" aria-label={color} aria-selected={value?.toLowerCase() === color} className={value?.toLowerCase() === color ? "selected" : ""} style={{ "--swatch-color": color } as CSSProperties} onClick={() => onChange(color)} />)}
      </div>
      <label className="canvas-group-color-custom"><span>自定义</span><input type="color" value={/^#[0-9a-f]{6}$/iu.test(value || "") ? value : "#7d72e8"} aria-label="选择自定义组颜色" onChange={(event) => onChange(event.target.value)} /></label>
      <button type="button" className="canvas-group-color-reset" onClick={() => onChange(undefined)}>恢复默认</button>
    </div>
  );
}
