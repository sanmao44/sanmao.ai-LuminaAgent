'use client';

import { createPortal } from 'react-dom';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CANVAS_Z_INDEX } from '@/lib/canvas/layers';

export type SelectMenuOption<T extends string | number> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  deletable?: boolean;
};

type Props<T extends string | number> = {
  value: T;
  options: SelectMenuOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  menuClassName?: string;
  portalZIndex?: number;
  disabled?: boolean;
  onDelete?: (value: T) => void;
};

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export default function SelectMenu<T extends string | number>({ value, options, onChange, ariaLabel, className = '', menuClassName = '', portalZIndex = CANVAS_Z_INDEX.portalPopover, disabled = false, onDelete }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [menuStyle, setMenuStyle] = useState<Record<string, string | number>>({
    position: 'fixed',
    visibility: 'hidden',
    left: 0,
    top: 0,
    right: 'auto',
    bottom: 'auto',
    width: 0,
  });
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
      const width = Math.round(rect.width);
      const viewportPadding = 8;
      const left = Math.max(
        viewportPadding,
        Math.min(Math.round(rect.left), window.innerWidth - width - viewportPadding),
      );
      const below = window.innerHeight - rect.bottom - gap;
      const above = rect.top - gap;
      const openAbove = below < 180 && above > below;
      const available = Math.max(64, Math.min(maxHeight, openAbove ? above : below));
      setMenuStyle({
        position: 'fixed',
        visibility: 'visible',
        left,
        right: 'auto',
        width,
        maxHeight: available,
        ...(openAbove ? { bottom: Math.round(window.innerHeight - rect.top + gap), top: 'auto' } : { top: Math.round(rect.bottom + gap), bottom: 'auto' }),
      });
    }
    let firstFrame = 0;
    let secondFrame = 0;
    positionMenu();
    firstFrame = window.requestAnimationFrame(() => {
      positionMenu();
      secondFrame = window.requestAnimationFrame(positionMenu);
    });
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
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(positionMenu)
      : null;
    if (triggerRef.current) resizeObserver?.observe(triggerRef.current);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      resizeObserver?.disconnect();
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [open, value]);

  function openMenu() {
    setMenuStyle({
      position: 'fixed',
      visibility: 'hidden',
      left: 0,
      top: 0,
      right: 'auto',
      bottom: 'auto',
      width: 0,
    });
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
      {selected?.icon && <span className="select-menu-trigger-icon" aria-hidden="true">{selected.icon}</span>}
      <span className="select-menu-trigger-copy">{selected?.label || '请选择'}</span>
      <span className="select-menu-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && typeof document !== 'undefined' && createPortal(<div ref={menuRef} id={menuId} style={{ ...menuStyle, zIndex: portalZIndex }} className={`select-menu-popover ${menuClassName}`.trim()} role="listbox" aria-label={ariaLabel} tabIndex={-1} onPointerDown={(event) => event.stopPropagation()} onPointerMove={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()} onPointerCancel={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} onKeyDown={handleMenuKeyDown}>
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
        {option.icon && <span className="select-menu-option-icon" aria-hidden="true">{option.icon}</span>}
        <span className="select-menu-option-copy"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
        {option.deletable && onDelete && (
          <span
            className="select-menu-option-delete"
            role="button"
            tabIndex={0}
            aria-label={`删除${String(option.label)}`}
            title="删除集合"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDelete(option.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              onDelete(option.value);
            }}
          >
            ×
          </span>
        )}
        {option.value === value && <span className="select-menu-check" aria-hidden="true">✓</span>}
      </button>)}
    </div>, document.body)}
  </div>;
}
