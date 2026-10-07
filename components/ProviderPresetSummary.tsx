"use client";

import type { ComponentType } from "react";

import type { ProviderPreset } from "@/lib/provider-presets";

export type ProviderPresetSummaryProps = {
  preset: ProviderPreset;
  Icon: ComponentType<{ name: string; size?: number }>;
};

/** Shows the selected provider's resolved preset summary; preset application remains page-owned. */
export default function ProviderPresetSummary({ preset, Icon }: ProviderPresetSummaryProps) {
  return (
    <div className="provider-auto-note">
      <Icon name="check" size={18} />
      <div>
        <strong>{preset.label}</strong>
        <span>{preset.description}</span>
        {preset.notice && <small className={`provider-preset-notice ${preset.noticeTone === "success" ? "success" : ""}`}>{preset.notice}</small>}
      </div>
      <div className="provider-auto-note-actions">
        <em>兼容参数已自动配置</em>
        {preset.apiKeyUrl && <a className="provider-key-link" href={preset.apiKeyUrl} target="_blank" rel="noreferrer">↗ 一键获取 API Key</a>}
      </div>
    </div>
  );
}
