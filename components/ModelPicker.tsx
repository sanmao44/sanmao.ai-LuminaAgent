'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ModelCapability, RegistryModel } from '@/lib/types';
import { getFavoriteModelIds, getRecentModelIds, setModelFavorite, subscribeModelPreferences } from '@/lib/model-preferences';
import { selectAutomaticModel } from '@/lib/model-selection';

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
  chat: '??',
  generate: '??',
  edit: '??',
  upscale: '??',
  reference: '???',
  vision: '??',
  typography: '??',
  'web-search': '??',
};

const capabilityClasses: Partial<Record<ModelCapability, string>> = {
  chat: 'chat',
  generate: 'generate',
  edit: 'edit',
  upscale: 'upscale',
};

function modelMatches(model: RegistryModel, query: string) {
  if (!query) return true;
  return `${model.displayName} ${model.rawId} ${model.providerName}`.toLowerCase().includes(query.toLowerCase());
}

export function uniqueModels(models: Array<RegistryModel | null | undefined>) {
  return [...new Map(
    models
      .filter((model): model is RegistryModel => Boolean(model))
      .map((model) => [model.id, model]),
  ).values()];
}

export default function ModelPicker({ models, value, onChange, capability, defaultProviderId, defaultProviderName, defaultModelId, placeholder = '????', className = '' }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const availableModels = useMemo(() => models.filter((model) => model.enabled && model.published && model.capabilities.includes(capability)), [models, capability]);
  const selected = value !== 'auto' ? availableModels.find((model) => model.id === value) : null;
  const autoModel = selectAutomaticModel(availableModels, defaultProviderId, defaultModelId);
  const filteredModels = useMemo(() => availableModels.filter((model) => modelMatches(model, query.trim())), [availableModels, query]);
  const recentModels = useMemo(() => uniqueModels(recent.map((id) => availableModels.find((model) => model.id === id)).filter((model): model is RegistryModel => Boolean(model && modelMatches(model, query.trim())))), [availableModels, recent, query]);
  const favoriteModels = useMemo(() => uniqueModels(favorites.map((id) => availableModels.find((model) => model.id === id)).filter((model): model is RegistryModel => Boolean(model && modelMatches(model, query.trim())))), [availableModels, favorites, query]);
  const recommendedModels = useMemo(() => uniqueModels([autoModel, ...availableModels.filter((model) => model.id !== autoModel?.id).slice(0, 3)]).filter((model) => modelMatches(model, query.trim())), [availableModels, autoModel, query]);
  const providerGroups = useMemo(() => {
    const groups = new Map<string, RegistryModel[]>();
    for (const model of filteredModels) groups.set(model.providerId, [...(groups.get(model.providerId) || []), model]);
    return [...groups.entries()].sort(([, left], [, right]) => left[0].providerName.localeCompare(right[0].providerName, 'zh-CN'));
  }, [filteredModels]);

  useEffect(() => {
    const sync = () => { setFavorites(getFavoriteModelIds()); setRecent(getRecentModelIds()); };
    sync();
    return subscribeModelPreferences(sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    if (next && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const height = Math.min(560, Math.max(320, window.innerHeight * 0.72));
      setMenuStyle({ left: rect.left, width: Math.max(280, rect.width), top: rect.bottom + 7, maxHeight: height, ...(rect.bottom + height + 12 > window.innerHeight ? { top: Math.max(8, rect.top - height - 7) } : {}) });
    }
    setOpen(next);
    if (!next) setQuery('');
  }

  function choose(modelId: string) {
    onChange(modelId);
    setOpen(false);
    setQuery('');
  }

  function toggleFavorite(modelId: string) {
    setModelFavorite(modelId, !favorites.includes(modelId));
  }

  function renderModel(model: RegistryModel) {
    const isFavorite = favorites.includes(model.id);
    const isSelected = model.id === value;
    return <div className={`model-picker-option ${isSelected ? 'selected' : ''}`} key={model.id}>
      <button type="button" className="model-picker-option-main" onClick={() => choose(model.id)} role="option" aria-selected={isSelected}>
        <span className="model-picker-option-copy"><strong>{model.displayName}</strong><small>{model.providerName} ? {model.rawId}</small><span className="model-picker-capabilities">{model.capabilities.filter((item) => capabilityLabels[item]).slice(0, 4).map((item) => <em className={capabilityClasses[item] || ''} key={item}>{capabilityLabels[item]}</em>)}</span></span>
        {isSelected && <b className="model-picker-check">?</b>}
      </button>
      <button type="button" className={`model-picker-favorite ${isFavorite ? 'active' : ''}`} aria-label={isFavorite ? `???? ${model.displayName}` : `?? ${model.displayName}`} onClick={() => toggleFavorite(model.id)}>?</button>
    </div>;
  }

  const triggerLabel = selected
    ? `?? ? ${selected.providerName} ? ${selected.displayName}`
    : autoModel
      ? `?? ? ${defaultProviderName || '????'} ? ${autoModel.displayName}`
      : placeholder;

  return <div className={`model-picker ${className}`} ref={rootRef}>
    <button ref={triggerRef} type="button" className={`model-picker-trigger ${open ? 'open' : ''}`} onClick={toggle} aria-haspopup="dialog" aria-expanded={open} data-tooltip={triggerLabel}>
      <span className="model-picker-trigger-copy"><b>{value === 'auto' ? '??' : '??'}</b><span>{triggerLabel.replace(/^(??|??) ? /, '')}</span></span><i aria-hidden="true"/>
    </button>
    {open && <div className="model-picker-panel" style={menuStyle} role="dialog" aria-label="????">
      <div className="model-picker-panel-head"><div><strong>????</strong><small>{capabilityLabels[capability] || '????'} ? ?????????????</small></div><button type="button" onClick={() => setOpen(false)} aria-label="??">?</button></div>
      <label className="model-picker-search"><span>?</span><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="??????? ID ?????"/><kbd>Esc</kbd></label>
      <div className="model-picker-scroll">
        <section className="model-picker-section model-picker-auto-section"><div className="model-picker-section-title"><span>????</span><small>?????????</small></div><button type="button" className={`model-picker-auto ${value === 'auto' ? 'selected' : ''}`} onClick={() => choose('auto')}><span><strong>????</strong><small>{defaultProviderName ? `?????${defaultProviderName}` : '??????????????'}{autoModel ? ` ? ???? ${autoModel.displayName}` : ''}</small></span>{value === 'auto' && <b className="model-picker-check">?</b>}</button>{recommendedModels.filter((model) => model.id !== autoModel?.id).map(renderModel)}</section>
        {recentModels.length > 0 && <section className="model-picker-section"><div className="model-picker-section-title"><span>????</span><small>?????????</small></div>{recentModels.map(renderModel)}</section>}
        {favoriteModels.length > 0 && <section className="model-picker-section"><div className="model-picker-section-title"><span>????</span><small>?????</small></div>{favoriteModels.map(renderModel)}</section>}
        {providerGroups.length > 0 && <section className="model-picker-section"><div className="model-picker-section-title"><span>??????</span><small>{filteredModels.length} ?????</small></div>{providerGroups.map(([providerId, group]) => <div className="model-picker-provider" key={providerId}><div className="model-picker-provider-title"><b>{group[0].providerName}</b><small>{group.length} ???</small></div>{group.map(renderModel)}</div>)}</section>}
        {!filteredModels.length && <div className="model-picker-empty">???????{capabilityLabels[capability] || '????'}????</div>}
      </div>
    </div>}
  </div>;
}
