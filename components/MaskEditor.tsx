'use client';

import { useEffect, useRef, useState } from 'react';

export type MaskEditorProps = {
  imageUrl: string;
  initialMaskDataUrl?: string;
  onApply: (maskDataUrl: string) => void;
  onCancel: () => void;
};

/** Draws an OpenAI-compatible mask. Transparent pixels are the editable area. */
export default function MaskEditor({ imageUrl, initialMaskDataUrl, onApply, onCancel }: MaskEditorProps) {
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const drawingRef = useRef(false);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [brushSize, setBrushSize] = useState(48);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const canvases = [imageCanvasRef.current, overlayCanvasRef.current, maskCanvasRef.current];
      canvases.forEach((canvas) => { if (canvas) { canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; } });
      const base = imageCanvasRef.current?.getContext('2d');
      if (base) { base.clearRect(0, 0, image.naturalWidth, image.naturalHeight); base.drawImage(image, 0, 0); }
      const maskContext = maskCanvasRef.current?.getContext('2d');
      const overlayContext = overlayCanvasRef.current?.getContext('2d');
      if (!maskContext || !overlayContext) return;
      const maskCtx = maskContext;
      const overlayCtx = overlayContext;

      function finishWithMask() {
        if (cancelled) return;
        const pixels = maskCtx.getImageData(0, 0, image.naturalWidth, image.naturalHeight).data;
        const preview = overlayCtx.createImageData(image.naturalWidth, image.naturalHeight);
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] < 128) { preview.data[index] = 239; preview.data[index + 1] = 68; preview.data[index + 2] = 68; preview.data[index + 3] = 122; }
        }
        overlayCtx.clearRect(0, 0, image.naturalWidth, image.naturalHeight);
        overlayCtx.putImageData(preview, 0, 0);
        setReady(true);
      }

      if (!initialMaskDataUrl) {
        maskCtx.clearRect(0, 0, image.naturalWidth, image.naturalHeight);
        maskCtx.fillStyle = '#fff'; maskCtx.fillRect(0, 0, image.naturalWidth, image.naturalHeight);
        overlayCtx.clearRect(0, 0, image.naturalWidth, image.naturalHeight);
        setReady(true);
        return;
      }

      const existingMask = new Image();
      existingMask.onload = () => { if (cancelled) return; maskCtx.clearRect(0, 0, image.naturalWidth, image.naturalHeight); maskCtx.drawImage(existingMask, 0, 0, image.naturalWidth, image.naturalHeight); finishWithMask(); };
      existingMask.onerror = () => { if (cancelled) return; maskCtx.clearRect(0, 0, image.naturalWidth, image.naturalHeight); maskCtx.fillStyle = '#fff'; maskCtx.fillRect(0, 0, image.naturalWidth, image.naturalHeight); overlayCtx.clearRect(0, 0, image.naturalWidth, image.naturalHeight); setReady(true); };
      existingMask.src = initialMaskDataUrl;
    };
    image.onerror = () => { if (!cancelled) setReady(false); };
    image.src = imageUrl;
    imageRef.current = image;
    return () => { cancelled = true; };
  }, [imageUrl, initialMaskDataUrl]);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * canvas.width / rect.width, y: (e.clientY - rect.top) * canvas.height / rect.height };
  }
  function paint(e: React.PointerEvent<HTMLCanvasElement>) {
    const overlay = overlayCanvasRef.current?.getContext('2d');
    const mask = maskCanvasRef.current?.getContext('2d');
    if (!overlay || !mask) return;
    const { x, y } = point(e);
    const rect = overlay.canvas.getBoundingClientRect();
    const radius = brushSize * overlay.canvas.width / Math.max(1, rect.width) / 2;
    overlay.save(); overlay.globalCompositeOperation = tool === 'brush' ? 'source-over' : 'destination-out'; overlay.beginPath(); overlay.arc(x, y, radius, 0, Math.PI * 2); overlay.fillStyle = 'rgba(239,68,68,.48)'; overlay.fill(); overlay.restore();
    mask.save(); mask.globalCompositeOperation = tool === 'brush' ? 'destination-out' : 'source-over'; mask.fillStyle = tool === 'brush' ? 'rgba(0,0,0,1)' : '#fff'; mask.beginPath(); mask.arc(x, y, radius, 0, Math.PI * 2); mask.fill(); mask.restore();
  }
  function clearOverlay() { const c = overlayCanvasRef.current; c?.getContext('2d')?.clearRect(0, 0, c.width, c.height); }
  function setFullMask() { const c = maskCanvasRef.current; if (!c) return; const ctx = c.getContext('2d'); if (!ctx) return; ctx.clearRect(0, 0, c.width, c.height); clearOverlay(); const o = overlayCanvasRef.current?.getContext('2d'); if (o) { o.fillStyle = 'rgba(239,68,68,.38)'; o.fillRect(0, 0, o.canvas.width, o.canvas.height); } }
  function protectAll() { const c = maskCanvasRef.current; if (!c) return; const ctx = c.getContext('2d'); if (!ctx) return; ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); clearOverlay(); }

  return <div className="mask-editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
    <div className="mask-editor surface">
      <div className="mask-editor-head"><div><span>局部修改</span><h2>绘制蒙版</h2><small>红色区域会交给模型重新绘制，未标红区域尽量保持不变</small></div><button type="button" className="icon-button" onClick={onCancel}>×</button></div>
      <div className="mask-canvas-wrap">{!ready && <div className="mask-loading">正在读取图片…</div>}<canvas ref={imageCanvasRef} className="mask-canvas base"/><canvas ref={overlayCanvasRef} className="mask-canvas overlay" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drawingRef.current = true; paint(e); }} onPointerMove={(e) => { if (drawingRef.current) paint(e); }} onPointerUp={() => { drawingRef.current = false; }} onPointerCancel={() => { drawingRef.current = false; }}/><canvas ref={maskCanvasRef} className="mask-canvas mask-data" aria-hidden /></div>
      <div className="mask-toolbar"><div className="mask-tools"><button type="button" className={tool === 'brush' ? 'active' : ''} onClick={() => setTool('brush')}>画笔</button><button type="button" className={tool === 'eraser' ? 'active' : ''} onClick={() => setTool('eraser')}>橡皮擦</button></div><label>笔刷大小 <input type="range" min="8" max="180" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))}/><b>{brushSize}px</b></label></div>
      <div className="mask-presets"><button type="button" onClick={protectAll}>清除涂抹</button><button type="button" onClick={setFullMask}>全图修改</button><span>提示：画笔标红，橡皮擦恢复保护区域</span></div>
      <div className="mask-editor-actions"><button type="button" className="secondary-action" onClick={onCancel}>取消</button><button type="button" className="primary-action compact" disabled={!ready} onClick={() => { const mask = maskCanvasRef.current?.toDataURL('image/png'); if (mask) onApply(mask); }}>应用蒙版</button></div>
    </div>
  </div>;
}
