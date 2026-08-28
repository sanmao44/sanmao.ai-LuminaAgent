'use client';

import { useEffect, useRef, useState } from 'react';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';

export type MaskEditorProps = {
  imageUrl: string;
  initialMaskDataUrl?: string;
  onApply: (maskDataUrl: string, coverage: number) => void | Promise<void>;
  onCancel: () => void;
};

/** Draws an OpenAI-compatible mask. Transparent pixels are the editable area. */
export default function MaskEditor({ imageUrl, initialMaskDataUrl, onApply, onCancel }: MaskEditorProps) {
  useBodyScrollLock(true);
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const drawingRef = useRef(false);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [brushSize, setBrushSize] = useState(48);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError('');
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
    image.onerror = () => { if (!cancelled) { setReady(false); setError('无法读取原图，请检查图片地址或重新上传'); } };
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
  async function applyMask() {
    if (!ready || saving) return;
    try {
      const canvas = maskCanvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) {
        setError('蒙版导出失败，请重试');
        return;
      }
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let editablePixels = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] < 128) editablePixels += 1;
      }
      const mask = canvas.toDataURL('image/png');
      setSaving(true);
      await onApply(mask, pixels.length ? editablePixels / (pixels.length / 4) : 0);
    } catch {
      setError('蒙版导出失败，图片可能受跨域保护');
    } finally {
      setSaving(false);
    }
  }

  return <div className="mask-editor-backdrop" onMouseDown={(e) => { if (!saving && e.target === e.currentTarget) onCancel(); }}>
    <div className="mask-editor surface">
      {error && <div className="mask-editor-error" role="alert">{error}</div>}
      <div className="mask-editor-head"><div><span>局部修改</span><h2>绘制蒙版</h2><small>红色区域会交给模型重新绘制，未标红区域尽量保持不变</small></div><button type="button" className="icon-button" disabled={saving} onClick={onCancel}>×</button></div>
      <div className="mask-canvas-wrap">{!ready && <div className="mask-loading">正在读取图片…</div>}<canvas ref={imageCanvasRef} className="mask-canvas base"/><canvas ref={overlayCanvasRef} className="mask-canvas overlay" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drawingRef.current = true; paint(e); }} onPointerMove={(e) => { if (drawingRef.current) paint(e); }} onPointerUp={() => { drawingRef.current = false; }} onPointerCancel={() => { drawingRef.current = false; }}/><canvas ref={maskCanvasRef} className="mask-canvas mask-data" aria-hidden /></div>
      <div className="mask-toolbar"><div className="mask-tools"><button type="button" disabled={!ready || saving} className={tool === 'brush' ? 'active' : ''} onClick={() => setTool('brush')}>画笔</button><button type="button" disabled={!ready || saving} className={tool === 'eraser' ? 'active' : ''} onClick={() => setTool('eraser')}>橡皮擦</button></div><label>笔刷大小 <input type="range" min="8" max="180" value={brushSize} disabled={!ready || saving} onChange={(e) => setBrushSize(Number(e.target.value))}/><b>{brushSize}px</b></label></div>
      <div className="mask-presets"><button type="button" disabled={!ready || saving} onClick={protectAll}>清除涂抹</button><button type="button" disabled={!ready || saving} onClick={setFullMask}>全图修改</button><span className="mask-legend"><i />红色 = 重新绘制 <i className="protected" />原图保护</span></div>
      <div className="mask-editor-actions"><button type="button" className="secondary-action" disabled={saving} onClick={onCancel}>取消</button><button type="button" className="primary-action compact" disabled={!ready || saving} onClick={() => void applyMask()}>{saving ? '正在保存…' : '应用蒙版'}</button></div>
    </div>
  </div>;
}
