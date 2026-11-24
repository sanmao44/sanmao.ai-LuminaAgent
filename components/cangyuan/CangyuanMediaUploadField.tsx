'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CangyuanMediaUploadKind } from '@/packages/contracts/cangyuan-media-upload';
import './CangyuanMediaUploadField.css';

type Props = {
  fieldId: string;
  kind: CangyuanMediaUploadKind;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onUploadingChange?: (fieldId: string, uploading: boolean) => void;
  disabled?: boolean;
  maxFileBytes?: number;
  note?: string;
  accept?: string;
  requirePng?: boolean;
  extraAction?: ReactNode;
};

type UploadResponse = { url?: unknown; expiresAt?: unknown; error?: unknown };

const MAX_SIZE_BYTES: Record<CangyuanMediaUploadKind, number> = {
  audio: 25 * 1024 * 1024,
  image: 30 * 1024 * 1024,
  video: 25 * 1024 * 1024,
};

const ACCEPTED_FILES: Record<CangyuanMediaUploadKind, string> = {
  audio: '.mp3,.wav,.ogg,.flac,.aac,.m4a,audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/aac,audio/mp4',
  image: '.jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif',
  video: '.mp4,.mov,.webm,video/mp4,video/quicktime,video/webm',
};

const MAX_SIZE_LABEL: Record<CangyuanMediaUploadKind, string> = {
  audio: 'MP3、WAV、OGG、FLAC、AAC、M4A · 最大 25 MiB',
  image: 'JPG、PNG、WebP、GIF · 最大 30 MiB',
  video: 'MP4、MOV、WebM · 最大 25 MiB',
};

const KIND_LABEL: Record<CangyuanMediaUploadKind, string> = {
  audio: '音频',
  image: '图片',
  video: '视频',
};

export default function CangyuanMediaUploadField({
  fieldId,
  kind,
  label,
  value,
  onChange,
  onUploadingChange,
  disabled = false,
  maxFileBytes,
  note,
  accept,
  requirePng = false,
  extraAction,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState('');
  const effectiveMaxBytes = Math.min(MAX_SIZE_BYTES[kind], maxFileBytes ?? MAX_SIZE_BYTES[kind]);
  const effectiveMaxMiB = effectiveMaxBytes / (1024 * 1024);
  const maxSizeLabel = `${MAX_SIZE_LABEL[kind].split(' · 最大 ')[0]} · 最大 ${Number.isInteger(effectiveMaxMiB) ? effectiveMaxMiB : effectiveMaxMiB.toFixed(1)} MiB`;

  useEffect(() => () => {
    abortRef.current?.abort();
    onUploadingChange?.(fieldId, false);
  }, [fieldId, onUploadingChange]);

  async function upload(file: File) {
    setError('');
    if (requirePng && file.type && file.type.toLowerCase() !== 'image/png') {
      setError('请上传 PNG 图片。');
      return;
    }
    if (requirePng && !file.type && !file.name.toLowerCase().endsWith('.png')) {
      setError('请上传 PNG 图片。');
      return;
    }
    if (file.size > effectiveMaxBytes) {
      setError(`${KIND_LABEL[kind]}不能超过 ${Number.isInteger(effectiveMaxMiB) ? effectiveMaxMiB : effectiveMaxMiB.toFixed(1)} MiB。`);
      return;
    }
    setUploading(true);
    onUploadingChange?.(fieldId, true);
    const controller = new AbortController();
    abortRef.current = controller;
    const form = new FormData();
    const uploadFile = requirePng && !file.type
      ? new File([file], file.name, { type: 'image/png', lastModified: file.lastModified })
      : file;
    form.set('file', uploadFile);
    form.set('kind', kind);

    try {
      const response = await fetch('/api/cangyuan/media/upload', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      const result = await response.json() as UploadResponse;
      if (!response.ok || typeof result.url !== 'string' || !result.url) {
        throw new Error(typeof result.error === 'string' ? result.error : `上传失败（${response.status}）`);
      }
      onChange(result.url);
      setFileName(file.name);
      setExpiresAt(typeof result.expiresAt === 'string' ? result.expiresAt : '');
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(cause instanceof Error ? cause.message : '文件上传失败，请重试。');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setUploading(false);
      onUploadingChange?.(fieldId, false);
    }
  }

  function clear() {
    onChange('');
    setFileName('');
    setExpiresAt('');
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="cangyuan-media-upload-field">
      <div className="cangyuan-media-upload-heading">
        <span>{label}</span>
        {value && <span className="cangyuan-media-upload-ready">已就绪</span>}
      </div>
      <div className="cangyuan-media-upload-controls">
        <input
          ref={inputRef}
          className="cangyuan-media-upload-native-input"
          type="file"
          accept={accept || ACCEPTED_FILES[kind]}
          aria-label={`选择${KIND_LABEL[kind]}文件：${label}`}
          disabled={uploading || disabled}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void upload(file);
            event.currentTarget.value = '';
          }}
        />
        <button
          type="button"
          className="cangyuan-media-upload-button"
          disabled={uploading || disabled}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? '正在上传…' : value ? '替换文件' : '上传文件'}
        </button>
        {value && (
          <button type="button" className="cangyuan-media-clear-button" disabled={uploading || disabled} onClick={clear}>
            清除
          </button>
        )}
        {extraAction}
      </div>
      {uploading ? (
        <p className="cangyuan-media-upload-status" role="status">正在上传并准备可访问链接…</p>
      ) : value ? (
        <p className="cangyuan-media-upload-status" role="status">
          {fileName ? `已上传：${fileName}${expiresAt ? ` · 链接有效至 ${new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}` : '媒体链接已就绪'}
        </p>
      ) : (
        <p className="cangyuan-media-upload-hint">{maxSizeLabel}{note ? `。${note}` : ''}</p>
      )}
      {error && <p className="cangyuan-media-upload-error" role="alert">{error}</p>}
      <details className="cangyuan-media-manual-url">
        <summary>高级：手动填写公网 URL</summary>
        <input
          type="url"
          inputMode="url"
          autoComplete="url"
          value={value}
          disabled={uploading || disabled}
          onChange={(event) => {
            setFileName('');
            setExpiresAt('');
            setError('');
            onChange(event.target.value);
          }}
          placeholder="https://…"
          aria-label={`${label}公网 URL`}
        />
      </details>
    </div>
  );
}
