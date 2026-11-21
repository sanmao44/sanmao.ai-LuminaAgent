'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import type { ModelCapability, RegistryModel } from '@/lib/types';
import type { AgentModelHealthRecord } from '@/lib/agent/model-health';
import { getFavoriteModelIds, getRecentModelIds, setModelFavorite, subscribeModelPreferences } from '@/lib/model-preferences';
import { selectAutomaticModel } from '@/lib/model-selection';
import { MODEL_PICKER_QUICK_LIMIT, modelPickerMatches, modelPickerModelIsAvailable, modelSupportsCapabilityRequirements, takeUniqueModelSlice } from '@/lib/model-picker';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';
import { CANVAS_Z_INDEX } from '@/lib/canvas/layers';
import { isInternalIntentModel } from '@/lib/intent-classifier';
import { CANVAS_NODE_EDITOR_OVERLAY_POSITION_EVENT } from '@/components/canvas/overlay-events';

type ModelPickerProps = {
  models: RegistryModel[];
  value: string;
  onChange: (value: string) => void;
  capability: ModelCapability | readonly ModelCapability[];
  defaultProviderId?: string | null;
  defaultProviderName?: string;
  defaultModelId?: string | null;
  placeholder?: string;
  className?: string;
  portalZIndex?: number;
  dialogPortalZIndex?: number;
  /** Some workflows have a capability-aware automatic policy without changing the global default model. */
  automaticMode?: 'default' | 'clone';
  automaticHint?: string;
  /** Optional context label for compact, task-specific pickers. */
  triggerPrefix?: string;
  triggerLabelMode?: 'full' | 'model';
  health?: AgentModelHealthRecord[];
  disabled?: boolean;
};

const capabilityLabels: Partial<Record<ModelCapability, string>> = {
  chat: '对话', generate: '生图', edit: '改图', upscale: '超分', reference: '参考图', vision: '视觉', typography: '文字', 'web-search': '联网',
  'video-generate': '视频', 'video-edit': '视频编辑', 'video-extend': '视频续写', 'video-first-frame': '首尾帧', 'video-reference': '视频参考', 'video-audio': '音频', speech: '配音', transcription: '转写',
  'music-generate': '音乐', 'sound-effect': '音效', 'audio-conversation': '音频对话', 'voice-conversion': '变声', 'audio-isolation': '人声分离', '3d-generate': '三维',
};

const capabilityClasses: Partial<Record<ModelCapability, string>> = {
  chat: 'chat',
  generate: 'generate',
  edit: 'edit',
  upscale: 'upscale',
  'video-generate': 'video',
  'video-edit': 'video-edit',
  'video-extend': 'video-extend',
  'video-first-frame': 'video-first-frame',
  'video-reference': 'video-reference',
  'video-audio': 'video-audio',
  speech: 'speech',
  'music-generate': 'music',
  'sound-effect': 'sound-effect',
  'audio-conversation': 'audio-conversation',
  'voice-conversion': 'voice-conversion',
  'audio-isolation': 'audio-isolation',
  '3d-generate': 'three-dimensional',
};

export function modelCapabilityLabel(capability: ModelCapability) {
  return capabilityLabels[capability];
}
export function uniqueModels(models: Array<RegistryModel | null | undefined>) {
  return [...new Map(models.filter((model): model is RegistryModel => Boolean(model)).map((model) => [model.id, model])).values()];
}

export function resolveModelPickerTriggerValueLabel(input: {
  mode: 'full' | 'model';
  fullLabel: string;
  modelLabel?: string;
  unavailableLabel?: string;
  value: string;
  automaticModelLabel?: string;
}) {
  if (input.mode === 'full') return input.fullLabel;
  return input.modelLabel
    || input.unavailableLabel
    || (input.value === 'auto' ? input.automaticModelLabel : undefined)
    || input.fullLabel;
}

export function modelPickerKeyboardAction(key: string): 'previous' | 'next' | 'first' | 'last' | 'activate' | 'close' | null {
  if (key === 'ArrowUp') return 'previous';
  if (key === 'ArrowDown') return 'next';
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  if (key === 'Enter' || key === ' ') return 'activate';
  if (key === 'Escape') return 'close';
  return null;
}

export function modelPickerKeyboardTarget(action: 'previous' | 'next' | 'first' | 'last', currentIndex: number, itemCount: number) {
  if (itemCount < 1) return -1;
  if (action === 'first') return 0;
  if (action === 'last') return itemCount - 1;
  if (action === 'next') return currentIndex < 0 ? 0 : (currentIndex + 1) % itemCount;
  return currentIndex < 0 ? itemCount - 1 : (currentIndex - 1 + itemCount) % itemCount;
}

export function modelPickerKeyboardActivationTarget(activeChoice: string, visibleChoiceIds: readonly string[]) {
  if (visibleChoiceIds.includes(activeChoice)) return activeChoice;
  return visibleChoiceIds[0] || null;
}

function selectCloneAutomaticModel(models: RegistryModel[]) {
  const candidates = models.filter((model) => model.capabilities.includes('video-generate'));
  const score = (model: RegistryModel) => {
    const name = `${model.id} ${model.rawId} ${model.displayName}`;
    const isSeedance = /seedance/iu.test(name);
    const hasReference = model.capabilities.includes('video-reference');
    const hasFirstFrame = model.capabilities.includes('video-first-frame');
    // Keep this aligned with the server policy: Seedance is the main clone
    // candidate, but a model that cannot carry references should lose to a
    // compatible alternative. This is not the global video default.
    return (hasReference ? 600 : 0)
      + (isSeedance ? 400 : 0)
      + (hasFirstFrame ? 10 : 0);
  };
  return [...candidates].sort((left, right) => score(right) - score(left))[0];
}

export default function ModelPicker({
  models,
  value,
  onChange,
  capability,
  defaultProviderId,
  defaultProviderName,
  defaultModelId,
  placeholder = '选择模型',
  className = '',
  portalZIndex = CANVAS_Z_INDEX.portalPopover,
  dialogPortalZIndex = CANVAS_Z_INDEX.modelDialog,
  automaticMode = 'default',
  automaticHint,
  triggerPrefix,
  triggerLabelMode = 'full',
  health = [],
  disabled = false,
}: ModelPickerProps) {
  const requiredCapabilities: readonly ModelCapability[] = typeof capability === 'string' ? [capability] : capability;
  const capabilityLabel = requiredCapabilities.map((item) => capabilityLabels[item] || item).join(' + ');
  const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
  const [quickOpen, setQuickOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogQuery, setDialogQuery] = useState('');
  const [dialogProviderId, setDialogProviderId] = useState('all');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const [quickActiveChoice, setQuickActiveChoice] = useState('__auto__');
  const [dialogActiveChoice, setDialogActiveChoice] = useState('__auto__');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const quickPanelRef = useRef<HTMLDivElement | null>(null);
  const quickListRef = useRef<HTMLDivElement | null>(null);
  const dialogListRef = useRef<HTMLDivElement | null>(null);
  const dialogSearchRef = useRef<HTMLInputElement | null>(null);
  const quickPanelId = useId();
  const dialogId = useId();

  // The quick picker is an anchored, scrollable popover. Locking the page for
  // it removes the viewport scrollbar and shifts fixed conversation chrome by
  // one gutter width. Only the full-screen model browser needs modal scroll
  // locking; the quick picker already tracks page scrolling while it is open.
  useBodyScrollLock(dialogOpen);

  const availableModels = useMemo(() => models.filter((model) => modelPickerModelIsAvailable(model, requiredCapabilities, isInternalIntentModel)), [models, capability]);
  const healthByModel = useMemo(() => new Map(health.map((item) => [item.modelId, item])), [health]);
  const selected = value !== 'auto' ? availableModels.find((model) => model.id === value) : null;
  const unavailableSelectedModel = value && value !== 'auto' && !selected
    ? models.find((model) => model.id === value)
    : undefined;
  const autoModel = automaticMode === 'clone' && requiredCapabilities.length === 1 && requiredCapabilities[0] === 'video-generate'
    ? selectCloneAutomaticModel(availableModels)
    : selectAutomaticModel(availableModels, defaultProviderId, defaultModelId);
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
  const quickShowsAll = availableModels.length <= 8;
  const quickModels = quickShowsAll ? availableModels.filter((model) => model.id !== autoModel?.id) : [];
  const quickChoiceIds = useMemo(() => ['__auto__', ...(quickShowsAll ? quickModels : [
    ...quickModelGroups.recommended,
    ...quickModelGroups.recent,
    ...quickModelGroups.favorites,
  ]).map((model) => model.id)], [quickModelGroups, quickModels, quickShowsAll]);
  const dialogChoiceIds = useMemo(() => [
    ...(dialogProviderId === 'all' && !dialogQuery.trim() ? ['__auto__'] : []),
    ...dialogModels.map((model) => model.id),
  ], [dialogModels, dialogProviderId, dialogQuery]);
  const effectiveQuickActiveChoice = quickChoiceIds.includes(quickActiveChoice) ? quickActiveChoice : quickChoiceIds.includes(value) ? value : quickChoiceIds[0];
  const effectiveDialogActiveChoice = dialogChoiceIds.includes(dialogActiveChoice) ? dialogActiveChoice : dialogChoiceIds.includes(value) ? value : dialogChoiceIds[0];

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
    const maxHeight = Math.max(64, Math.min(420, openAbove ? availableAbove : availableBelow));
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
    window.addEventListener(CANVAS_NODE_EDITOR_OVERLAY_POSITION_EVENT, handleViewportChange);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener(CANVAS_NODE_EDITOR_OVERLAY_POSITION_EVENT, handleViewportChange);
    };
  }, [quickOpen, availableModels.length, recentModels.length, favoriteModels.length]);

  useEffect(() => {
    if (!quickOpen && !dialogOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (modelPickerKeyboardAction(event.key) !== 'close') return;
      if (dialogOpen) closeDialog(); else closeQuick();
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

  useEffect(() => {
    if (!quickOpen) return;
    requestAnimationFrame(() => quickListRef.current?.querySelector<HTMLElement>('[data-model-picker-choice="__auto__"]')?.focus());
  }, [quickOpen]);

  function focusChoiceInList(event: ReactKeyboardEvent<HTMLDivElement>, listRef: RefObject<HTMLDivElement | null>) {
    const action = modelPickerKeyboardAction(event.key);
    if (action !== 'next' && action !== 'previous' && action !== 'first' && action !== 'last') return;
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-model-picker-choice]') : null;
    if (!target || target.matches('[data-model-picker-favorite]')) return;
    const choices = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-model-picker-choice]') || [])];
    const currentIndex = choices.indexOf(target);
    if (currentIndex < 0) return;
    event.preventDefault();
    const next = choices[modelPickerKeyboardTarget(action, currentIndex, choices.length)];
    if (next) {
      if (listRef === quickListRef) setQuickActiveChoice(next.dataset.modelPickerChoice || '__auto__');
      else setDialogActiveChoice(next.dataset.modelPickerChoice || '__auto__');
      next.focus();
    }
  }

  function restoreTriggerFocus() {
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function closeQuick() {
    setQuickOpen(false);
    restoreTriggerFocus();
  }

  function closeDialog() {
    setDialogOpen(false);
    restoreTriggerFocus();
  }

  function trapDialogTab(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.tabIndex >= 0 && element.offsetParent !== null);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

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
    setDialogActiveChoice('__auto__');
    setDialogOpen(true);
  }

  function choose(modelId: string) {
    onChange(modelId);
    setQuickOpen(false);
    setDialogOpen(false);
    setDialogQuery('');
    restoreTriggerFocus();
  }

  function toggleFavorite(modelId: string) {
    setModelFavorite(modelId, !favorites.includes(modelId));
  }

  function renderModel(model: RegistryModel, scope: 'quick' | 'dialog') {
    const isFavorite = favorites.includes(model.id);
    const isSelected = model.id === value;
    const activeChoice = scope === 'quick' ? effectiveQuickActiveChoice : effectiveDialogActiveChoice;
    const modelHealth = healthByModel.get(model.id);
    const healthLabel = modelHealth?.state === 'cooldown'
      ? '暂时跳过'
      : modelHealth?.consecutiveFailures
        ? `${modelHealth.consecutiveFailures} 次失败`
        : modelHealth?.lastLatencyMs
          ? `${Math.round(modelHealth.lastLatencyMs / 100) / 10}s`
          : '';
    return <div className={`model-picker-option ${isSelected ? 'selected' : ''}`} key={model.id} role={scope === 'dialog' ? 'listitem' : 'group'}>
      <button type="button" className="model-picker-option-main" onClick={() => choose(model.id)} aria-pressed={isSelected} data-model-picker-choice={model.id} tabIndex={activeChoice === model.id ? 0 : -1} onFocus={() => scope === 'quick' ? setQuickActiveChoice(model.id) : setDialogActiveChoice(model.id)}>
        <span className="model-picker-option-copy"><strong>{model.displayName}</strong><small>{model.providerName} · {model.rawId}</small><span className="model-picker-capabilities">{model.capabilities.filter((item) => modelCapabilityLabel(item)).slice(0, 4).map((item) => <em className={capabilityClasses[item] || ''} key={item}>{modelCapabilityLabel(item)}</em>)}{healthLabel && <em className={`model-picker-health ${modelHealth?.state || ''}`}>{healthLabel}</em>}</span></span>
        {isSelected && <b className="model-picker-check">✓</b>}
      </button>
      <button type="button" className={`model-picker-favorite ${isFavorite ? 'active' : ''}`} aria-label={isFavorite ? `取消收藏 ${model.displayName}` : `收藏 ${model.displayName}`} aria-pressed={isFavorite} data-model-picker-favorite onClick={() => toggleFavorite(model.id)}>★</button>
    </div>;
  }

  function renderAutoChoice(scope: 'quick' | 'dialog') {
    const activeChoice = scope === 'quick' ? effectiveQuickActiveChoice : effectiveDialogActiveChoice;
    const autoHealth = autoModel ? healthByModel.get(autoModel.id) : undefined;
    const autoHealthHint = autoHealth?.state === 'cooldown'
      ? '当前推荐暂时不可用，自动模式会跳过并尝试其他模型'
      : autoHealth?.consecutiveFailures
        ? `最近 ${autoHealth.consecutiveFailures} 次失败，自动模式会优先尝试其他模型`
        : '';
    return <button type="button" className={`model-picker-auto ${value === 'auto' ? 'selected' : ''}`} onClick={() => choose('auto')} aria-pressed={value === 'auto'} data-model-picker-choice="__auto__" tabIndex={activeChoice === '__auto__' ? 0 : -1} onFocus={() => scope === 'quick' ? setQuickActiveChoice('__auto__') : setDialogActiveChoice('__auto__')}>
      <span><strong>{automaticMode === 'clone' ? '自动选择（克隆策略）' : '自动选择'}</strong><small>{autoHealthHint || automaticHint || (defaultProviderName ? `默认厂商：${defaultProviderName}` : '使用默认厂商，失败时自动回退')}{autoModel ? ` · 当前推荐 ${autoModel.displayName}` : ''}</small></span>
      {value === 'auto' && <b className="model-picker-check">✓</b>}
    </button>;
  }

  const triggerLabel = selected
    ? `${triggerPrefix || '手动'} · ${selected.providerName} · ${selected.displayName}`
    : unavailableSelectedModel
      ? `${triggerPrefix || '手动'} · ${unavailableSelectedModel.enabled && unavailableSelectedModel.published && !modelSupportsCapabilityRequirements(unavailableSelectedModel, requiredCapabilities) ? `不支持${capabilityLabel}` : '模型不可用'} · ${unavailableSelectedModel.displayName}`
      : value && value !== 'auto'
        ? `${triggerPrefix || '手动'} · 所选模型不可用`
        : autoModel
      ? `${triggerPrefix || '自动'} · ${automaticMode === 'clone' ? '克隆主要使用 Seedance' : defaultProviderName || '默认厂商'} · ${autoModel.displayName}`
      : placeholder;
  const fullTriggerValueLabel = triggerPrefix && triggerLabel.startsWith(`${triggerPrefix} · `)
    ? triggerLabel.slice(triggerPrefix.length + 3)
    : triggerLabel.replace(/^(自动|手动|生图|换模型) · /, '');
  const unavailableLabel = unavailableSelectedModel
    ? `${unavailableSelectedModel.enabled && unavailableSelectedModel.published && !modelSupportsCapabilityRequirements(unavailableSelectedModel, requiredCapabilities) ? `不支持${capabilityLabel}` : '模型不可用'} · ${unavailableSelectedModel.displayName}`
    : value && value !== 'auto'
      ? '所选模型不可用'
      : undefined;
  const triggerValueLabel = resolveModelPickerTriggerValueLabel({
    mode: triggerLabelMode,
    fullLabel: fullTriggerValueLabel,
    modelLabel: selected?.displayName,
    unavailableLabel,
    value,
    automaticModelLabel: autoModel?.displayName,
  });
  const triggerAccessibleLabel = triggerLabelMode === 'model' ? triggerValueLabel : triggerLabel;
  const fullDialog = dialogOpen && typeof document !== 'undefined' ? createPortal(
    <div
      className="model-picker-dialog-backdrop"
      style={{ zIndex: dialogPortalZIndex }}
      role="presentation"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerCancel={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.currentTarget === event.target) closeDialog();
      }}
    >
      <section id={dialogId} className="model-picker-dialog" role="dialog" aria-modal="true" aria-labelledby={`${dialogId}-title`} tabIndex={-1} onKeyDown={trapDialogTab}>
        <div className="model-picker-dialog-head"><div><strong id={`${dialogId}-title`}>浏览全部模型</strong><small>{capabilityLabel || '当前能力'} · {availableModels.length} 个可用模型</small></div><button type="button" className="model-picker-dialog-close" onClick={closeDialog} aria-label="关闭模型选择">×</button></div>
        <label className="model-picker-dialog-search"><span>⌕</span><input ref={dialogSearchRef} value={dialogQuery} onChange={(event) => setDialogQuery(event.target.value)} placeholder="搜索模型、原始 ID 或服务商…" aria-label="搜索模型" onKeyDown={(event) => {
          const action = modelPickerKeyboardAction(event.key);
          if (action === 'next' || action === 'previous') {
            const choices = dialogListRef.current?.querySelectorAll<HTMLElement>('[data-model-picker-choice]');
            if (!choices?.length) return;
            event.preventDefault();
            const preferredId = dialogChoiceIds.includes(effectiveDialogActiveChoice) ? effectiveDialogActiveChoice : dialogChoiceIds[0];
            const preferred = action === 'previous'
              ? choices[choices.length - 1]
              : [...choices].find((choice) => choice.dataset.modelPickerChoice === preferredId) || choices[0];
            preferred?.focus();
          } else if (action === 'activate') {
            const target = modelPickerKeyboardActivationTarget(effectiveDialogActiveChoice, dialogChoiceIds);
            if (target) { event.preventDefault(); choose(target); }
          }
        }}/><kbd>Esc</kbd>{dialogQuery && <button type="button" aria-label="清空搜索" onClick={() => setDialogQuery('')}>×</button>}</label>
        <div className="model-picker-dialog-body">
          <aside className="model-picker-provider-filter" aria-label="按服务商筛选"><button type="button" className={dialogProviderId === 'all' ? 'active' : ''} aria-pressed={dialogProviderId === 'all'} onClick={() => setDialogProviderId('all')}><span>全部模型</span><b>{availableModels.length}</b></button>{providerOptions.map((provider) => <button type="button" className={dialogProviderId === provider.id ? 'active' : ''} aria-pressed={dialogProviderId === provider.id} key={provider.id} onClick={() => setDialogProviderId(provider.id)}><span>{provider.name}</span><b>{provider.count}</b></button>)}</aside>
          <main className="model-picker-dialog-main">
            <div className="model-picker-dialog-summary"><strong>{dialogModels.length} 个匹配模型</strong><span>{dialogQuery.trim() ? `搜索“${dialogQuery.trim()}”` : dialogProviderId === 'all' ? '全部服务商' : providerOptions.find((provider) => provider.id === dialogProviderId)?.name}</span></div>
            <div ref={dialogListRef} className="model-picker-dialog-list" role="list" aria-label="模型列表" onKeyDown={(event) => focusChoiceInList(event, dialogListRef)}>
              {dialogProviderId === 'all' && !dialogQuery.trim() && <div className="model-picker-dialog-auto" role="listitem"><div className="model-picker-section-title"><span>推荐模型</span><small>普通情况下使用自动</small></div>{renderAutoChoice('dialog')}</div>}
              {dialogModels.map((model) => renderModel(model, 'dialog'))}
            </div>
            {!dialogModels.length && <div className="model-picker-empty">没有找到支持“{capabilityLabel || '当前任务'}”的模型</div>}
          </main>
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  const quickPanel = quickOpen && typeof document !== 'undefined' ? createPortal(
    <div
      ref={quickPanelRef}
      id={quickPanelId}
      className="model-picker-panel model-picker-quick-panel"
      style={{ ...menuStyle, zIndex: portalZIndex }}
      role="dialog"
      aria-label="快速选择模型"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerCancel={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="model-picker-panel-head"><div><strong>快速选择</strong><small>{capabilityLabel || '当前能力'} · {availableModels.length} 个可用模型</small></div><button type="button" onClick={closeQuick} aria-label="关闭模型选择">×</button></div>
      <div className="model-picker-scroll">
        <div ref={quickListRef} role="group" aria-label="快速选择模型" onKeyDown={(event) => focusChoiceInList(event, quickListRef)}>
        <section className="model-picker-section model-picker-auto-section" aria-label="推荐模型"><div className="model-picker-section-title"><span>推荐模型</span><small>普通情况下使用自动</small></div>{renderAutoChoice('quick')}{!quickShowsAll && quickModelGroups.recommended.map((model) => renderModel(model, 'quick'))}</section>
        {quickShowsAll ? <section className="model-picker-section" aria-label="全部模型"><div className="model-picker-section-title"><span>全部模型</span><small>{quickModels.length} 个模型</small></div>{quickModels.map((model) => renderModel(model, 'quick'))}</section> : <>
          {quickModelGroups.recent.length > 0 && <section className="model-picker-section" aria-label="最近调用"><div className="model-picker-section-title"><span>最近调用</span><small>{quickModelGroups.recent.length} 个常用模型</small></div>{quickModelGroups.recent.map((model) => renderModel(model, 'quick'))}</section>}
          {quickModelGroups.favorites.length > 0 && <section className="model-picker-section" aria-label="收藏模型"><div className="model-picker-section-title"><span>收藏模型</span><small>{quickModelGroups.favorites.length} 个常用模型</small></div>{quickModelGroups.favorites.map((model) => renderModel(model, 'quick'))}</section>}
        </>}
        </div>
        <button type="button" className="model-picker-browse-all" onClick={() => openDialog()}>浏览全部 {availableModels.length} 个模型 <span>→</span></button>
      </div>
    </div>,
    document.body,
  ) : null;

  return <div className={`model-picker ${className}`} ref={rootRef}>
    <button ref={triggerRef} type="button" className={`model-picker-trigger ${quickOpen || dialogOpen ? 'open' : ''}`} onClick={toggleQuick} aria-haspopup="dialog" aria-expanded={quickOpen || dialogOpen} aria-controls={dialogOpen ? dialogId : quickOpen ? quickPanelId : undefined} aria-label={triggerAccessibleLabel} data-tooltip={triggerAccessibleLabel} disabled={disabled}>
      <span className="model-picker-trigger-copy"><b>{triggerPrefix || (value === 'auto' ? '自动' : '手动')}</b><span>{triggerValueLabel}</span></span><i aria-hidden="true"/>
    </button>
    {quickPanel}
    {fullDialog}
  </div>;
}
