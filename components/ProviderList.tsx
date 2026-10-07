"use client";

import type { ComponentType } from "react";

import { isProviderModelLibraryEnabled } from "@/lib/provider-availability";
import { isManualModelProvider, providerPlatformLabel, providerTypeLabel } from "@/lib/provider-presentation";
import type { ProviderConnection } from "@/lib/types";

type ProviderIcon = ComponentType<{ name: string; size?: number }>;

export type ProviderListProps = {
  providers: ProviderConnection[];
  editingProviderId: string | null;
  syncingProviderId: string | null;
  Icon: ProviderIcon;
  onToggleModelLibrary: (provider: ProviderConnection) => void | Promise<void>;
  onOpenManualModelDialog: (provider: ProviderConnection) => void;
  onOpenEdit: (provider: ProviderConnection) => void;
  onSync: (providerId: string) => void | Promise<void>;
  onDelete: (providerId: string) => void;
};

/** Displays the already-filtered provider connections; Page owns provider mutations and API calls. */
export default function ProviderList({
  providers,
  editingProviderId,
  syncingProviderId,
  Icon,
  onToggleModelLibrary,
  onOpenManualModelDialog,
  onOpenEdit,
  onSync,
  onDelete,
}: ProviderListProps) {
  return (
    <div className="provider-list">
      {providers.map((provider) => {
        const modelLibraryEnabled = isProviderModelLibraryEnabled(provider);
        const isEditing = editingProviderId === provider.id;
        return (
          <article
            key={provider.id}
            className={`provider-card surface ${isEditing ? "editing" : ""}`}
            aria-current={isEditing || undefined}
          >
            <div className="provider-logo">{providerPlatformLabel(provider.platform).slice(0, 2)}</div>
            <div className="provider-content">
              <div>
                <strong>{provider.name}</strong>
                <span className="provider-platform">{providerPlatformLabel(provider.platform)}</span>
                {provider.platform === "agnes" && (
                  <span className={`provider-credential-badge ${provider.credentialVerifiedAt ? "verified" : "unverified"}`}>
                    {provider.credentialVerifiedAt ? "上次验证通过" : "待验证 Key"}
                  </span>
                )}
                <span className={`provider-status ${provider.status}`}>
                  {provider.status === "healthy" ? "连接正常" : provider.status === "error" ? "连接异常" : "待读取"}
                </span>
                <label
                  className="provider-library-toggle"
                  title={modelLibraryEnabled ? "取消后隐藏并停用该服务商模型；不会清除模型勾选状态" : "加入模型库并恢复该服务商模型的上次勾选状态"}
                >
                  <input
                    type="checkbox"
                    aria-label={`${modelLibraryEnabled ? "隐藏" : "加入"} ${provider.name} 的模型库`}
                    checked={modelLibraryEnabled}
                    onChange={() => void onToggleModelLibrary(provider)}
                  />
                  <span>{modelLibraryEnabled ? "已加入模型库" : "已隐藏"}</span>
                </label>
                {isEditing && (
                  <span className="provider-editing-badge">
                    <Icon name="edit" size={10} />
                    正在编辑
                  </span>
                )}
              </div>
              <p>
                {providerTypeLabel(provider.type)} · {provider.baseUrl}
              </p>
              <small>
                密钥 {provider.maskedKey} · 已选择 {provider.enabledModelCount} 个模型 · 最近读取 {provider.lastSyncedAt || "—"}
              </small>
            </div>
            <div className="provider-card-actions">
              <button
                type="button"
                disabled={!isManualModelProvider(provider)}
                onClick={() => onOpenManualModelDialog(provider)}
                title="手动登记模型"
              >
                手动添加模型
              </button>
              <button type="button" onClick={() => onOpenEdit(provider)}>
                修改
              </button>
              <button type="button" onClick={() => void onSync(provider.id)} disabled={syncingProviderId === provider.id}>
                {syncingProviderId === provider.id ? "读取中…" : "重新读取模型"}
              </button>
              <button type="button" className="danger" onClick={() => onDelete(provider.id)}>
                删除
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
