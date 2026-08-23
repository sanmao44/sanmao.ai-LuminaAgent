'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import type { ModelCapability, RegistryModel } from '@/lib/types';
import { getFavoriteModelIds, getRecentModelIds, setModelFavorite, subscribeModelPreferences } from '@/lib/model-preferences';
import { selectAutomaticModel } from '@/lib/model-selection';
import { MODEL_PICKER_QUICK_LIMIT, modelPickerMatches, takeUniqueModelSlice } from '@/lib/model-picker';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';

type ModelPickerProps = {
  models: RegistryModel[];
  value: string;
  onChange: (value: string) => void;
  capability: ModelCapability;
  defaultProviderId?: string | null;
  defaultProviderName?: string;
  defaultModelId?: string | null;
  placeholder?: string;
  className?: string;
};

const capabilityLabels: Partial<Record<ModelCapability, string>> = {
  chat: '对话', generate: '生图', edit: '改图', upscale: '超分', reference: '参考图', vision: '视觉', typography: '文字', 'web-search': '联网',
  'video-generate': '视频', 'video-edit': '视频编辑', 'video-extend': '视频续写', 'video-first-frame': '首尾帧', 'video-reference': '视频参考', 'video-audio': '音频',
};

const capabilityClasses: Partial<Record<ModelCapability, string>> = { chat: 'chat', generate: 'generate', edit: 'edit', upscale: 'upscale' };
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function uniqueModels(models: Array<RegistryModel | null | undefined>) {
  return [...new Map(models.filter((model): model is RegistryModel => Boolean(model)).map((model) => [model.id, model])).values()];
}

export default function ModelPicker({ models, value, onChange, capability, defaultProviderId, defaultProviderName, defaultModelId, placeholder = '选择模型', className = '' }: ModelPickerProps) {
  const [quickOpen, setQuickOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogQuery, setDialogQuery] = useState('');
  const [dialogProviderId, setDialogProviderId] = useState('all');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const quickPanelRef = useRef<HTMLDivElement | null>(null);
  const dialogSearchRef = useRef<HTMLInputElement | null>(null);

  useBodyScrollLock(quickOpen || dialogOpen);

  const availableModels = useMemo(() => models.filter((model) => model.enabled && model.published && (model.capabilities.includes(capability) || (capability.startsWith('video-') && model.kind === 'video'))), [models, capability]);
  const selected = value !== 'auto' ? availableModels.find((model) => model.id === value) : null;
  const autoModel = selectAutomaticModel(availableModels, defaultProviderId, defaultModelId);
  const recentModels = useMemo(() => uniqueModels(recent.map((id) => availableModels.find((model) => model.id === id))), [availableModels, recent]);
  const favoriteModels = useMemo(() => uniqueModels(favorites.map((id) => availableModels.find((model) => model.id === id))), [availableModels, favorites]);
  const recommendedModels = useMemo(() => uniqueModels([autoModel, ...availableModels.filter((model) => model.id !== autoModel?.id).slice(0, MODEL_PICKER_QUICK_LIMIT)]), [availableModels, autoModel]);
  const quickModelGroups = useMemo(() => {
    const seen = new Set<string>();
    return {
      recommended: takeUniqueModelSlice(recommendedModels.filter((model) => model.id !== autoModel?.id), seen),
      recent: takeUniqueModelSlice(recentModels, seen),
      favorites: takeUniqueModelSlice(favoriteModels, seen),
    };
  }, [autoModel?.id, favoriteModels, recentModels, recommendedModels]);
  const providerOptions = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; count: number }>();
    for (const model of availableModels) {
      const current = groups.get(model.providerId);
      groups.set(model.providerId, { id: model.providerId, name: model.providerName, count: (current?.count || 0) + 1 });
    }
    return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  }, [availableModels]);
  const dialogModels = useMemo(() => availableModels.filter((model) => (dialogProviderId === 'all' || model.providerId === dialogProviderId) && modelPickerMatches(model, dialogQuery)), [availableModels, dialogProviderId, dialogQuery]);

  useEffect(() => {
    const sync = () => { setFavorites(getFavoriteModelIds()); setRecent(getRecentModelIds()); };
    sync();
    return subscribeModelPreferences(sync);
  }, []);

  function updateQuickPosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const width = Math.min(window.innerWidth - margin * 2, Math.max(340, Math.min(420, rect.width)));
    const availableAbove = Math.max(0, rect.top - margin - gap);
    const availableBelow = Math.max(0, window.innerHeight - rect.bottom - margin - gap);
    const openAbove = availableAbove >= 260 || availableAbove > availableBelow;
    const maxHeight = Math.max(180, Math.min(420, openAbove ? availableAbove : availableBelow));
    const preferredLeft = rect.left + width > window.innerWidth - margin ? rect.right - width : rect.left;
    const left = Math.min(Math.max(margin, preferredLeft), Math.max(margin, window.innerWidth - width - margin));
    setMenuStyle({ visibility: 'visible', left: Math.round(left), width: Math.round(width), maxHeight: Math.round(maxHeight), top: openAbove ? 'auto' : Math.round(rect.bottom + gap), bottom: openAbove ? Math.round(window.innerHeight - rect.top + gap) : 'auto' });
  }

  useIsomorphicLayoutEffect(() => {
    if (!quickOpen) return;
    const frame = requestAnimationFrame(updateQuickPosition);
    const handleViewportChange = () => updateQuickPosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [quickOpen, availableModels.length, recentModels.length, favoriteModels.length]);

  useEffect(() => {
    if (!quickOpen && !dialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (dialogOpen) setDialogOpen(false); else setQuickOpen(false);
    };
    const closeQuickOnOutsidePointer = (event: PointerEvent) => {
      if (!quickOpen) return;
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target) && !quickPanelRef.current?.contains(target)) setQuickOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeQuickOnOutsidePointer);
    if (dialogOpen) requestAnimationFrame(() => dialogSearchRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeQuickOnOutsidePointer);
    };
  }, [dialogOpen, quickOpen]);

  function toggleQuick() {
    setDialogOpen(false);
    setQuickOpen((current) => {
      const next = !current;
      if (next) setMenuStyle({ visibility: 'hidden' });
      return next;
    });
  }

  function openDialog(initialQuery = '') {
    setQuickOpen(false);
    setDialogQuery(initialQuery);
    setDialogProviderId('all');
    setDialogOpen(true);
  }

  function choose(modelId: string) {
    onChange(modelId);
    setQuickOpen(false);
    setDialogOpen(false);
    setDialogQuery('');
  }

  function toggleFavorite(modelId: string) {
    setModelFavorite(modelId, !favorites.includes(modelId));
  }

  function renderModel(model: RegistryModel) {
    const isFavorite = favorites.includes(model.id);
    const isSelected = model.id === value;
    return <div className={`model-picker-option ${isSelected ? 'selected' : ''}`} key={model.id}>
      <button type="button" className="model-picker-option-main" onClick={() => choose(model.id)} role="option" aria-selected={isSelected}>
        <span className="model-picker-option-copy"><strong>{model.displayName}</strong><small>{model.providerName} · {model.rawId}</small><span className="model-picker-capabilities">{model.capabilities.filter((item) => capabilityLabels[item]).slice(0, 4).map((item) => <em className={capabilityClasses[item] || ''} key={item}>{capabilityLabels[item]}</em>)}</span></span>
        {isSelected && <b className="model-picker-check">✓</b>}
      </button>
      <button type="button" className={`model-picker-favorite ${isFavorite ? 'active' : ''}`} aria-label={isFavorite ? `取消收藏 ${model.displayName}` : `收藏 ${model.displayName}`} onClick={() => toggleFavorite(model.id)}>★</button>
    </div>;
  }

  function renderAutoChoice() {
    return <button type="button" className={`model-picker-auto ${value === 'auto' ? 'selected' : ''}`} onClick={() => choose('auto')}>
      <span><strong>自动选择</strong><small>{defaultProviderName ? `默认厂商：${defaultProviderName}` : '使用默认厂商，失败时自动回退'}{autoModel ? ` · 当前推荐 ${autoModel.displayName}` : ''}</small></span>
      {value === 'auto' && <b className="model-picker-check">✓</b>}
    </button>;
  }

  const triggerLabel = selected ? `手动 · ${selected.providerName} · ${selected.displayName}` : autoModel ? `自动 · ${defaultProviderName || '默认厂商'} · ${autoModel.displayName}` : placeholder;
  const quickShowsAll = availableModels.length <= 8;
  const quickModels = quickShowsAll ? availableModels.filter((model) => model.id !== autoModel?.id) : [];

  const fullDialog = dialogOpen && typeof document !== 'undefined' ? createPortal(
    <div className="model-picker-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setDialogOpen(false); }}>
      <section className="model-picker-dialog" role="dialog" aria-modal="true" aria-label="浏览全部模型">
        <div className="model-picker-dialog-head"><div><strong>浏览全部模型</strong><small>{capabilityLabels[capability] || '当前能力'} · {availableModels.length} 个可用模型</small></div><button type="button" className="model-picker-dialog-close" onClick={() => setDialogOpen(false)} aria-label="关闭">×</button></div>
        <label className="model-picker-dialog-search"><span>⌕</span><input ref={dialogSearchRef} value={dialogQuery} onChange={(event) => setDialogQuery(event.target.value)} placeholder="搜索模型、原始 ID 或服务商…"/><kbd>Esc</kbd>{dialogQuery && <button type="button" aria-label="清空搜索" onClick={() => setDialogQuery('')}>×</button>}</label>
        <div className="model-picker-dialog-body">
          <aside className="model-picker-provider-filter" aria-label="按服务商筛选"><button type="button" className={dialogProviderId === 'all' ? 'active' : ''} onClick={() => setDialogProviderId('all')}><span>全部模型</span><b>{availableModels.length}</b></button>{providerOptions.map((provider) => <button type="button" className={dialogProviderId === provider.id ? 'active' : ''} key={provider.id} onClick={() => setDialogProviderId(provider.id)}><span>{provider.name}</span><b>{provider.count}</b></button>)}</aside>
          <main className="model-picker-dialog-main">
            {dialogProviderId === 'all' && !dialogQuery.trim() && <section className="model-picker-dialog-auto"><div className="model-picker-section-title"><span>推荐模型</span><small>普通情况下使用自动</small></div>{renderAutoChoice()}</section>}
            <div className="model-picker-dialog-summary"><strong>{dialogModels.length} 个匹配模型</strong><span>{dialogQuery.trim() ? `搜索“${dialogQuery.trim()}”` : dialogProviderId === 'all' ? '全部服务商' : providerOptions.find((provider) => provider.id === dialogProviderId)?.name}</span></div>
            <div className="model-picker-dialog-list" role="listbox" aria-label="模型列表">{dialogModels.map(renderModel)}</div>
            {!dialogModels.length && <div className="model-picker-empty">没有找到支持“{capabilityLabels[capability] || '当前任务'}”的模型</div>}
          </main>
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  const quickPanel = quickOpen && typeof document !== 'undefined' ? createPortal(
    <div ref={quickPanelRef} className="model-picker-panel model-picker-quick-panel" style={menuStyle} role="dialog" aria-label="快速选择模型">
      <div className="model-picker-panel-head"><div><strong>快速选择</strong><small>{capabilityLabels[capability] || '当前能力'} · {availableModels.length} 个可用模型</small></div><button type="button" onClick={() => setQuickOpen(false)} aria-label="关闭">×</button></div>
      <div className="model-picker-scroll">
        <section className="model-picker-section model-picker-auto-section"><div className="model-picker-section-title"><span>推荐模型</span><small>普通情况下使用自动</small></div>{renderAutoChoice()}{!quickShowsAll && quickModelGroups.recommended.map(renderModel)}</section>
        {quickShowsAll ? <section className="model-picker-section"><div className="model-picker-section-title"><span>全部模型</span><small>{quickModels.length} 个模型</small></div>{quickModels.map(renderModel)}</section> : <>
          {quickModelGroups.recent.length > 0 && <section className="model-picker-section"><div className="model-picker-section-title"><span>最近调用</span><small>{quickModelGroups.recent.length} 个常用模型</small></div>{quickModelGroups.recent.map(renderModel)}</section>}
          {quickModelGroups.favorites.length > 0 && <section className="model-picker-section"><div className="model-picker-section-title"><span>收藏模型</span><small>{quickModelGroups.favorites.length} 个常用模型</small></div>{quickModelGroups.favorites.map(renderModel)}</section>}
        </>}
        <button type="button" className="model-picker-browse-all" onClick={() => openDialog()}>浏览全部 {availableModels.length} 个模型 <span>→</span></button>
      </div>
    </div>,
    document.body,
  ) : null;

  return <div className={`model-picker ${className}`} ref={rootRef}>
    <button ref={triggerRef} type="button" className={`model-picker-trigger ${quickOpen || dialogOpen ? 'open' : ''}`} onClick={toggleQuick} aria-haspopup="dialog" aria-expanded={quickOpen || dialogOpen} data-tooltip={triggerLabel}>
      <span className="model-picker-trigger-copy"><b>{value === 'auto' ? '自动' : '手动'}</b><span>{triggerLabel.replace(/^(自动|手动) · /, '')}</span></span><i aria-hidden="true"/>
    </button>
    {quickPanel}
    {fullDialog}
  </div>;
}
