'use client';

import { useEffect, useId, useRef, useState } from 'react';
import SelectMenu from './SelectMenu';
import './VideoDurationField.css';

type Props = {
  value: number;
  values: readonly number[];
  onChange: (value: number) => void;
  ariaLabel?: string;
  disabled?: boolean;
  portalZIndex?: number;
};

function durationLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (!minutes) return `${seconds} 秒`;
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}

/** Keeps long duration ranges editable without rendering a menu item for every second. */
export default function VideoDurationField({
  value,
  values,
  onChange,
  ariaLabel = '视频时长',
  disabled = false,
  portalZIndex,
}: Props) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(String(value)); setInvalid(false); }, [value]);

  const minimum = values[0] ?? value;
  const maximum = values[values.length - 1] ?? value;
  if (maximum <= 60) return (
    <SelectMenu
      value={value}
      options={values.map((seconds) => ({ value: seconds, label: `${seconds} 秒` }))}
      onChange={onChange}
      ariaLabel={ariaLabel}
      disabled={disabled}
      portalZIndex={portalZIndex}
    />
  );

  const presets = [...new Set([minimum, 30, 60, 120, 180, 300, 600, 900, 1800, maximum])]
    .filter((seconds) => values.includes(seconds)).sort((left, right) => left - right);
  const selectValue = presets.includes(value) ? String(value) : 'custom';
  function commit(rawValue: string) {
    const seconds = Number(rawValue.trim());
    if (!/^\d+$/.test(rawValue.trim()) || !Number.isSafeInteger(seconds) || !values.includes(seconds)) {
      setDraft(String(value));
      setInvalid(true);
      return;
    }
    setDraft(String(seconds));
    setInvalid(false);
    onChange(seconds);
  }

  return (
    <div className="video-duration-field">
      <div className="video-duration-field-controls">
        <SelectMenu
          value={selectValue}
          options={[
            ...presets.map((seconds) => ({ value: String(seconds), label: durationLabel(seconds) })),
            { value: 'custom', label: '自定义时长' },
          ]}
          onChange={(nextValue) => {
            if (nextValue === 'custom') {
              inputRef.current?.focus();
              inputRef.current?.select();
              return;
            }
            commit(nextValue);
          }}
          ariaLabel={ariaLabel}
          disabled={disabled}
          portalZIndex={portalZIndex}
        />
        <span className="video-duration-field-custom">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]+"
            value={draft}
            disabled={disabled}
            aria-label={`${ariaLabel}（秒）`}
            aria-describedby={hintId}
            aria-invalid={invalid}
            title={`按秒填写整数，范围 ${minimum}–${maximum} 秒`}
            onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
            onBlur={(event) => commit(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              event.stopPropagation();
              commit(event.currentTarget.value);
            }}
          />
          <span>秒</span>
        </span>
      </div>
      <small id={hintId} className={invalid ? 'video-duration-field-error' : ''}>
        {invalid ? `请输入 ${minimum}–${maximum} 秒内的可用整数时长` : `${durationLabel(minimum)}–${durationLabel(maximum)} · 当前 ${durationLabel(value)}`}
      </small>
    </div>
  );
}
