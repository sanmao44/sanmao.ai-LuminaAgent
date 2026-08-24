"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import CreationParameterEditor from "@/components/CreationParameterEditor";
import { requestPromptOptimization, runReversePrompt } from "@/lib/creation/agent";
import type { CreationSettings, ImageCreationSettings, VideoCreationSettings } from "@/lib/creation/settings";

export type MediaViewerReference = {
  id: string;
  kind: "image" | "video";
  url: string;
  name: string;
};

export type MediaViewerItem = {
  id: string;
  kind: "image" | "video";
  url: string;
  name: string;
  prompt?: string;
  revisedPrompt?: string;
  width?: number;
  height?: number;
};

export default function MediaViewer({
  item,
  references,
  initialCompare = false,
  parameters,
  runtime,
  model,
  agentAvailable,
  onClose,
  onNavigate,
  onPromptSave,
  onParametersChange,
  onEdit,
  onUpscale,
  onContinue,
  onReuse,
  onUseAsReference,
  onAddToAssets,
  onDelete,
  onDownload,
  onWriteResult,
  onCreateTextNode,
  onAngle,
  onNotify,
}: {
  item: MediaViewerItem;
  references: MediaViewerReference[];
  initialCompare?: boolean;
  parameters?: ImageCreationSettings | VideoCreationSettings;
  runtime: unknown;
  model?: string;
  agentAvailable: boolean;
  onClose: () => void;
  onNavigate?: (direction: -1 | 1) => void;
  onPromptSave?: (value: string) => void;
  onParametersChange?: (settings: CreationSettings) => void;
  onEdit?: () => void;
  onAngle?: () => void;
  onUpscale?: () => void;
  onContinue?: () => void;
  onReuse?: () => void;
  onUseAsReference?: () => void;
  onAddToAssets?: () => void;
  onDelete?: () => void;
  onDownload?: (variant: "original" | "share") => void;
  onWriteResult?: (value: string) => void;
  onCreateTextNode?: (value: string) => void;
  onNotify: (message: string, kind?: "ok" | "error") => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [compare, setCompare] = useState(initialCompare);
  const [compareMode, setCompareMode] = useState<"split" | "slider">("split");
  const [comparePosition, setComparePosition] = useState(50);
  const [selectedReferenceId, setSelectedReferenceId] = useState(references[0]?.id || "");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showParameters, setShowParameters] = useState(false);
  const [promptDraft, setPromptDraft] = useState<string | null>(null);
  const pointerStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const sourcePrompt = item.prompt || "";
  const currentPrompt = promptDraft ?? sourcePrompt;
  const selectedReference = references.find((reference) => reference.id === selectedReferenceId) || references[0];
  const canCompare = item.kind === "image" && Boolean(selectedReference?.url);
  const referenceSignature = references.map((reference) => `${reference.id}:${reference.url}`).join("|");

  useEffect(() => {
    setCompare(initialCompare);
    setCompareMode("split");
    setComparePosition(50);
    setSelectedReferenceId(references[0]?.id || "");
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setResult(null);
    setShowParameters(false);
    setPromptDraft(null);
  }, [initialCompare, item.id, referenceSignature]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowLeft" && onNavigate) {
        if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
        event.preventDefault();
        onNavigate(-1);
      } else if (event.key === "ArrowRight" && onNavigate) {
        if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
        event.preventDefault();
        onNavigate(1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, onNavigate]);

  const updateZoom = (next: number, focus?: { x: number; y: number }) => {
    const previous = zoom;
    const value = Math.max(0.5, Math.min(4, Number(next.toFixed(2))));
    setZoom(value);
    if (value <= 1) {
      setPan({ x: 0, y: 0 });
      return;
    }
    const rect = stageRef.current?.getBoundingClientRect();
    if (focus && rect && previous > 0) {
      const pointerX = focus.x - rect.left - rect.width / 2;
      const pointerY = focus.y - rect.top - rect.height / 2;
      const nextPan = {
        x: pointerX - (pointerX - pan.x) * (value / previous),
        y: pointerY - (pointerY - pan.y) * (value / previous),
      };
      const limitX = Math.max(0, rect.width * Math.max(0, value - 1) * 0.7);
      const limitY = Math.max(0, rect.height * Math.max(0, value - 1) * 0.7);
      setPan({
        x: Math.max(-limitX, Math.min(limitX, nextPan.x)),
        y: Math.max(-limitY, Math.min(limitY, nextPan.y)),
      });
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    updateZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1), { x: event.clientX, y: event.clientY });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom <= 1 || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStart.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const rect = stageRef.current?.getBoundingClientRect();
    const limitX = rect ? Math.max(0, rect.width * Math.max(0, zoom - 1) * 0.7) : Infinity;
    const limitY = rect ? Math.max(0, rect.height * Math.max(0, zoom - 1) * 0.7) : Infinity;
    setPan({
      x: Math.max(-limitX, Math.min(limitX, pointerStart.current.panX + event.clientX - pointerStart.current.x)),
      y: Math.max(-limitY, Math.min(limitY, pointerStart.current.panY + event.clientY - pointerStart.current.y)),
    });
  };

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  const mediaStyle = { transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` };

  const runReverse = async () => {
    if (item.kind !== "image") return;
    if (!agentAvailable) return onNotify("没有可用的对话模型，请先在主界面模型库启用。", "error");
    setBusy(true);
    try {
      const value = await runReversePrompt(
        [{ url: item.url, name: item.name }, ...references.map((reference) => ({ url: reference.url, name: reference.name }))],
        model,
      );
      setResult(value);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "反推提示词失败", "error");
    } finally {
      setBusy(false);
    }
  };

  const runOptimize = async () => {
    if (!agentAvailable) return onNotify("没有可用的对话模型，请先在主界面模型库启用。", "error");
    if (!sourcePrompt.trim()) return onNotify("当前媒体没有可优化的原始提示词", "error");
    setBusy(true);
    try {
      const value = await requestPromptOptimization(
        sourcePrompt,
        references.map((reference) => ({ url: reference.url, name: reference.name })),
        model,
      );
      setResult(value);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "AI 优化失败", "error");
    } finally {
      setBusy(false);
    }
  };

  const savePrompt = () => {
    if (!onPromptSave || !currentPrompt.trim() || currentPrompt === sourcePrompt) return;
    onPromptSave(currentPrompt);
    setPromptDraft(null);
    onNotify("提示词已保存");
  };

  const download = (variant: "original" | "share") => {
    if (onDownload) return onDownload(variant);
    const anchor = document.createElement("a");
    anchor.href = item.url;
    anchor.download = `${item.name || "SANMAO素材"}-${variant === "share" ? "分享版" : "原图"}.${item.kind === "video" ? "mp4" : "png"}`;
    anchor.click();
  };

  return (
    <div
      className="canvas-modal-backdrop media-viewer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${item.name || "素材"}预览`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="canvas-lightbox canvas-media-viewer media-viewer-shared">
        <header>
          <div>
            <b>{item.name || "素材预览"}</b>
            <small>{item.width && item.height ? `${item.width} × ${item.height}` : "画布媒体预览"}</small>
          </div>
          <div className="media-viewer-header-actions">
            <div className="canvas-media-zoom-controls" aria-label="预览缩放">
              <button type="button" onClick={() => updateZoom(zoom - 0.1)} title="缩小">−</button>
              <button type="button" className="zoom-readout" onClick={() => { updateZoom(1); setPan({ x: 0, y: 0 }); }} title="恢复原比例">{Math.round(zoom * 100)}%</button>
              <button type="button" onClick={() => updateZoom(zoom + 0.1)} title="放大">＋</button>
            </div>
            {onNavigate && <span className="media-viewer-nav-hint">← / → 切换</span>}
            <button type="button" onClick={() => setCompare((value) => !value)} disabled={!selectedReference?.url}>
              {compare ? "单图预览" : "前后对比"}
            </button>
            {canCompare && (
              <button type="button" className={compareMode === "slider" ? "active" : ""} onClick={() => setCompareMode((value) => value === "split" ? "slider" : "split")}>
                {compareMode === "slider" ? "左右对比" : "滑动对比"}
              </button>
            )}
            {parameters && <button type="button" className={showParameters ? "active" : ""} onClick={() => setShowParameters((value) => !value)}>⚙ 参数调整</button>}
            <button type="button" onClick={() => download("original")}>↓ 原图</button>
            <button type="button" onClick={() => download("share")}>⇩ 分享</button>
            <button type="button" onClick={onClose} aria-label="关闭预览">×</button>
          </div>
        </header>

        <div
          ref={stageRef}
          className={`canvas-lightbox-stage media-viewer-stage ${compare && selectedReference ? "compare" : ""} ${canCompare && compareMode === "slider" ? "slider" : ""} ${dragging ? "dragging" : ""}`}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onDoubleClick={() => { updateZoom(1); setPan({ x: 0, y: 0 }); }}
        >
          {canCompare && compareMode === "slider" && compare ? (
            <div className="canvas-lightbox-slider">
              <div className="canvas-lightbox-slider-base"><img src={selectedReference.url} alt={selectedReference.name} style={mediaStyle} /></div>
              <div className="canvas-lightbox-slider-overlay" style={{ clipPath: `inset(0 ${100 - comparePosition}% 0 0)` }}><img src={item.url} alt={item.name} style={mediaStyle} /></div>
              <span className="canvas-lightbox-slider-label before">{selectedReference.name}</span>
              <span className="canvas-lightbox-slider-label after">生成结果</span>
            </div>
          ) : (
            <>
              {compare && selectedReference && <div className="canvas-lightbox-before"><span>{selectedReference.name}</span><img src={selectedReference.url} alt={selectedReference.name} style={mediaStyle} /></div>}
              <div className="canvas-lightbox-after">
                <span>{compare ? "生成结果" : ""}</span>
                {item.kind === "video" ? <video src={item.url} controls playsInline style={mediaStyle} /> : <img src={item.url} alt={item.name} style={mediaStyle} />}
              </div>
            </>
          )}
          <span className="media-viewer-wheel-tip">滚轮缩放 · 双击复位{zoom > 1 ? " · 拖动查看" : ""}</span>
        </div>

        {canCompare && compare && compareMode === "slider" && (
          <label className="canvas-lightbox-slider-control"><span>参考图</span><input type="range" min="0" max="100" value={comparePosition} onChange={(event) => setComparePosition(Number(event.target.value))} aria-label="滑动对比位置" /><span>生成结果</span></label>
        )}

        {references.length > 0 && (
          <section className="media-viewer-reference-panel">
            <div className="media-viewer-reference-head"><b>参考图 · {references.length} 张</b><small>点击切换对比对象</small></div>
            <div className="media-viewer-reference-list">
              {references.map((reference, index) => (
                <button type="button" className={reference.id === selectedReference?.id ? "active" : ""} key={reference.id} onClick={() => { setSelectedReferenceId(reference.id); setCompare(true); }}>
                  {reference.kind === "video" ? <video src={reference.url} muted playsInline /> : <img src={reference.url} alt={reference.name} />}
                  <span>图 {index + 1}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="canvas-media-viewer-editing">
          <label><span>提示词</span><textarea value={currentPrompt} onChange={(event) => setPromptDraft(event.target.value)} placeholder="当前节点没有保存提示词" /></label>
          <button type="button" disabled={!onPromptSave || !currentPrompt.trim() || currentPrompt === sourcePrompt} onClick={savePrompt}>保存提示词</button>
        </div>

        {showParameters && parameters && onParametersChange && (
          <section className="canvas-media-parameters">
            <header><b>生成参数</b><small>与主界面 CreationParameterEditor 共用</small></header>
            <CreationParameterEditor settings={parameters} runtime={runtime as never} onChange={onParametersChange} />
          </section>
        )}

        <div className="canvas-media-viewer-actions media-viewer-actions-shared">
          {item.kind === "image" && <button type="button" disabled={busy || !agentAvailable} onClick={() => void runReverse()}>⌁ 反推提示词</button>}
          <button type="button" disabled={busy || !agentAvailable} onClick={() => void runOptimize()}>✦ AI 优化</button>
          {onEdit && <button type="button" onClick={onEdit}>✎ 修改 / 蒙版</button>}
          {onAngle && item.kind === "image" && <button type="button" onClick={onAngle}>◌ 调整角度</button>}
          {onUpscale && item.kind === "image" && <button type="button" onClick={onUpscale}>↗ 超分</button>}
          {onContinue && <button type="button" onClick={onContinue}>{item.kind === "video" ? "▶ 继续生成 / 变体" : "▶ 继续生成"}</button>}
          {onReuse && <button type="button" className="primary" onClick={onReuse}>⧉ 用此参数再生成</button>}
          {onUseAsReference && <button type="button" onClick={onUseAsReference}>⌁ 作为参考图</button>}
          {onAddToAssets && <button type="button" onClick={onAddToAssets}>＋ 加入资产库</button>}
          {onDelete && <button type="button" className="danger" onClick={onDelete}>⌫ 删除</button>}
        </div>

        {!agentAvailable && <div className="canvas-media-viewer-note">反推提示词与 AI 优化已暂停：请先在主界面模型库启用一个对话模型。</div>}
        {result && (
          <section className="canvas-media-result-panel">
            <header><b>AI 结果（未覆盖原文）</b><button type="button" onClick={() => setResult(null)}>×</button></header>
            <p>{result}</p>
            <footer>
              {onWriteResult && <button type="button" onClick={() => onWriteResult(result)}>写入当前提示词</button>}
              {onCreateTextNode && <button type="button" onClick={() => onCreateTextNode(result)}>创建文本节点</button>}
              <button type="button" onClick={() => void navigator.clipboard?.writeText(result)}>复制结果</button>
              <button type="button" onClick={() => setResult(null)}>放弃</button>
            </footer>
          </section>
        )}
      </div>
    </div>
  );
}
