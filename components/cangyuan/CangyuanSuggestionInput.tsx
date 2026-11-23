'use client';

import { createPortal } from 'react-dom';
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CANVAS_Z_INDEX } from '@/lib/canvas/layers';
import { CANVAS_NODE_EDITOR_OVERLAY_POSITION_EVENT } from '@/components/canvas/overlay-events';
import styles from './CangyuanSuggestionInput.module.css';

export type CangyuanSuggestionOption = string | { value: string; label: string };

export function getCangyuanSuggestionWireValue(options: readonly CangyuanSuggestionOption[], input: string, multiple = false): string {
  const normalized = options.map((option) => typeof option === 'string' ? { value: option, label: option } : option);
  const resolve = (item: string) => normalized.find((option) => option.label === item)?.value ?? item;
  return multiple ? input.split(/[,，]/u).map((item) => resolve(item.trim())).join(',') : resolve(input);
}

type Props = {
  value: string;
  options: readonly CangyuanSuggestionOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  inputMode?: 'text' | 'decimal' | 'numeric';
  minLength?: number;
  maxLength?: number;
  multiple?: boolean;
};

export default function CangyuanSuggestionInput({ value, options, onChange, ariaLabel, placeholder, inputMode = 'text', minLength, maxLength, multiple = false }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<Record<string, string | number>>({
    position: 'fixed',
    visibility: 'hidden',
    left: 0,
    top: 0,
    width: 0,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const listId = `${id}-list`;
  const normalizedOptions = options.map((option) => typeof option === 'string' ? { value: option, label: option } : option);
  const valueParts = multiple ? value.split(',').map((item) => item.trim()) : [value];
  const currentValue = valueParts[valueParts.length - 1] || '';
  const selectedOption = normalizedOptions.find((option) => option.value === currentValue);
  const displayValue = valueParts.map((item) => normalizedOptions.find((option) => option.value === item)?.label ?? item).join(', ');
  const query = (multiple ? displayValue.split(',').at(-1) || '' : displayValue).trim().toLowerCase();
  const filteredOptions = selectedOption ? normalizedOptions : normalizedOptions.filter((option) =>
    option.label.toLowerCase().includes(query) || option.value.toLowerCase().includes(query));

  useLayoutEffect(() => {
    if (!open) return;
    function positionMenu() {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 6;
      const padding = 8;
      const below = window.innerHeight - rect.bottom - gap;
      const above = rect.top - gap;
      const openAbove = below < 150 && above > below;
      setMenuStyle({
        position: 'fixed',
        visibility: 'visible',
        left: Math.max(padding, Math.min(Math.round(rect.left), window.innerWidth - rect.width - padding)),
        width: Math.min(Math.round(rect.width), window.innerWidth - padding * 2),
        maxHeight: Math.max(64, Math.min(280, openAbove ? above : below)),
        ...(openAbove
          ? { bottom: Math.round(window.innerHeight - rect.top + gap), top: 'auto' }
          : { top: Math.round(rect.bottom + gap), bottom: 'auto' }),
      });
    }
    positionMenu();
    const frame = window.requestAnimationFrame(positionMenu);
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    window.addEventListener(CANVAS_NODE_EDITOR_OVERLAY_POSITION_EVENT, positionMenu);
    const resizeObserver = typeof ResizeObserver !== 'undefined' && rootRef.current
      ? new ResizeObserver(positionMenu)
      : null;
    if (rootRef.current) resizeObserver?.observe(rootRef.current);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
      window.removeEventListener(CANVAS_NODE_EDITOR_OVERLAY_POSITION_EVENT, positionMenu);
      resizeObserver?.disconnect();
    };
  }, [open]);

  function showSuggestions() {
    setActiveIndex(filteredOptions.findIndex((option) => option.value === currentValue));
    setMenuStyle({ position: 'fixed', visibility: 'hidden', left: 0, top: 0, width: 0 });
    setOpen(true);
    inputRef.current?.focus();
  }

  function choose(option: string) {
    onChange(multiple ? [...valueParts.filter((item) => item && item !== option), option].join(',') : option);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        showSuggestions();
        setActiveIndex(event.key === 'ArrowDown' ? 0 : Math.max(0, filteredOptions.length - 1));
        return;
      }
      if (!filteredOptions.length) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => current < 0
        ? direction === 1 ? 0 : filteredOptions.length - 1
        : (current + direction + filteredOptions.length) % filteredOptions.length);
    } else if (event.key === 'Enter' && open) {
      if (activeIndex >= 0 && filteredOptions[activeIndex]) {
        event.preventDefault();
        choose(filteredOptions[activeIndex].value);
      } else {
        event.preventDefault();
        setOpen(false);
      }
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className={`${styles.control} ${open ? styles.open : ''}`}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && (rootRef.current?.contains(nextTarget) || menuRef.current?.contains(nextTarget))) return;
        setOpen(false);
      }}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode={inputMode}
        minLength={minLength}
        maxLength={maxLength}
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        value={displayValue}
        onChange={(event) => {
          const entered = event.target.value;
          onChange(getCangyuanSuggestionWireValue(options, entered, multiple));
          if (!open) setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
      <button
        type="button"
        aria-label={`${open ? '收起' : '显示'}${ariaLabel}建议`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => open ? setOpen(false) : showSuggestions()}
      >
        <span aria-hidden="true">⌄</span>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          id={listId}
          className={styles.menu}
          style={{ ...menuStyle, zIndex: CANVAS_Z_INDEX.portalPopover }}
          role="listbox"
          aria-label={`${ariaLabel}建议`}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {filteredOptions.length ? filteredOptions.map((option, index) => (
            <div
              id={`${listId}-${index}`}
              key={option.value}
              role="option"
              aria-selected={option.value === currentValue}
              className={`${styles.option} ${index === activeIndex ? styles.active : ''} ${option.value === currentValue ? styles.selected : ''}`.trim()}
              onMouseEnter={() => setActiveIndex(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(option.value)}
            >
              <span>{option.label}</span>
              {option.value === currentValue && <span aria-hidden="true">✓</span>}
            </div>
          )) : <div className={styles.empty}>无匹配建议，可直接输入</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}
