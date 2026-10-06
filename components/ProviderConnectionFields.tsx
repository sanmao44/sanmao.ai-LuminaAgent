"use client";

import type { ComponentType } from "react";

import AgnesConnectionGuide from "@/components/AgnesConnectionGuide";

export type ProviderConnectionFieldsProps = {
  name: string;
  baseUrl: string;
  apiKey: string;
  platform: string;
  needsBaseUrl: boolean;
  presetBaseUrl: string;
  editing: boolean;
  videoBaseUrl: string;
  savedBaseUrl: string;
  savedVideoBaseUrl: string;
  savedKeyMasked: string;
  testResult: string;
  Icon?: ComponentType<{ name: string; size?: number }>;
  onNameChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onUseDomesticEndpoint: () => void;
};

/** Renders the active provider connection fields; Page owns draft and API state. */
export default function ProviderConnectionFields({
  name,
  baseUrl,
  apiKey,
  platform,
  needsBaseUrl,
  presetBaseUrl,
  editing,
  videoBaseUrl,
  savedBaseUrl,
  savedVideoBaseUrl,
  savedKeyMasked,
  testResult,
  onNameChange,
  onBaseUrlChange,
  onApiKeyChange,
  onUseDomesticEndpoint,
}: ProviderConnectionFieldsProps) {
  return (
    <>
      <label className="wide provider-name-field">
        <span>连接名称（可选）</span>
        <input value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="例如：主接口 / 备用接口" />
        <small>只用于列表识别，修改名称不会影响接口配置。</small>
      </label>
      {needsBaseUrl ? (
        <label className="wide">
          <span>2. API 地址</span>
          <input value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} placeholder="粘贴服务商控制台提供的 API 地址" />
          <small>可以粘贴根地址或完整接口地址，系统会自动整理。</small>
        </label>
      ) : (
        <div className="provider-fixed-url wide">
          <span>API 地址（已内置）</span>
          <strong>{baseUrl || presetBaseUrl}</strong>
          <small>{platform === "agnes" && baseUrl && baseUrl !== presetBaseUrl ? "当前保留已选 Agnes 区域地址；请让它与 API Key 所属站点一致。" : "官方地址已经内置，无需填写。"}</small>
        </div>
      )}
      <label className="wide">
        <span>{needsBaseUrl ? "3" : "2"}. API Key</span>
        <input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
          placeholder={editing ? "留空表示继续使用原密钥" : "粘贴服务商提供的 API Key"}
        />
        <small>密钥会加密保存在本机服务端，网页不会再次显示完整内容。</small>
      </label>
      {platform === "agnes" && (
        <AgnesConnectionGuide
          baseUrl={baseUrl}
          videoBaseUrl={videoBaseUrl}
          savedBaseUrl={savedBaseUrl}
          savedVideoBaseUrl={savedVideoBaseUrl}
          savedKeyMasked={savedKeyMasked}
          hasDraftKey={Boolean(apiKey.trim())}
          testResult={testResult}
          onUseDomesticEndpoint={onUseDomesticEndpoint}
        />
      )}
    </>
  );
}
