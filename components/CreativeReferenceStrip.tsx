"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ComponentType, type DragEvent, type MouseEvent } from "react";
import { creativeReferenceUrl, referencePreviewText, type CreativeReference } from "@/lib/creative-references";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

type CreativeReferenceStripProps = {
  refs: CreativeReference[];
  Icon: ComponentType<{ name: string; size?: number }>;
  onAdd: (files: FileList) => void;
  onRemove: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onClear?: () => void;
  onPasteClick?: () => void;
  onLocalUpscale?: (event: MouseEvent<HTMLButtonElement>) => void;
  localUpscaleActive?: boolean;
  label: string;
  hint: string;
  accept: string;
};

export default function CreativeReferenceStrip({
  refs,
  Icon,
  onAdd,
  onRemove,
  onReorder,
  onClear,
  onPasteClick,
  onLocalUpscale,
  localUpscaleActive = false,
  label,
  hint,
  accept,
}: CreativeReferenceStripProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [preview, setPreview] = useState<CreativeReference | null>(null);
  useBodyScrollLock(Boolean(preview));

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preview]);

  const canUpscale = refs.length === 1 && refs[0]?.kind === "image" && Boolean(creativeReferenceUrl(refs[0])) && !refs.some((ref) => ref.pending);
  const handleDrop = (event: DragEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    if (!refs[index]?.pending && dragIndex !== null) onReorder(dragIndex, index);
    setDragIndex(null);
  };

  return (
    <div className={`reference-block ${refs.length ? "has-references" : ""}`}>
      <div className="reference-head">
        <span>
          <Icon name={refs.length && refs.every((ref) => ref.kind === "text") ? "file" : "image"} size={14} />
          {label}
          {refs.length > 0 && <b>{refs.length} 个已添加</b>}
        </span>
        <div>
          {onLocalUpscale && (
            <button
              type="button"
              className={`local-upscale-reference ${localUpscaleActive ? "active" : ""}`}
              disabled={!localUpscaleActive && !canUpscale}
              title={localUpscaleActive ? "返回普通生图模式" : refs.length !== 1 || refs[0]?.kind !== "image" ? "请先添加 1 张图片参考" : refs.some((ref) => ref.pending) ? "参考图正在准备，请稍候片刻" : "使用本地上传图片进行超分"}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onLocalUpscale(event);
              }}
            >
              <Icon name="upscale" size={12} />
              {localUpscaleActive ? "返回生图" : "超分"}
            </button>
          )}
          {onPasteClick && <button type="button" className="paste-reference" onClick={onPasteClick}>粘贴</button>}
          {refs.length > 0 && onClear && <button type="button" className="clear-references" onClick={onClear}><Icon name="close" size={11} />清空</button>}
          <small>{refs.length}/16 · {hint}</small>
        </div>
      </div>
      <div className={`reference-strip ${refs.length ? "has-items" : "empty"}`}>
        <div className="reference-items">
          {refs.map((ref, index) => (
            <div
              className={`reference-thumb ${ref.pending ? "pending" : ""} ${dragIndex === index ? "dragging" : ""}`}
              title={`${ref.pending ? "正在准备 · " : "点击预览 · "}${ref.name}${ref.kind === "text" ? `\n${referencePreviewText(ref, 160)}` : ""}`}
              draggable={!ref.pending}
              onClick={() => setPreview(ref)}
              onDragStart={(event) => {
                if (ref.pending) return;
                setDragIndex(index);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", ref.id);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (!ref.pending) event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => handleDrop(event, index)}
              onDragEnd={() => setDragIndex(null)}
              key={ref.id}
            >
              {ref.kind === "video" ? <video draggable={false} src={creativeReferenceUrl(ref)} muted playsInline /> : ref.kind === "text" ? <span className="reference-text-thumb"><small>{ref.name}</small></span> : <img draggable={false} src={creativeReferenceUrl(ref)} alt={ref.name} />}
              {ref.pending && <span className="reference-pending-overlay"><i className="mini-loader" />准备中</span>}
              <span className="reference-index">{index + 1}</span>
              <button
                type="button"
                className="reference-remove"
                title="移除引用"
                aria-label={`移除引用 ${index + 1}`}
                draggable={false}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(ref.id);
                }}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          ))}
        </div>
        {refs.length < 16 && <button type="button" className="add-reference" onClick={() => inputRef.current?.click()}><Icon name="upload" size={18} /><span>{refs.length ? "继续添加引用" : "点击、拖入或粘贴图片、视频或文本"}</span></button>}
      </div>
      <input hidden ref={inputRef} type="file" accept={accept} multiple onChange={(event) => { if (event.target.files) onAdd(event.target.files); event.currentTarget.value = ""; }} />
      {preview && typeof document !== "undefined" && createPortal(
        <div className="reference-preview-backdrop" onClick={() => setPreview(null)}>
          <div className="reference-preview surface" onClick={(event) => event.stopPropagation()}>
            <div className="reference-preview-head">
              <div><span>{preview.kind === "video" ? "参考视频预览" : preview.kind === "text" ? "引用文本预览" : "参考图预览"}</span><h3>{preview.name}</h3></div>
              <button type="button" className="icon-button" onClick={() => setPreview(null)}><Icon name="close" /></button>
            </div>
            <div className="reference-preview-stage">{preview.kind === "video" ? <video src={creativeReferenceUrl(preview)} controls playsInline /> : preview.kind === "text" ? <pre>{preview.text}</pre> : <img src={creativeReferenceUrl(preview)} alt={preview.name} />}</div>
            <div className="reference-preview-footer"><small>{preview.kind === "text" ? "完整文本内容" : "完整比例显示，不裁剪"}</small><button type="button" className="secondary-action compact" onClick={() => setPreview(null)}>关闭</button></div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
