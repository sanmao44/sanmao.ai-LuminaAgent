"use client";

import type { ComponentType } from "react";

import type { ProviderPreset } from "@/lib/provider-presets";

export type ProviderPlatformPickerProps = {
  presets: ProviderPreset[];
  selectedPlatform: string;
  Icon: ComponentType<{ name: string; size?: number }>;
  onSelect: (platform: string) => void;
};

/** Presents provider presets; the page keeps preset application and draft state. */
export default function ProviderPlatformPicker({ presets, selectedPlatform, Icon, onSelect }: ProviderPlatformPickerProps) {
  return (
    <div className="platform-picker">
      <div className="platform-picker-head">
        <span>1. 选择服务商</span>
        <small>New API、One API 和自建中转，请选“其他兼容平台”</small>
      </div>
      <div>
        {presets.map((preset) => (
          <div className="platform-option" key={preset.value}>
            <button
              type="button"
              className={selectedPlatform === preset.value ? "active" : ""}
              onClick={() => onSelect(preset.value)}
            >
              <b className={preset.logo ? "platform-logo" : ""}>
                {preset.logo ? <img src={preset.logo} alt="" /> : preset.short.slice(0, 2)}
              </b>
              <span>
                <strong>{preset.label}</strong>
                <small>{preset.description}</small>
              </span>
              <em>{preset.recommended ? "推荐" : preset.needsBaseUrl ? "填地址" : "地址已内置"}</em>
              {selectedPlatform === preset.value && <Icon name="check" size={14} />}
            </button>
            {preset.apiKeyUrl && (
              <a
                className="platform-key-link"
                href={preset.apiKeyUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                ↗ 获取 API Key
              </a>
            )}
            {preset.notice && <span className={`platform-notice ${preset.noticeTone === "success" ? "success" : ""}`}>{preset.notice}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
