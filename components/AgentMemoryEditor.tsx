'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MEMORY_MAX_CHARS } from '@/lib/agent-memory';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';
import styles from './AgentMemoryEditor.module.css';

type Props = { summary: string; disabled: boolean; icon: ReactNode; onSave: (summary: string) => Promise<void> };

export default function AgentMemoryEditor({ summary, disabled, icon, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useBodyScrollLock(open);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  async function save(value: string) {
    setSaving(true);
    setError('');
    try {
      await onSave(value);
      dialog.current?.close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存失败');
    } finally { setSaving(false); }
  }
  return <>
    <button type="button" className={styles.trigger} data-tooltip="当前对话记忆" aria-label="当前对话记忆" aria-haspopup="dialog" onClick={() => {
      setDraft(summary); setError(''); setEditing(false); setOpen(true);
    }}>{icon}</button>
    {open && createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby="agent-memory-title" onClose={() => setOpen(false)} onCancel={(event) => { if (saving) event.preventDefault(); }}>
      <form onSubmit={(event) => { event.preventDefault(); if (editing && !saving && !disabled) void save(draft); }}>
        <h2 id="agent-memory-title">当前对话记忆</h2>
        {editing ? <>
          <label htmlFor="agent-memory-summary">早期对话摘要</label>
          <textarea id="agent-memory-summary" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={MEMORY_MAX_CHARS} disabled={saving || disabled} placeholder="暂无摘要" />
          <output>{draft.length} / {MEMORY_MAX_CHARS}</output>
        </> : <section aria-label="早期对话摘要" className={styles.summary} tabIndex={0}>{summary || '暂无摘要'}</section>}
        {error && <p role="alert">{error}</p>}
        <footer>
          {editing ? <>
            <button type="button" className={styles.clear} disabled={saving || disabled || !summary} onClick={() => void save('')}>清空摘要</button>
            <button type="button" disabled={saving} onClick={() => { setEditing(false); setError(''); }}>取消</button>
            <button type="submit" disabled={saving || disabled}>{saving ? '保存中…' : '保存'}</button>
          </> : <>
            <button type="button" onClick={() => dialog.current?.close()}>关闭</button>
            <button type="button" disabled={disabled} onClick={() => { setDraft(summary); setEditing(true); }}>编辑</button>
          </>}
        </footer>
      </form>
    </dialog>, document.body)}
  </>;
}
