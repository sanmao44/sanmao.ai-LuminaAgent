'use client';

import { useRef, useState, type ReactNode } from 'react';
import { MEMORY_MAX_CHARS } from '@/lib/agent-memory';
import styles from './AgentMemoryEditor.module.css';

type Props = { summary: string; disabled: boolean; icon: ReactNode; onSave: (summary: string) => Promise<void> };

export default function AgentMemoryEditor({ summary, disabled, icon, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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
    <button type="button" className={styles.trigger} disabled={disabled} title="当前对话记忆" aria-label="当前对话记忆" onClick={() => {
      setDraft(summary); setError(''); dialog.current?.showModal();
    }}>{icon}<span>对话记忆</span></button>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="agent-memory-title" onCancel={(event) => { if (saving) event.preventDefault(); }}>
      <form onSubmit={(event) => { event.preventDefault(); void save(draft); }}>
        <h2 id="agent-memory-title">当前对话记忆</h2>
        <label htmlFor="agent-memory-summary">早期对话摘要</label>
        <textarea id="agent-memory-summary" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={MEMORY_MAX_CHARS} disabled={saving || disabled} placeholder="暂无摘要" />
        <output>{draft.length} / {MEMORY_MAX_CHARS}</output>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" disabled={saving || disabled || !summary} onClick={() => void save('')}>清空摘要</button>
          <button type="button" disabled={saving} onClick={() => dialog.current?.close()}>取消</button>
          <button type="submit" disabled={saving || disabled}>{saving ? '保存中…' : '保存'}</button>
        </footer>
      </form>
    </dialog>
  </>;
}
