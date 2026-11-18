'use client';

import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { filterModelLibraryProviders, nextModelLibraryProviderValue } from './model-library-provider-picker-logic';
import type { ModelLibraryProviderOption } from './model-library-provider-picker-logic';

type ModelLibraryProviderPickerProps = {
  providers: ModelLibraryProviderOption[];
  value: string | null;
  onChange: (value: string | null) => void;
};

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export default function ModelLibraryProviderPicker({ providers, value, onChange }: ModelLibraryProviderPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedValue, setHighlightedValue] = useState('');
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionListId = 'model-library-provider-options';
  const filteredProviders = useMemo(() => filterModelLibraryProviders(providers, query), [providers, query]);
  const selected = providers.find((provider) => provider.id === value);
  const visibleValues = ['', ...filteredProviders.map((provider) => provider.id)];

  function updatePosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const width = Math.min(window.innerWidth - margin * 2, Math.max(320, Math.min(400, rect.width)));
    const availableAbove = Math.max(0, rect.top - margin - gap);
    const availableBelow = Math.max(0, window.innerHeight - rect.bottom - margin - gap);
    const openAbove = availableAbove >= 240 || availableAbove > availableBelow;
    const maxHeight = Math.max(120, Math.min(420, openAbove ? availableAbove : availableBelow));
    const preferredLeft = rect.left + width > window.innerWidth - margin ? rect.right - width : rect.left;
    const left = Math.min(Math.max(margin, preferredLeft), Math.max(margin, window.innerWidth - width - margin));
    setMenuStyle({
      position: 'fixed',
      visibility: 'visible',
      left: Math.round(left),
      width: Math.round(width),
      maxHeight: Math.round(maxHeight),
      top: openAbove ? 'auto' : Math.round(rect.bottom + gap),
      bottom: openAbove ? Math.round(window.innerHeight - rect.top + gap) : 'auto',
    });
  }

  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(updatePosition);
    const handleViewportChange = () => updatePosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, providers.length]);

  useEffect(() => {
    if (!open) return;
    const focusFrame = window.requestAnimationFrame(() => searchRef.current?.focus());
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [open]);

  function openPicker(initialHighlight = value || '') {
    setQuery('');
    setHighlightedValue(initialHighlight);
    setMenuStyle({ visibility: 'hidden' });
    setOpen(true);
  }

  function choose(nextValue: string) {
    onChange(nextValue || null);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveHighlight(direction: 1 | -1) {
    setHighlightedValue((current) => nextModelLibraryProviderValue(visibleValues, current, direction));
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(highlightedValue);
    }
  }

  const triggerLabel = selected
    ? `默认厂商：${selected.name}，${selected.availableModelCount} 个可用模型`
    : '默认厂商：自动，不指定厂商';

  return <div className={`model-picker model-library-provider-picker ${open ? 'open' : ''}`} ref={rootRef}>
    <button
      ref={triggerRef}
      type="button"
      className={`model-picker-trigger ${open ? 'open' : ''}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={triggerLabel}
      data-tooltip={triggerLabel}
      onClick={() => open ? setOpen(false) : openPicker()}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        openPicker(event.key === 'ArrowDown' ? (value || '') : nextModelLibraryProviderValue(['', ...providers.map((provider) => provider.id)], value || '', -1));
      }}
    >
      <span className="model-picker-trigger-copy"><b>默认</b><span>{selected?.name || '自动 · 不指定厂商'}</span></span><i aria-hidden="true" />
    </button>
    {open && typeof document !== 'undefined' && createPortal(<div
      ref={panelRef}
      className="model-picker-panel model-library-provider-panel"
      style={menuStyle}
      role="dialog"
      aria-label="选择默认厂商"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerCancel={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="model-picker-panel-head"><div><strong>选择默认厂商</strong><small>{providers.length} 家厂商 · 按名称或 ID 搜索</small></div><button type="button" onClick={() => { setOpen(false); triggerRef.current?.focus(); }} aria-label="关闭">×</button></div>
      <label className="model-picker-search model-library-provider-search"><span aria-hidden="true">⌕</span><input
        ref={searchRef}
        value={query}
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          setHighlightedValue(filterModelLibraryProviders(providers, nextQuery)[0]?.id || '');
        }}
        onKeyDown={handleSearchKeyDown}
        role="combobox"
        aria-haspopup="listbox"
        aria-label="搜索厂商"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls={optionListId}
        aria-activedescendant={`model-library-provider-option-${encodeURIComponent(highlightedValue || 'auto')}`}
        placeholder="搜索厂商名称或 ID"
      /><kbd>Esc</kbd>{query && <button type="button" aria-label="清空搜索" onClick={() => { setQuery(''); setHighlightedValue(value || ''); searchRef.current?.focus(); }}>×</button>}</label>
      <div className="model-library-provider-list" id={optionListId} role="listbox" aria-label="可用厂商">
        <button type="button" role="option" id="model-library-provider-option-auto" aria-selected={!value} className={`model-library-provider-option ${!value ? 'selected' : ''} ${highlightedValue === '' ? 'highlighted' : ''}`} onMouseEnter={() => setHighlightedValue('')} onClick={() => choose('')}>
          <span><strong>自动 · 不指定厂商</strong><small>按可用模型自动回退</small></span><b>自动</b>{!value && <i aria-hidden="true">✓</i>}
        </button>
        {filteredProviders.map((provider) => <button
          type="button"
          role="option"
          id={`model-library-provider-option-${encodeURIComponent(provider.id)}`}
          aria-selected={provider.id === value}
          className={`model-library-provider-option ${provider.id === value ? 'selected' : ''} ${highlightedValue === provider.id ? 'highlighted' : ''}`}
          key={provider.id}
          onMouseEnter={() => setHighlightedValue(provider.id)}
          onClick={() => choose(provider.id)}
        ><span><strong>{provider.name}</strong><small>{provider.id}</small></span><b>{provider.availableModelCount} 个可用模型</b>{provider.id === value && <i aria-hidden="true">✓</i>}</button>)}
        {!filteredProviders.length && <div className="model-picker-empty">没有找到匹配的厂商</div>}
      </div>
    </div>, document.body)}
  </div>;
}
