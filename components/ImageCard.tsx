"use client";

import { useEffect, useRef, useState, type ComponentType, type MouseEvent } from "react";
import type { GalleryItem } from "@/lib/client-history";
import { galleryReferences } from "@/lib/reference-images";
import { referenceTextBadge } from "@/lib/creative-references";
import { formatTime } from "@/lib/generation-log-presentation";

type ComparisonSource = { item: GalleryItem; kind: "reference" | "parent"; label: string };

export type ImageCardProps = {
  item: GalleryItem;
  Icon: ComponentType<{ name: string; size?: number }>;
  selected?: boolean;
  selectionMode?: boolean;
  sourceOverride?: GalleryItem["source"];
  comparisonSource?: ComparisonSource | null;
  previousItem?: GalleryItem | null;
  priority?: boolean;
  sourceLabel: (source: GalleryItem["source"]) => string;
  onSelect?: () => void;
  onPreview?: () => void;
  onEdit?: () => void;
  onUpscale?: () => void;
  onReuse?: () => void;
  onReference?: () => void;
  onPushVideo?: () => void;
  onCompare?: () => void;
  onReversePrompt?: () => void | Promise<void>;
  onFavorite?: () => void;
  onDownload?: () => void;
  onDownloadShare?: () => void | Promise<void>;
  onDelete?: () => void;
  onOpenAngle?: () => void;
  onOpenOutpaint?: () => void;
};

export default function ImageCard({
  item,
  Icon,
  selected = false,
  selectionMode = false,
  sourceOverride,
  comparisonSource: passedComparisonSource,
  previousItem,
  priority = false,
  sourceLabel,
  onSelect,
  onPreview,
  onEdit,
  onUpscale,
  onReuse,
  onReference,
  onPushVideo,
  onCompare,
  onReversePrompt,
  onFavorite,
  onDownload,
  onDownloadShare,
  onDelete,
  onOpenAngle,
  onOpenOutpaint,
}: ImageCardProps) {
  const [menu, setMenu] = useState(false);
  const [imageState, setImageState] = useState<"loading" | "loaded" | "error">("loading");
  const [retryToken, setRetryToken] = useState(0);
  const imageRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    setImageState("loading");
    setRetryToken(0);
  }, [item.url]);
  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete) setImageState(image.naturalWidth > 0 ? "loaded" : "error");
  }, [item.url, retryToken]);
  const comparisonSource = passedComparisonSource || (previousItem ? {
    item: previousItem,
    kind: previousItem.id.startsWith("reference-") ? "reference" : "parent",
    label: previousItem.id.startsWith("reference-") ? "参考图" : "前一版",
  } as ComparisonSource : null);
  const references = galleryReferences(item);
  const retryImage = () => {
    setImageState("loading");
    setRetryToken((value) => value + 1);
  };
  const stopMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu(false);
  };

  return (
    <article className={`image-card ${selected ? "selected" : ""}`}>
      <button className="image-stage" type="button" onClick={() => {
        if (imageState === "error") { retryImage(); return; }
        if (selectionMode) onSelect?.(); else onPreview?.();
      }}>
        {imageState === "loading" && <span className="image-loading-placeholder" aria-hidden="true"><span className="image-loading-spinner" /></span>}
        <img
          ref={imageRef}
          src={retryToken ? `${item.url}${item.url.includes("?") ? "&" : "?"}retry=${retryToken}` : item.url}
          alt={item.prompt || "生成图片"}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "low"}
          onLoad={() => setImageState("loaded")}
          onError={() => setImageState("error")}
        />
        {imageState === "error" && <span className="image-load-error">图片加载失败 · 点击重试</span>}
        {selectionMode && <span className={`select-mark ${selected ? "checked" : ""}`}>{selected && <Icon name="check" size={14} />}</span>}
        {typeof item.generationMs === "number" && <span className="image-duration">⏱ {Math.max(0, item.generationMs / 1000).toFixed(1)}s</span>}
        <span className="image-source">{item.localFileName ? "本地图片" : sourceLabel(sourceOverride || item.source)}</span>
      </button>
      <div className="image-card-body">
        <p>{item.prompt || "未保存提示词"}</p>
        <div className="image-meta">
          <span title={item.providerName ? `${item.modelName || "图片模型"} · ${item.providerName}` : item.modelName || "图片模型"}>{item.providerName ? `${item.modelName || "图片模型"} · ${item.providerName}` : item.modelName || "图片模型"}</span>
          <span>{item.outputSize || item.aspectRatio || "自动"}</span>
          <span>{formatTime(item.createdAt)}</span>
        </div>
        {references.length > 0 && <div className="image-card-references" title={references.map((reference, index) => `${reference.kind === "text" ? "引用" : "图"} ${index + 1} · ${reference.name}`).join("\n")}>
          <span className="image-card-reference-label">{references.some((reference) => reference.kind !== "text") ? "参考图" : "引用"}</span>
          {references.slice(0, 4).map((reference, index) => <span className="image-card-reference-thumb" key={`${reference.url}-${index}`}>
            {reference.kind === "video" ? <video src={reference.url} muted playsInline /> : reference.kind === "text" ? <span className="reference-text-thumb"><b>{referenceTextBadge(reference)}</b></span> : <img src={reference.url} alt={`参考图 ${index + 1}`} />}
            <i>{index + 1}</i>
          </span>)}
          {references.length > 4 ? <small>+{references.length - 4}</small> : null}
        </div>}
        <div className="image-actions">
          <div className="image-actions-main">
            <button type="button" onClick={onEdit}><Icon name="edit" size={15} />修改</button>
            <button type="button" className="reuse-action" onClick={onReuse}><Icon name="reuse" size={15} />复用参数</button>
            {onPushVideo && <button type="button" className="push-video-action" onClick={onPushVideo}><Icon name="video" size={15} />生视频</button>}
            <button type="button" className="reference-action" onClick={onReference}><Icon name="image" size={15} />参考图</button>
          </div>
          <div className="image-actions-secondary">
            <button type="button" className="download-action" onClick={onDownload}><Icon name="download" size={15} />下载</button>
            <div className="more-wrap" tabIndex={-1} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMenu(false); }}>
              <button type="button" onClick={() => setMenu((value) => !value)} title="更多"><Icon name="more" size={16} /></button>
              {menu && <div className="more-menu">
                <button type="button" onClick={(event) => { stopMenu(event); void onReversePrompt?.(); }}><Icon name="agent" size={15} />反推提示词</button>
                <button type="button" onClick={(event) => { stopMenu(event); onUpscale?.(); }}><Icon name="upscale" size={15} />高清放大</button>
                <button type="button" onClick={(event) => { stopMenu(event); onOpenAngle?.(); }}><Icon name="adjust" size={15} />调整角度</button>
                <button type="button" onClick={(event) => { stopMenu(event); onOpenOutpaint?.(); }}><Icon name="full" size={15} />图像编辑 / 扩图</button>
                {comparisonSource && onCompare && <button type="button" onClick={(event) => { stopMenu(event); onCompare(); }}><Icon name="compare" size={15} />{comparisonSource.kind === "reference" ? "与参考图对比" : "前后对比"}</button>}
                <button type="button" onClick={(event) => { stopMenu(event); onReuse?.(); }}><Icon name="reuse" size={15} />用此参数再生成</button>
                <button type="button" onClick={(event) => { stopMenu(event); void onDownloadShare?.(); }} disabled={!references.length}><Icon name="download" size={15} />下载分享版</button>
                <button type="button" onClick={(event) => { stopMenu(event); onFavorite?.(); }}><Icon name="star" size={15} />{item.favorite ? "取消收藏" : "收藏"}</button>
                <button type="button" className="danger" onClick={(event) => { stopMenu(event); onDelete?.(); }}><Icon name="trash" size={15} />删除</button>
              </div>}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
