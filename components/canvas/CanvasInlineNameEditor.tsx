"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

export type CanvasInlineNameEditorProps = {
  value?: string;
  fallback: string;
  ariaLabel: string;
  onCommit?: (value: string) => void;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  className?: string;
  style?: CSSProperties;
  inputClassName?: string;
  placeholder?: string;
};

export default function CanvasInlineNameEditor({
  value,
  fallback,
  ariaLabel,
  onCommit,
  editing: controlledEditing,
  onEditingChange,
  className,
  style,
  inputClassName,
  placeholder,
}: CanvasInlineNameEditorProps) {
  const [localEditing, setLocalEditing] = useState(false);
  const [draft, setDraft] = useState(() => String(value || ""));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const committedRef = useRef(false);
  const cancelledRef = useRef(false);
  const editing = controlledEditing ?? localEditing;
  const displayValue = String(value || fallback);

  const changeEditing = useCallback((next: boolean) => {
    if (controlledEditing === undefined) setLocalEditing(next);
    onEditingChange?.(next);
  }, [controlledEditing, onEditingChange]);

  useEffect(() => {
    if (!editing) {
      setDraft(String(value || ""));
      return;
    }
    committedRef.current = false;
    cancelledRef.current = false;
    setDraft(String(value || ""));
  }, [editing, value]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const finish = useCallback((nextValue: string) => {
    if (committedRef.current || cancelledRef.current) return;
    committedRef.current = true;
    // Release the native input before the controlled editor unmounts. This
    // prevents a stale browser focus ring and returns the next interaction to
    // the canvas surface.
    inputRef.current?.blur();
    changeEditing(false);
    onCommit?.(nextValue);
  }, [changeEditing, onCommit]);

  const startEditing = useCallback(() => {
    if (!onCommit) return;
    committedRef.current = false;
    cancelledRef.current = false;
    setDraft(String(value || ""));
    changeEditing(true);
  }, [changeEditing, onCommit, value]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    committedRef.current = true;
    setDraft(String(value || ""));
    inputRef.current?.blur();
    changeEditing(false);
  }, [changeEditing, value]);

  const stopPointer = (event: ReactPointerEvent<HTMLElement>) => event.stopPropagation();
  const stopClick = (event: ReactMouseEvent<HTMLElement>) => event.stopPropagation();

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        className={inputClassName || "canvas-inline-name-editor-input"}
        value={draft}
        maxLength={48}
        placeholder={placeholder || fallback}
        aria-label={ariaLabel}
        onPointerDown={stopPointer}
        onClick={stopClick}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            finish(draft);
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        onBlur={() => finish(draft)}
      />
    );
  }

  return (
    <span
      className={className || "canvas-inline-name-editor"}
      style={style}
      role={onCommit ? "button" : undefined}
      tabIndex={onCommit ? 0 : undefined}
      aria-label={ariaLabel}
      title={onCommit ? "双击或按 Enter 重命名" : displayValue}
      onPointerDown={onCommit ? stopPointer : undefined}
      onClick={onCommit ? stopClick : undefined}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        startEditing();
      }}
      onKeyDown={onCommit ? (event) => {
        if (event.key !== "Enter" && event.key !== "F2") return;
        event.preventDefault();
        event.stopPropagation();
        startEditing();
      } : undefined}
    >
      {displayValue}
    </span>
  );
}
