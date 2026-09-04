"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  isValidOneTakeDuration,
  normalizeOneTakeDuration,
  ONE_TAKE_DEFAULT_DURATION,
  ONE_TAKE_MAX_DURATION,
  ONE_TAKE_MIN_DURATION,
} from "@/lib/one-take-video-duration";

type Props = {
  open: boolean;
  defaultValue?: number;
  busy?: boolean;
  onConfirm: (durationSeconds: number) => void;
  onCancel: () => void;
};

export default function OneTakeDurationPicker({
  open,
  defaultValue = ONE_TAKE_DEFAULT_DURATION,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const [value, setValue] = useState(String(normalizeOneTakeDuration(defaultValue)));
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(String(normalizeOneTakeDuration(defaultValue)));
    setError("");
    window.setTimeout(() => inputRef.current?.select(), 0);
  }, [defaultValue, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, open]);

  if (!open) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const duration = Number(value);
    if (!isValidOneTakeDuration(duration)) {
      setError(`请输入 ${ONE_TAKE_MIN_DURATION}–${ONE_TAKE_MAX_DURATION} 之间的整数`);
      inputRef.current?.focus();
      return;
    }
    onConfirm(duration);
  };

  return (
    <div
      className="one-take-duration-popover"
      role="dialog"
      aria-label="设置一镜到底时长"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <form onSubmit={submit}>
        <div className="one-take-duration-heading">
          <strong>一镜到底时长</strong>
          <span>按秒设置，默认 15 秒</span>
        </div>
        <label className="one-take-duration-input">
          <span>时长</span>
          <div>
            <input
              ref={inputRef}
              type="number"
              min={ONE_TAKE_MIN_DURATION}
              max={ONE_TAKE_MAX_DURATION}
              step="1"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError("");
              }}
              aria-label="一镜到底时长（秒）"
              disabled={busy}
            />
            <b>秒</b>
          </div>
        </label>
        {error && <small className="one-take-duration-error">{error}</small>}
        <div className="one-take-duration-actions">
          <button type="button" onClick={onCancel} disabled={busy}>取消</button>
          <button type="submit" className="primary" disabled={busy}>生成 Prompt</button>
        </div>
      </form>
    </div>
  );
}
