"use client";

import type { ComponentType } from "react";

type SharePreviewIcon = ComponentType<{ name: string; size?: number }>;

export type SharePreview = {
  url: string;
  width: number;
  height: number;
  filename: string;
};

export type SharePreviewModalProps = {
  preview: SharePreview;
  Icon: SharePreviewIcon;
  onClose: () => void;
  onDownload: () => void;
};

export default function SharePreviewModal({ preview, Icon, onClose, onDownload }: SharePreviewModalProps) {
  return (
    <div
      className="share-preview-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="share-preview-modal" role="dialog" aria-modal="true" aria-labelledby="share-preview-title">
        <header className="share-preview-head">
          <div>
            <small>SANMAO.AI SHARE</small>
            <h2 id="share-preview-title">分享对话预览</h2>
            <span>确认内容后下载 PNG，完整对话仅在本地生成</span>
          </div>
          <button type="button" className="share-preview-close" onClick={onClose} aria-label="关闭分享预览">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="share-preview-stage">
          <img src={preview.url} alt="SANMAO.AI 对话分享长图预览" style={{ aspectRatio: `${preview.width} / ${preview.height}` }} />
        </div>
        <footer className="share-preview-foot">
          <span>{`${preview.width} × ${preview.height} PNG`}</span>
          <div>
            <button type="button" className="secondary-action" onClick={onClose}>继续编辑</button>
            <button type="button" className="primary-action compact share-preview-download" onClick={onDownload}>
              <Icon name="download" size={15} />
              下载 PNG
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
