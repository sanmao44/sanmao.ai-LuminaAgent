"use client";

import type { ComponentType } from "react";

export type ProviderListToolbarProps = {
  search: string;
  visibleCount: number;
  totalCount: number;
  Icon: ComponentType<{ name: string; size?: number }>;
  onSearchChange: (value: string) => void;
};

/** Presents provider search and result counts; filtering remains page-owned. */
export default function ProviderListToolbar({ search, visibleCount, totalCount, Icon, onSearchChange }: ProviderListToolbarProps) {
  return (
    <div className="provider-list-toolbar surface">
      <label className="provider-search-box">
        <Icon name="search" size={15} />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索名称、平台或接口地址…"
          aria-label="搜索接口服务商"
        />
        {search && (
          <button type="button" onClick={() => onSearchChange("")} aria-label="清空服务商搜索">
            ×
          </button>
        )}
      </label>
      <span>
        显示 <b>{visibleCount}</b> / {totalCount} 个
      </span>
    </div>
  );
}
