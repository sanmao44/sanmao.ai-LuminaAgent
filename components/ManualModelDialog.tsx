"use client";

import type { ComponentType, FormEvent } from "react";
import type { ManualModelAudioTask } from "@/packages/contracts/model-library";
import type { ModelKind } from "@/lib/types";

export type ManualModelKind = "auto" | Extract<ModelKind, "chat" | "image" | "video" | "audio" | "3d">;

export type ManualModelFormState = {
  rawId: string;
  displayName: string;
  kind: ManualModelKind;
  audioTask: ManualModelAudioTask;
};

type ManualModelDialogIcon = ComponentType<{ name: string; size?: number }>;

export type ManualModelDialogProps = {
  providerName: string;
  form: ManualModelFormState;
  busy: boolean;
  Icon: ManualModelDialogIcon;
  onChange: (patch: Partial<ManualModelFormState>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

export default function ManualModelDialog({
  providerName,
  form,
  busy,
  Icon,
  onChange,
  onClose,
  onSubmit,
}: ManualModelDialogProps) {
  return (
    <div className="dialog-backdrop manual-model-dialog-backdrop">
      <form className="manual-model-dialog" onClick={(event) => event.stopPropagation()} onSubmit={onSubmit}>
        <div className="manual-model-dialog-head">
          <div>
            <span>模型登记</span>
            <h2>{`为 ${providerName} 添加模型`}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="关闭" aria-label="关闭手动登记模型">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="manual-model-fields">
          <label>
            <span>模型 ID</span>
            <input
              autoFocus
              required
              value={form.rawId}
              onChange={(event) => onChange({ rawId: event.target.value })}
              placeholder="例如 gpt-image-2-pro"
            />
          </label>
          <label>
            <span>显示名称（可选）</span>
            <input
              value={form.displayName}
              onChange={(event) => onChange({ displayName: event.target.value })}
              placeholder="留空使用模型 ID"
            />
          </label>
          <div className="manual-model-kind-field">
            <span>模型类型</span>
            <div className="segmented manual-model-kind">
              <button type="button" className={form.kind === "auto" ? "active" : ""} onClick={() => onChange({ kind: "auto" })}>自动识别</button>
              <button type="button" className={form.kind === "chat" ? "active" : ""} onClick={() => onChange({ kind: "chat" })}>对话</button>
              <button type="button" className={form.kind === "image" ? "active" : ""} onClick={() => onChange({ kind: "image" })}>图片</button>
              <button type="button" className={form.kind === "video" ? "active" : ""} onClick={() => onChange({ kind: "video" })}>视频</button>
              <button type="button" className={form.kind === "audio" ? "active" : ""} onClick={() => onChange({ kind: "audio" })}>音频</button>
              <button type="button" className={form.kind === "3d" ? "active" : ""} onClick={() => onChange({ kind: "3d" })}>三维</button>
            </div>
          </div>
          {form.kind === "audio" && (
            <div className="manual-model-kind-field">
              <span>音频用途</span>
              <div className="segmented manual-model-kind manual-model-audio-task" aria-label="音频模型用途">
                <button type="button" className={form.audioTask === "speech" ? "active" : ""} onClick={() => onChange({ audioTask: "speech" })}>配音</button>
                <button type="button" className={form.audioTask === "music-generate" ? "active" : ""} onClick={() => onChange({ audioTask: "music-generate" })}>音乐生成</button>
                <button type="button" className={form.audioTask === "transcription" ? "active" : ""} onClick={() => onChange({ audioTask: "transcription" })}>语音转写</button>
              </div>
            </div>
          )}
        </div>
        <div className="manual-model-notice">
          <Icon name="agent" size={16} />
          <p>手动登记只添加模型 ID 并按所选类型补齐通用能力；模型是否支持对应任务取决于上游模型和接口。登记后仍需启用并发布，服务商拒绝或不支持时会显示错误，不会自动替换成其他模型。</p>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary-action" onClick={onClose}>取消</button>
          <button type="submit" className="primary-action compact" disabled={busy}>{busy ? "登记中…" : "登记模型"}</button>
        </div>
      </form>
    </div>
  );
}
