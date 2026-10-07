"use client";

import type { ComponentType, CSSProperties } from "react";

export type AgentSelectionPushState = {
  text: string;
  x: number;
  y: number;
  placement: "above" | "below";
};

export type AgentSelectionPushProps = {
  selection: AgentSelectionPushState;
  availableVideoModelCount: number;
  Icon: ComponentType<{ name: string; size?: number }>;
  onPushImage: (navigate: boolean) => void;
  onPushVideo: (navigate: boolean) => void;
};

/** Renders the text-selection handoff bar; Page keeps selection state and routing actions. */
export default function AgentSelectionPush({
  selection,
  availableVideoModelCount,
  Icon,
  onPushImage,
  onPushVideo,
}: AgentSelectionPushProps) {
  const style: CSSProperties = { left: selection.x, top: selection.y };
  const hasVideoModels = availableVideoModelCount > 0;
  return (
    <div
      className={`selection-push ${selection.placement === "below" ? "below" : "above"}`}
      style={style}
      onMouseDown={(event) => event.preventDefault()}
    >
      <section className="selection-push-group image">
        <div className="selection-push-group-title">
          <Icon name="image" size={13} />
          <span>图片生成</span>
        </div>
        <div className="selection-push-group-actions">
          <button type="button" className="selection-push-jump" title="带入图片提示词并跳转" onClick={() => onPushImage(true)}>
            <Icon name="send" size={12} />
            送入并跳转
          </button>
          <button type="button" className="selection-push-stay" title="追加到图片提示词，留在当前页面" onClick={() => onPushImage(false)}>
            <Icon name="plus" size={12} />
            继续选择
          </button>
        </div>
      </section>
      <section className="selection-push-group video">
        <div className="selection-push-group-title">
          <Icon name="video" size={13} />
          <span>视频生成</span>
          {!hasVideoModels && <small>请先启用模型</small>}
        </div>
        <div className="selection-push-group-actions">
          <button type="button" className="selection-push-jump" title={hasVideoModels ? "带入视频提示词并跳转" : "请先在模型库启用视频模型"} disabled={!hasVideoModels} onClick={() => onPushVideo(true)}>
            <Icon name="send" size={12} />
            送入并跳转
          </button>
          <button type="button" className="selection-push-stay" title={hasVideoModels ? "追加到视频提示词，留在当前页面" : "请先在模型库启用视频模型"} disabled={!hasVideoModels} onClick={() => onPushVideo(false)}>
            <Icon name="plus" size={12} />
            继续选择
          </button>
        </div>
      </section>
    </div>
  );
}
