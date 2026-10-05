"use client";

import type { ComponentType } from "react";
import type { CreativeReference } from "@/lib/creative-references";

export type MessageReferencePreview = Pick<CreativeReference, "name" | "kind" | "text" | "url">;

type MessageReferencePreviewModalProps = {
  preview: MessageReferencePreview;
  Icon: ComponentType<{ name: string; size?: number }>;
  onClose: () => void;
};

export default function MessageReferencePreviewModal({ preview, Icon, onClose }: MessageReferencePreviewModalProps) {
  return (
    <div className="reference-preview-backdrop" role="presentation" onClick={onClose}>
      <div className="reference-preview surface" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="reference-preview-head">
          <div>
            <span>鍙傝€冨浘棰勮</span>
            <h3>{preview.name}</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="鍏抽棴棰勮">
            <Icon name="close" />
          </button>
        </div>
        <div className="reference-preview-stage">
          {preview.kind === "video" ? (
            <video src={preview.url} controls playsInline />
          ) : preview.kind === "text" ? (
            <pre>{preview.text}</pre>
          ) : (
            <img src={preview.url} alt={preview.name} />
          )}
        </div>
        <div className="reference-preview-footer">
          <small>瀹屾暟姣斾緥鏄剧ず锛屼笉瑁佸壀</small>
          <button type="button" className="secondary-action compact" onClick={onClose}>
            鍏抽棴
          </button>
        </div>
      </div>
    </div>
  );
}
