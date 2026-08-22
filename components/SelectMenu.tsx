'use client';

import { createPortal } from 'react-dom';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type SelectMenuOption<T extends string | number> = {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

type Props<T extends string | number> = {
  value: T;
  options: SelectMenuOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  menuClassName?: string;
  disabled?: boolean;
};

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export default function SelectMenu<T extends string | number>({ value, options, onChange, ariaLabel, className = '', menuClassName = '', disabled = false }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [menuStyle, setMenuStyle] = useState<Record<string, string | number>>({ visibility: 'hidden' });
  const selected = options.find((option) => option.value === value) || options[0];
  const enabledOptions = useMemo(() => options.filter((option) => !option.disabled), [options]);

  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    setHighlighted(value);
    function positionMenu() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 8;
      const maxHeight = 310;
      const below = window.innerHeight - rect.bottom - gap;
      const above = rect.top - gap;
      const openAbove = below < 180 && above > below;
      const available = Math.max(150, Math.min(maxHeight, openAbove ? above : below));
      setMenuStyle({
        position: 'fixed',
        visibility: 'visible',
        left: Math.round(rect.left),
        right: 'auto',
        width: Math.round(rect.width),
        maxHeight: available,
        ...(openAbove ? { bottom: Math.round(window.innerHeight - rect.top + gap), top: 'auto' } : { top: Math.round(rect.bottom + gap), bottom: 'auto' }),
      });
    }
    positionMenu();
    menuRef.current?.focus({ preventScroll: true });
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [open, value]);

  function openMenu() {
    setMenuStyle({ visibility: 'hidden' });
    setOpen(true);
  }

  function toggleMenu() {
    if (open) setOpen(false);
    else openMenu();
  }

  function moveHighlight(direction: 1 | -1) {
    if (!enabledOptions.length) return;
    const currentIndex = Math.max(0, enabledOptions.findIndex((option) => option.value === highlighted));
    const nextIndex = (currentIndex + direction + enabledOptions.length) % enabledOptions.length;
    setHighlighted(enabledOptions[nextIndex].value);
  }

  function choose(nextValue: T) {
    const option = options.find((item) => item.value === nextValue);
    if (!option || option.disabled) return;
    onChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openMenu();
      moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleMenu();
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(highlighted);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  return <div ref={rootRef} className={`select-menu ${open ? 'open' : ''} ${className}`.trim()}>
    <button
      ref={triggerRef}
      type="button"
      className="select-menu-trigger"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={menuId}
      disabled={disabled || !selected}
      onClick={toggleMenu}
      onKeyDown={handleTriggerKeyDown}
    >
      <span className="select-menu-trigger-copy">{selected?.label || '请选择'}</span>
      <span className="select-menu-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && typeof document !== 'undefined' && createPortal(<div ref={menuRef} id={menuId} style={menuStyle} className={`select-menu-popover ${menuClassName}`.trim()} role="listbox" aria-label={ariaLabel} tabIndex={-1} onKeyDown={handleMenuKeyDown}>
      {options.map((option) => <button
        type="button"
        role="option"
        aria-selected={option.value === value}
        disabled={option.disabled}
        key={String(option.value)}
        className={`select-menu-option ${option.value === value ? 'selected' : ''} ${option.value === highlighted ? 'highlighted' : ''}`.trim()}
        onMouseEnter={() => !option.disabled && setHighlighted(option.value)}
        onClick={() => choose(option.value)}
      >
        <span className="select-menu-option-copy"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
        {option.value === value && <span className="select-menu-check" aria-hidden="true">✓</span>}
      </button>)}
    </div>, document.body)}
  </div>;
}
