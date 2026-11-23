'use client';

import { createPortal } from 'react-dom';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CANVAS_Z_INDEX } from '@/lib/canvas/layers';
import { CANVAS_NODE_EDITOR_OVERLAY_POSITION_EVENT } from '@/components/canvas/overlay-events';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';
import { findMiniMaxSystemVoice, getMiniMaxSystemVoices, searchMiniMaxSystemVoices } from '@/packages/contracts/minimax-system-voices';
import VoiceSampleButton from '@/components/audio/VoiceSampleButton';
import './MiniMaxVoicePicker.css';

type Props = {
  model: string;
  providerKey: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

const QUICK_LIMIT = 6;
const RECENT_VOICE_KEY = 'sanmao.minimax.recent-voices.v1';
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function readRecentVoiceIds(providerKey: string): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(`${RECENT_VOICE_KEY}:${providerKey}`) || '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, QUICK_LIMIT) : [];
  } catch {
    return [];
  }
}

export default function MiniMaxVoicePicker({ model, providerKey, value, onChange, disabled = false }: Props) {
  const inputId = useId();
  const quickPanelId = useId();
  const dialogId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const quickPanelRef = useRef<HTMLDivElement>(null);
  const dialogSearchRef = useRef<HTMLInputElement>(null);
  const dialogListRef = useRef<HTMLDivElement>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('all');
  const [recentVoiceIds, setRecentVoiceIds] = useState<string[]>([]);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden', left: 0, top: 0, width: 0 });

  useBodyScrollLock(dialogOpen);

  const voices = useMemo(() => getMiniMaxSystemVoices(providerKey), [providerKey]);
  const selected = useMemo(() => findMiniMaxSystemVoice(value, providerKey), [value, providerKey]);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const voice of voices) counts.set(voice.languageLabel, (counts.get(voice.languageLabel) || 0) + 1);
    const preferred = ['中文（普通话）', '中文（粤语）', '英语'];
    const remaining = [...counts.keys()].filter((item) => !preferred.includes(item)).sort((left, right) => left.localeCompare(right, 'zh-CN'));
    return [
      { id: 'all', label: '全部音色', count: voices.length },
      ...[...preferred.filter((item) => counts.has(item)), ...remaining].map((label) => ({ id: label, label, count: counts.get(label) || 0 })),
    ];
  }, [voices]);
  const filteredVoices = useMemo(() => searchMiniMaxSystemVoices(query, providerKey).filter((voice) => language === 'all' || voice.languageLabel === language), [language, query, providerKey]);
  const quickVoices = useMemo(() => {
    const resolvedRecent = recentVoiceIds.map((id) => findMiniMaxSystemVoice(id, providerKey)).filter((voice) => voice !== undefined);
    const recent = [...new Map(resolvedRecent.map((voice) => [voice.voiceId, voice])).values()];
    const defaults = voices.filter((voice) => voice.languageLabel === '中文（普通话）').slice(0, QUICK_LIMIT);
    const base = recent.length ? recent : defaults;
    return [...(selected && !base.some((voice) => voice.voiceId === selected.voiceId) ? [selected] : []), ...base].slice(0, QUICK_LIMIT);
  }, [recentVoiceIds, selected, voices, providerKey]);

  useEffect(() => setRecentVoiceIds(readRecentVoiceIds(providerKey)), [providerKey]);

  useEffect(() => {
    if (!disabled && selected && selected.voiceId !== value) onChange(selected.voiceId);
  }, [disabled, selected, value, onChange]);

  function restoreTriggerFocus() {
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function closeQuick() {
    setQuickOpen(false);
    restoreTriggerFocus();
  }

  function closeDialog() {
    setDialogOpen(false);
    setQuery('');
    setLanguage('all');
    restoreTriggerFocus();
  }

  function updateQuickPosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const width = Math.min(window.innerWidth - margin * 2, Math.max(320, Math.min(420, rect.width)));
    const above = Math.max(0, rect.top - margin - gap);
    const below = Math.max(0, window.innerHeight - rect.bottom - margin - gap);
    const openAbove = above >= 240 || above > below;
    const maxHeight = Math.max(150, Math.min(430, openAbove ? above : below));
    const preferredLeft = rect.left + width > window.innerWidth - margin ? rect.right - width : rect.left;
    const left = Math.min(Math.max(margin, preferredLeft), Math.max(margin, window.innerWidth - width - margin));
    setMenuStyle({ position: 'fixed', visibility: 'visible', left: Math.round(left), width: Math.round(width), maxHeight: Math.round(maxHeight), top: openAbove ? 'auto' : Math.round(rect.bottom + gap), bottom: openAbove ? Math.round(window.innerHeight - rect.top + gap) : 'auto' });
  }

  useIsomorphicLayoutEffect(() => {
    if (!quickOpen) return;
    const frame = window.requestAnimationFrame(updateQuickPosition);
    const syncPosition = () => updateQuickPosition();
    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', syncPosition, true);
    window.addEventListener(CANVAS_NODE_EDITOR_OVERLAY_POSITION_EVENT, syncPosition);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('scroll', syncPosition, true);
      window.removeEventListener(CANVAS_NODE_EDITOR_OVERLAY_POSITION_EVENT, syncPosition);
    };
  }, [quickOpen]);

  useEffect(() => {
    if (!quickOpen && !dialogOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (dialogOpen) closeDialog(); else closeQuick();
    };
    const closeQuickOnOutsidePointer = (event: PointerEvent) => {
      if (!quickOpen) return;
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target) && !quickPanelRef.current?.contains(target)) setQuickOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeQuickOnOutsidePointer);
    if (dialogOpen) window.requestAnimationFrame(() => dialogSearchRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeQuickOnOutsidePointer);
    };
  }, [dialogOpen, quickOpen]);

  function openDialog() {
    setQuickOpen(false);
    setQuery('');
    setLanguage('all');
    setDialogOpen(true);
  }

  function chooseVoice(voiceId: string) {
    onChange(voiceId);
    if (voices.some((voice) => voice.voiceId === voiceId)) {
      const next = [voiceId, ...recentVoiceIds.filter((id) => id !== voiceId)].slice(0, QUICK_LIMIT);
      setRecentVoiceIds(next);
      try { window.localStorage.setItem(`${RECENT_VOICE_KEY}:${providerKey}`, JSON.stringify(next)); } catch { /* Local preference is optional. */ }
    }
    setQuickOpen(false);
    setDialogOpen(false);
    setQuery('');
    setLanguage('all');
    restoreTriggerFocus();
  }

  function trapDialogTab(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [role="button"], [tabindex]:not([tabindex="-1"])')]
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

  function focusVoiceChoice(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const choices = [...(dialogListRef.current?.querySelectorAll<HTMLButtonElement>('[data-minimax-voice-choice]') || [])];
    if (!choices.length) return;
    const current = choices.indexOf(event.target as HTMLButtonElement);
    const next = event.key === 'ArrowDown'
      ? choices[(current + 1 + choices.length) % choices.length]
      : choices[(current <= 0 ? choices.length : current) - 1];
    event.preventDefault();
    next?.focus();
  }

  function renderVoice(voice: (typeof voices)[number]) {
    const isSelected = voice.voiceId === selected?.voiceId;
    return <div className={`minimax-voice-option${isSelected ? ' is-selected' : ''}`} key={voice.voiceId}>
      <button type="button" className="minimax-voice-option-main" data-minimax-voice-choice onClick={() => chooseVoice(voice.voiceId)} aria-pressed={isSelected}>
        <span className="minimax-voice-option-copy"><strong>{voice.name}</strong><small>{voice.languageLabel}</small></span>
        {isSelected && <b className="minimax-voice-check" aria-label="当前选中">✓</b>}
      </button>
      <span className="minimax-voice-sample"><VoiceSampleButton model={model} voice={voice.voiceId} providerKey={providerKey} compact /></span>
    </div>;
  }

  const currentLabel = selected ? `${selected.name} · ${selected.languageLabel}` : value ? '自备音色' : '选择音色';
  const quickLabel = recentVoiceIds.length ? '最近使用' : '普通话快捷选择';
  const quickPanel = quickOpen && typeof document !== 'undefined' ? createPortal(
    <div
      ref={quickPanelRef}
      id={quickPanelId}
      className="minimax-voice-quick-panel"
      style={{ ...menuStyle, zIndex: CANVAS_Z_INDEX.portalPopover }}
      role="dialog"
      aria-label="快速选择音色"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="minimax-voice-panel-head"><div><strong>快速选择</strong><small>{currentLabel}</small></div><button type="button" onClick={closeQuick} aria-label="关闭音色选择">×</button></div>
      <div className="minimax-voice-quick-list"><div className="minimax-voice-section-title"><span>{quickLabel}</span><small>{quickVoices.length} 个</small></div>{quickVoices.map(renderVoice)}</div>
      <button type="button" className="minimax-voice-browse-all" onClick={openDialog}>浏览全部 {voices.length} 个音色 <span aria-hidden="true">→</span></button>
    </div>,
    document.body,
  ) : null;

  const fullDialog = dialogOpen && typeof document !== 'undefined' ? createPortal(
    <div
      className="minimax-voice-dialog-backdrop"
      style={{ zIndex: CANVAS_Z_INDEX.modelDialog }}
      role="presentation"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.currentTarget === event.target) closeDialog();
      }}
    >
      <section id={dialogId} className="minimax-voice-dialog" role="dialog" aria-modal="true" aria-labelledby={`${dialogId}-title`} tabIndex={-1} onKeyDown={trapDialogTab}>
        <div className="minimax-voice-dialog-head"><div><strong id={`${dialogId}-title`}>选择音色</strong><small>MiniMax 系统音色 · {voices.length} 个{providerKey === 'cangyuan' ? ' · 官方参考样音，试听不消耗额度' : ''}</small></div><button type="button" className="minimax-voice-dialog-close" onClick={closeDialog} aria-label="关闭音色选择">×</button></div>
        <label className="minimax-voice-dialog-search"><span aria-hidden="true">⌕</span><input ref={dialogSearchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索音色名称或语言" aria-label="搜索音色名称或语言" />{query && <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>×</button>}</label>
        <div className="minimax-voice-dialog-body">
          <aside className="minimax-voice-category-list" aria-label="按语言分类">
            {categories.map((category) => <button key={category.id} type="button" className={language === category.id ? 'is-active' : ''} aria-pressed={language === category.id} onClick={() => setLanguage(category.id)}><span>{category.label}</span><b>{category.count}</b></button>)}
          </aside>
          <main className="minimax-voice-dialog-main">
            <div className="minimax-voice-dialog-summary"><strong>{filteredVoices.length} 个音色</strong><span>{language === 'all' ? '所有语言' : language}{query.trim() ? ` · 搜索“${query.trim()}”` : ''}</span></div>
            <div ref={dialogListRef} className="minimax-voice-dialog-list" aria-label="音色列表" onKeyDown={focusVoiceChoice}>
              {filteredVoices.map(renderVoice)}
              {!filteredVoices.length && <p className="minimax-voice-empty">没有找到匹配的音色。试试其他音色名称或切换语言分类；克隆音色可在音色管理中选择。</p>}
            </div>
          </main>
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  return <div ref={rootRef} className="minimax-voice-picker">
    <button ref={triggerRef} type="button" className={`minimax-voice-picker-trigger${quickOpen || dialogOpen ? ' is-open' : ''}`} id={inputId} onClick={() => {
      if (dialogOpen) closeDialog();
      else setQuickOpen((current) => !current);
    }} aria-haspopup="dialog" aria-expanded={quickOpen || dialogOpen} aria-controls={dialogOpen ? dialogId : quickOpen ? quickPanelId : undefined} disabled={disabled}>
      <span className="minimax-voice-picker-trigger-copy"><strong>{currentLabel}</strong></span><i aria-hidden="true" />
    </button>
    {value && !selected && <small className="minimax-voice-picker-custom-note">当前使用自备或已登记音色</small>}
    {quickPanel}
    {fullDialog}
  </div>;
}
