'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PERSONA_MAX_CHARS, normalizeConversationPersona } from '@/lib/agent-persona';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';
import styles from './AgentMemoryEditor.module.css';

type Props = { persona: string; disabled: boolean; icon: ReactNode; onSave: (persona: string) => Promise<void> };

export default function AgentPersonaEditor({ persona, disabled, icon, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useBodyScrollLock(open);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  async function save() {
    setSaving(true); setError('');
    try { await onSave(normalizeConversationPersona(draft)); setOpen(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败'); }
    finally { setSaving(false); }
  }
  return <>
    <button type="button" className={styles.trigger} data-tooltip="角色设定" aria-label="角色设定" aria-haspopup="dialog" disabled={disabled} onClick={() => { setDraft(persona); setError(''); setOpen(true); }}>{icon}</button>
    {open && <dialog ref={dialog} className={styles.dialog} aria-labelledby="agent-persona-title" onClose={() => setOpen(false)} onCancel={(event) => { if (saving) event.preventDefault(); }}>
      <form onSubmit={(event) => { event.preventDefault(); if (!saving) void save(); }}>
        <h2 id="agent-persona-title"><i aria-hidden="true">{icon}</i>角色设定</h2>
        <p className={styles.hint}>为当前对话设定身份、语气和工作方式；只影响保存后的新消息。</p>
        <label htmlFor="agent-persona">角色设定文案</label>
        <textarea id="agent-persona" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={PERSONA_MAX_CHARS} disabled={saving || disabled} placeholder="例如：你是一名严谨、简洁的品牌文案顾问。" />
        <output>{draft.length} / {PERSONA_MAX_CHARS}</output>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" className={styles.clear} disabled={saving || disabled || !draft} onClick={() => { setDraft(''); }}>清空</button>
          <button type="button" disabled={saving} onClick={() => setOpen(false)}>取消</button>
          <button type="submit" className={styles.primary} disabled={saving || disabled}>{saving ? '保存中…' : '保存'}</button>
        </footer>
      </form>
    </dialog>}
  </>;
}
