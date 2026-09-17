'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';
import { skillMatchesTerms, skillQueryTerms } from '@/lib/skill-picker';
import styles from './SkillManager.module.css';

type SkillFileRecord = { path: string; bytes: number };

type SkillSummary = {
  id: string;
  name: string;
  description: string;
  version: string;
  tags: string[];
  useCount?: number;
  lastUsedAt?: number;
  tools: string[];
  source: string;
  sourceUrl: string;
  sourceDir?: string;
  enabled: boolean;
  pending: boolean;
  createdAt: number;
  updatedAt: number;
  installer: { kind: string; name?: string; detail?: string; at: number };
  files: SkillFileRecord[];
  warnings: string[];
  sourceHash?: string;
  sourceCheckedAt?: number;
};

type LocalCandidate = { key: string; id: string; name: string; description: string; root: string };
type ArchiveChoice = { key: string; root: string; name: string; description: string };
type ChoiceSource = { kind: 'file'; file: File } | { kind: 'url'; url: string };
type SkillSettingsView = { enabled: boolean; autoApprove: boolean };
type Tab = 'installed' | 'create' | 'import';
type UpdateState = { status: 'checking' | 'same' | 'updated' | 'error'; message: string };

const SOURCE_LABELS: Record<string, string> = { local: '本机', url: '链接', github: 'GitHub', zip: '压缩包', agent: '助手安装' };
const EMPTY_DRAFT = { name: '', description: '', body: '', tags: '' };

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) throw new Error(String((data as { error?: string }).error || '请求失败'));
  return data as Record<string, unknown>;
}

function formatTime(value: number) {
  if (!value) return '';
  try { return new Date(value).toLocaleDateString('zh-CN'); } catch { return ''; }
}

/** 最近使用时间：越近越具体，超过 30 天回退到日期。 */
function formatSkillAge(value: number) {
  if (!value) return '';
  const diff = Date.now() - value;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatTime(value);
}

const SCRIPT_FILE_PATTERN = /\.(?:sh|bash|zsh|ps1|psm1|ps|bat|cmd|vbs|py|js|mjs|cjs|ts|tsx|jsx|rb|pl|php|lua)$/i;

const RATE_LIMIT_PATTERN = /限流|rate limit|HTTP 403|HTTP 429/i;

type UpdateOutcome = { status: 'updated' | 'same'; message: string };

/** 把更新检测结果转成界面文案；限流等失败由调用方按 RATE_LIMIT_PATTERN 判断。 */
function readUpdateOutcome(result: { status?: string; localEdited?: boolean; remote?: { version?: string } } | undefined): UpdateOutcome {
  if (result?.status === 'updated') {
    const version = result.remote?.version ? '（来源版本 ' + result.remote.version + '）' : '';
    return { status: 'updated', message: '发现来源更新' + version + (result.localEdited ? '，重装会覆盖本地修改' : '') };
  }
  return { status: 'same', message: '已是最新版本。' };
}

function formatBytes(bytes: number) {
  const value = Number(bytes) || 0;
  if (value < 1024) return value + ' B';
  return (value / 1024).toFixed(1) + ' KB';
}

function sourceLabel(skill: SkillSummary) {
  const url = String(skill.sourceUrl || '').trim();
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try { return new URL(url).host; } catch { return ''; }
  }
  return url.length > 48 ? url.slice(0, 48) + '…' : url;
}

function canCheckUpdate(skill: SkillSummary) {
  if (skill.pending) return false;
  const url = String(skill.sourceUrl || '').trim();
  if (!url) return false;
  if (skill.source === 'github') return true;
  return url.startsWith('http://') || url.startsWith('https://');
}

function hasScriptFile(files: SkillFileRecord[]) {
  return (files || []).some((file) => SCRIPT_FILE_PATTERN.test(String(file.path || '')));
}

/** 附件列表带上类型标记：脚本单独标出，提醒它只作参考、不会被执行。 */
function formatSkillFile(file: SkillFileRecord) {
  const size = formatBytes(file.bytes);
  return SCRIPT_FILE_PATTERN.test(String(file.path || '')) ? `${file.path}（脚本 · ${size}）` : `${file.path}（${size}）`;
}

/** 同名冲突：导入被拒绝时给出可执行的下一步提示。 */
function conflictNotice() {
  return '已存在同名技能，导入被阻止：点「覆盖并重试」，或勾选「覆盖同名技能」后再试一次，原有内容会被替换。';
}

function isExistingSkillError(failure: unknown) {
  return failure instanceof Error && failure.message.includes('已存在');
}

export default function SkillManager({ disabled, icon }: { disabled: boolean; icon: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('installed');
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [pending, setPending] = useState<SkillSummary[]>([]);
  const [settings, setSettings] = useState<SkillSettingsView>({ enabled: true, autoApprove: false });
  const [locals, setLocals] = useState<LocalCandidate[]>([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editing, setEditing] = useState('');
  const [query, setQuery] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [conflict, setConflict] = useState('');
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [preview, setPreview] = useState<{ id: string; name: string; body: string } | null>(null);
  const [confirming, setConfirming] = useState('');
  const [discarding, setDiscarding] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fileLabel, setFileLabel] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [updates, setUpdates] = useState<Record<string, UpdateState>>({});
  const [indexLimit, setIndexLimit] = useState(0);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [choices, setChoices] = useState<ArchiveChoice[] | null>(null);
  const [choicesTotal, setChoicesTotal] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const retryImport = useRef<(() => Promise<void>) | null>(null);
  const choiceSource = useRef<ChoiceSource | null>(null);
  const importFooterRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(open);

  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);

  /* 导入同名冲突时把提示和覆盖勾选框一起滚进视野，避免用户找不到。 */
  useEffect(() => {
    if (!conflict) return;
    importFooterRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [conflict]);

  useEffect(() => {
  }, [open]);

  const applyPayload = useCallback((data: Record<string, unknown>) => {
    if (Array.isArray(data.skills)) setSkills(data.skills as SkillSummary[]);
    if (Array.isArray(data.pending)) setPending(data.pending as SkillSummary[]);
    if (data.settings) setSettings(data.settings as SkillSettingsView);
    if (typeof data.indexLimit === 'number' && data.indexLimit > 0) setIndexLimit(data.indexLimit);
  }, []);

  const run = useCallback(async (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void run(async () => {
      applyPayload(await requestJson('/api/skills'));
      const localData = await requestJson('/api/skills/import').catch(() => ({ locals: [] }));
      setLocals(Array.isArray(localData.locals) ? localData.locals as LocalCandidate[] : []);
    });
  }, [open, run, applyPayload]);

  /* 助手忙完这一轮可能刚好自己装了技能：面板没打开时也刷新一下，好在按钮上提醒待确认。 */
  useEffect(() => {
    if (disabled || open) return;
    let cancelled = false;
    void requestJson('/api/skills')
      .then((data) => { if (!cancelled) applyPayload(data); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [disabled, open, applyPayload]);

  /* 删除 / 丢弃的二次确认会悬着：几秒内没继续操作就自动复位，避免误触确认。 */
  useEffect(() => {
    if (!confirming && !discarding) return;
    const timer = setTimeout(() => { setConfirming(''); setDiscarding(''); }, 4000);
    return () => clearTimeout(timer);
  }, [confirming, discarding]);

  const enabledCount = skills.filter((skill) => skill.enabled).length;
  const checkableCount = skills.filter(canCheckUpdate).length;
  const pendingCount = pending.length;
  /* 启用优先、最近用过的排前面；搜索词按空格拆分，和技能菜单共用同一套规则。 */
  const visibleSkills = useMemo(() => {
    const terms = skillQueryTerms(query);
    return skills
      .map((skill, index) => ({ skill, index }))
      .filter((row) => skillMatchesTerms(row.skill, terms))
      .sort((a, b) =>
        Number(b.skill.enabled) - Number(a.skill.enabled)
        || (Number(b.skill.lastUsedAt) || 0) - (Number(a.skill.lastUsedAt) || 0)
        || (Number(b.skill.useCount) || 0) - (Number(a.skill.useCount) || 0)
        || a.index - b.index)
      .map((row) => row.skill);
  }, [skills, query]);

  async function updateSettings(patch: Partial<SkillSettingsView>) {
    await run(async () => {
      const data = await requestJson('/api/skills', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
      applyPayload(data);
      setNotice(patch.enabled === false ? '已全局关闭技能：助手不再看到任何技能。' : '');
    });
  }

  async function toggleSkill(skill: SkillSummary) {
    await run(async () => {
      applyPayload(await requestJson(`/api/skills/${encodeURIComponent(skill.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: !skill.enabled }) }));
    });
  }

  async function removeSkill(skill: SkillSummary) {
    if (confirming !== skill.id) { setConfirming(skill.id); return; }
    setConfirming('');
    await run(async () => {
      applyPayload(await requestJson(`/api/skills/${encodeURIComponent(skill.id)}`, { method: 'DELETE' }));
      if (preview?.id === skill.id) setPreview(null);
    });
  }

  async function decide(skill: SkillSummary, action: 'approve' | 'discard') {
    await run(async () => {
      const data = await requestJson(`/api/skills/pending/${encodeURIComponent(skill.id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, overwrite }) });
      applyPayload(data);
      setDiscarding('');
      setNotice(action === 'approve' ? `已启用「${skill.name}」。` : `已丢弃「${skill.name}」。`);
    });
  }

  async function openPreview(skill: SkillSummary) {
    await run(async () => {
      const data = await requestJson(`/api/skills/${encodeURIComponent(skill.id)}`);
      const record = data.skill as { id: string; name: string; body: string } | undefined;
      setTab('installed');
      if (record) setPreview(record);
    });
  }

  async function saveSkill() {
    await run(async () => {
      if (editing) {
        const data = await requestJson(`/api/skills/${encodeURIComponent(editing)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: draft.name, description: draft.description, tags: draft.tags, body: draft.body }) });
        applyPayload(data);
        setDraft(EMPTY_DRAFT);
        setEditing('');
        setTab('installed');
        setNotice(`已保存「${(data.skill as { name?: string })?.name || draft.name}」的修改。`);
        return;
      }
      const data = await requestJson('/api/skills', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...draft, overwrite }) });
      applyPayload(data);
      setDraft(EMPTY_DRAFT);
      setTab('installed');
      setNotice(`已保存「${(data.skill as { name?: string })?.name || draft.name}」。`);
    });
  }

  /* 编辑已装技能：拉完整正文预填表单，保存时走 PATCH，不会丢掉超长正文。 */
  async function openEditor(skill: SkillSummary) {
    await run(async () => {
      const data = await requestJson(`/api/skills/${encodeURIComponent(skill.id)}`);
      const record = data.skill as { id?: string; name?: string; description?: string; tags?: string[]; body?: string } | undefined;
      if (!record?.id) throw new Error('技能不存在。');
      setDraft({ name: record.name || '', description: record.description || '', tags: (record.tags || []).join(', '), body: record.body || '' });
      setEditing(record.id);
      setError('');
      setNotice('');
      setTab('create');
    });
  }

  /* 归档里有多个技能时先不安装，列出候选让用户挑选；返回 true 表示已进入选择步骤。 */
  function applyChoices(data: Record<string, unknown>, source: ChoiceSource) {
    const list = Array.isArray(data.choices) ? data.choices as ArchiveChoice[] : [];
    if (list.length < 2) return false;
    choiceSource.current = source;
    setChoices(list);
    setChoicesTotal(list.length);
    setSelectedKeys([]);
    setConflict('');
    setRetryAvailable(false);
    setNotice('');
    retryImport.current = null;
    return true;
  }

  async function importFromUrl(force = false) {
    retryImport.current = () => importFromUrl(true);
    setConflict('');
    setRetryAvailable(false);
    await run(async () => {
      try {
        const data = await requestJson('/api/skills/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: importUrl, overwrite: overwrite || force }) });
        if (applyChoices(data, { kind: 'url', url: importUrl.trim() })) return;
        applyPayload(data);
        setImportUrl('');
        setTab('installed');
        const warnings = Array.isArray(data.warnings) ? data.warnings as string[] : [];
        setNotice(warnings.length ? `已导入，注意：${warnings[0]}` : `已导入「${(data.skill as { name?: string })?.name || ''}」。`);
      } catch (failure) {
        if (!isExistingSkillError(failure)) throw failure;
        setConflict(conflictNotice());
        setRetryAvailable(true);
      }
    });
  }

  async function importFromFile(file: File, force = false) {
    setFileLabel(file.name);
    retryImport.current = () => importFromFile(file, true);
    setConflict('');
    setRetryAvailable(false);
    await run(async () => {
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('overwrite', String(overwrite || force));
        const data = await requestJson('/api/skills/import', { method: 'POST', body: form });
        if (applyChoices(data, { kind: 'file', file })) return;
        applyPayload(data);
        setTab('installed');
        const warnings = Array.isArray(data.warnings) ? data.warnings as string[] : [];
        setNotice(warnings.length ? `已导入，注意：${warnings[0]}` : `已导入「${(data.skill as { name?: string })?.name || file.name}」。`);
      } catch (failure) {
        if (!isExistingSkillError(failure)) throw failure;
        setConflict(conflictNotice());
        setRetryAvailable(true);
      }
    });
  }

  function toggleChoice(key: string) {
    setSelectedKeys((previous) => (previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key]));
  }

  /* 安装勾选的候选技能：单个、多选或全部；失败的留在选择区，方便勾选覆盖后重试。 */
  async function installChoice(keys: string[], force = false) {
    const source = choiceSource.current;
    if (!source || !keys.length) return;
    retryImport.current = () => installChoice(keys, true);
    setConflict('');
    setRetryAvailable(false);
    await run(async () => {
      try {
        let data: Record<string, unknown>;
        if (source.kind === 'file') {
          const form = new FormData();
          form.append('file', source.file);
          form.append('overwrite', String(overwrite || force));
          form.append('dirs', JSON.stringify(keys));
          data = await requestJson('/api/skills/import', { method: 'POST', body: form });
        } else {
          data = await requestJson('/api/skills/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: source.url, dirs: keys, overwrite: overwrite || force }) });
        }
        applyPayload(data);
        const installed = Array.isArray(data.installed) ? data.installed as Array<{ skill?: { name?: string } }> : [];
        const failed = Array.isArray(data.failed) ? data.failed as Array<{ dir: string; error: string }> : [];
        if (!installed.length) throw new Error(failed.length ? failed[0].error : '没有安装任何技能，请重新选择后再试。');
        const names = installed.map((item) => item.skill?.name || '').filter(Boolean);
        if (failed.length) {
          const label = (key: string) => (choices || []).find((choice) => choice.key === key)?.name || key;
          setChoices((previous) => (previous || []).filter((choice) => failed.some((item) => item.dir === choice.key)));
          setSelectedKeys((previous) => previous.filter((key) => failed.some((item) => item.dir === key)));
          const detail = failed.slice(0, 2).map((item) => {
            const name = label(item.dir);
            return item.error.includes(name) ? item.error : name + '（' + item.error + '）';
          }).join('；');
          const conflicts = failed.every((item) => /已存在/.test(item.error));
          setNotice('已导入 ' + installed.length + ' 个技能，' + failed.length + ' 个失败：' + detail + (failed.length > 2 ? ' 等' : '') + '。' + (conflicts ? '可勾选「覆盖同名技能」后重试。' : '可以稍后再试。'));
          return;
        }
        setChoices(null);
        choiceSource.current = null;
        setSelectedKeys([]);
        setImportUrl('');
        setFileLabel('');
        setTab('installed');
        setNotice(names.length > 1 ? '已导入「' + names[0] + '」等 ' + names.length + ' 个技能。' : '已导入「' + (names[0] || keys[0]) + '」。');
      } catch (failure) {
        if (!isExistingSkillError(failure)) throw failure;
        setConflict(conflictNotice());
        setRetryAvailable(true);
      }
    });
  }

  async function importFromLocal(candidate: LocalCandidate, force = false) {
    retryImport.current = () => importFromLocal(candidate, true);
    setConflict('');
    setRetryAvailable(false);
    await run(async () => {
      try {
        const data = await requestJson('/api/skills/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ localKey: candidate.key, overwrite: overwrite || force }) });
        applyPayload(data);
        setTab('installed');
        setNotice(`已导入本机技能「${(data.skill as { name?: string })?.name || candidate.name}」。`);
      } catch (failure) {
        if (!isExistingSkillError(failure)) throw failure;
        setConflict(conflictNotice());
        setRetryAvailable(true);
      }
    });
  }

  /* 检查来源更新：只比对内容哈希；确认更新后可一键重装（保留启用状态与本地别名）。 */
  async function checkUpdate(skill: SkillSummary, apply = false) {
    await run(async () => {
      setUpdates((previous) => ({ ...previous, [skill.id]: { status: 'checking', message: apply ? '正在更新…' : '正在检查来源…' } }));
      try {
        const data = await requestJson('/api/skills/' + encodeURIComponent(skill.id) + '/update-check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apply }) });
        if (apply) {
          applyPayload(data);
          setUpdates((previous) => ({ ...previous, [skill.id]: { status: 'same', message: '已更新到最新版本。' } }));
          setNotice('已把「' + ((data.skill as { name?: string })?.name || skill.name) + '」更新到最新版本。');
          return;
        }
        const outcome = readUpdateOutcome(data.result as { status?: string; localEdited?: boolean; remote?: { version?: string } } | undefined);
        setUpdates((previous) => ({ ...previous, [skill.id]: { status: outcome.status, message: outcome.message } }));
      } catch (failure) {
        setUpdates((previous) => ({ ...previous, [skill.id]: { status: 'error', message: failure instanceof Error ? failure.message : '检查更新失败。' } }));
      }
    });
  }

  /* 导出分享：带附件时打包 zip（SKILL.md 在根目录），没有附件就给单文件 SKILL.md。 */
  async function exportSkill(skill: SkillSummary) {
    await run(async () => {
      const withFiles = skill.files.length > 0;
      const response = await fetch('/api/skills/' + encodeURIComponent(skill.id) + '/export' + (withFiles ? '?format=zip' : ''));
      if (!response.ok) {
        const data = await response.json().catch(() => ({} as Record<string, unknown>));
        throw new Error(String((data as { error?: string }).error || '导出失败。'));
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = skill.id + (withFiles ? '.zip' : '.md');
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      setNotice('已导出「' + skill.name + '」' + (withFiles ? '（含 ' + skill.files.length + ' 个附件）' : '') + '，可以直接分享给别人导入。');
    });
  }

  /* 批量检查来源更新：串行请求避免打爆 GitHub 接口，遇到限流就停下并说明剩余数量。 */
  async function checkAllUpdates() {
    const targets = skills.filter(canCheckUpdate);
    if (!targets.length) return;
    setError('');
    setNotice('');
    let checked = 0;
    let updated = 0;
    let failed = 0;
    let stopped = '';
    setBatch({ done: 0, total: targets.length });
    for (let index = 0; index < targets.length; index += 1) {
      const skill = targets[index];
      setBatch({ done: index, total: targets.length });
      setUpdates((previous) => ({ ...previous, [skill.id]: { status: 'checking', message: '正在检查来源…' } }));
      try {
        const data = await requestJson('/api/skills/' + encodeURIComponent(skill.id) + '/update-check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apply: false }) });
        const outcome = readUpdateOutcome(data.result as { status?: string; localEdited?: boolean; remote?: { version?: string } } | undefined);
        if (outcome.status === 'updated') updated += 1;
        setUpdates((previous) => ({ ...previous, [skill.id]: { status: outcome.status, message: outcome.message } }));
      } catch (failure) {
        failed += 1;
        const message = failure instanceof Error ? failure.message : '检查更新失败。';
        setUpdates((previous) => ({ ...previous, [skill.id]: { status: 'error', message } }));
        if (RATE_LIMIT_PATTERN.test(message)) { stopped = message; checked += 1; break; }
      }
      checked += 1;
      if (index < targets.length - 1) await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
    setBatch(null);
    const parts = [updated ? updated + ' 个有更新' : '没有发现更新', failed ? failed + ' 个失败' : ''].filter(Boolean).join('，');
    setNotice('已检查 ' + checked + '/' + targets.length + ' 个技能：' + parts + (stopped ? '；来源接口限流，剩余 ' + (targets.length - checked) + ' 个请过几分钟再试。' : '。'));
  }

  const overwriteToggle = (
    <label className={styles.check + (conflict ? ' ' + styles.checkAttention : '')}>
      <input type="checkbox" checked={overwrite} disabled={busy} onChange={(event) => { setOverwrite(event.target.checked); setConflict(''); }} />
      <span>覆盖同名技能</span>
    </label>
  );

  return <>
    <button type="button" className={styles.trigger} data-tooltip={pendingCount ? `技能 · ${pendingCount} 个待确认` : '技能'} aria-label={pendingCount ? `技能（${pendingCount} 个待确认）` : '技能'} aria-haspopup="dialog" disabled={disabled} onClick={() => { setError(''); setNotice(''); setConflict(''); setRetryAvailable(false); retryImport.current = null; setPreview(null); setConfirming(''); setDiscarding(''); setFileLabel(''); setDragActive(false); setChoices(null); choiceSource.current = null; setOpen(true); }}>{icon}{pendingCount > 0 && <span className={styles.pendingBadge} aria-hidden="true">{pendingCount > 9 ? '9+' : pendingCount}</span>}</button>
    {open && <dialog ref={dialog} className={styles.dialog} aria-labelledby="skill-manager-title" onClose={() => setOpen(false)} onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h2 id="skill-manager-title"><i aria-hidden="true">✦</i>技能</h2>
          <p className={styles.hint}>技能是助手可复用的流程说明，兼容 Agent Skills 的 SKILL.md。只有已启用的技能才会进入上下文，技能的脚本永远不会被执行。</p>
          <p className={styles.hint}><strong>怎么用：</strong>安装并启用后不需要手动挑、也不用关键词，助手遇到相关任务会自己读取并按它执行；回答上出现「技能 · 名称」就说明这轮用了它。想指定某个技能时，直接对助手说“用 X 技能做…”，也可以点输入框旁的「技能」按钮或敲 / 呼出技能菜单（超级画布右侧的 Agent 面板同样支持）。</p>
        </div>
        <div className={styles.headerAside}>
          <div className={styles.switches}>
            <label className={styles.check}>
              <input type="checkbox" checked={settings.enabled} disabled={busy} onChange={(event) => void updateSettings({ enabled: event.target.checked })} />
              <span>启用技能</span>
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={settings.autoApprove} disabled={busy || !settings.enabled} onChange={(event) => void updateSettings({ autoApprove: event.target.checked })} />
              <span>助手自己安装后自动启用</span>
            </label>
          </div>
          <button type="button" className={styles.close} aria-label="关闭技能面板" title="关闭" disabled={busy} onClick={() => setOpen(false)}>✕</button>
        </div>
      </header>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}

      {pending.length > 0 && <section className={styles.pending}>
        <h3>等待确认（{pending.length}）</h3>
        <p className={styles.hint}>这些是助手自主安装的技能，确认后才会生效。</p>
        {pending.map((skill) => <article key={skill.id} className={styles.row}>
          <div className={styles.rowMain}>
            <div className={styles.rowTitle}>
              <strong>{skill.name}</strong>
              <span className={styles.badge}>{SOURCE_LABELS[skill.source] || skill.source}</span>
              {hasScriptFile(skill.files) && <span className={styles.warnBadge}>含脚本文件</span>}
            </div>
            <p className={styles.description}>{skill.description || '没有填写简介'}</p>
            <p className={styles.meta}>
              {sourceLabel(skill) ? `来源：${sourceLabel(skill)} · ` : ''}
              {skill.files.length ? `${skill.files.length} 个附件` : '没有附件'}
              {skill.tags?.length ? ` · 别名：${skill.tags.join('、')}` : ''}
            </p>
            {skill.files.length > 0 && <p className={styles.meta}>附件：{skill.files.slice(0, 4).map((file) => formatSkillFile(file)).join('、')}{skill.files.length > 4 ? ` 等 ${skill.files.length} 个` : ''}</p>}
            {hasScriptFile(skill.files) && <p className={styles.warnLine}>包含脚本文件：安装后只作参考资料，脚本永远不会被执行。</p>}
            {skill.warnings.map((warning) => <p key={warning} className={styles.warnLine}>{warning}</p>)}
            {skill.installer?.detail && <p className={styles.meta}>{skill.installer.detail}{skill.installer.at ? ` · ${formatSkillAge(skill.installer.at)}` : ''}</p>}
          </div>
          <div className={styles.rowActions}>
            <button type="button" disabled={busy} onClick={() => void openPreview(skill)}>预览</button>
            <button type="button" className={styles.primary} disabled={busy} onClick={() => void decide(skill, 'approve')}>允许</button>
            <button type="button" disabled={busy} onClick={() => { if (discarding !== skill.id) { setDiscarding(skill.id); return; } void decide(skill, 'discard'); }}>{discarding === skill.id ? '确认丢弃' : '丢弃'}</button>
          </div>
        </article>)}
      </section>}

      <nav className={styles.tabs} role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'installed'} className={tab === 'installed' ? styles.tabActive : styles.tab} onClick={() => setTab('installed')}>已安装{skills.length ? `（${skills.length}）` : ''}</button>
        <button type="button" role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? styles.tabActive : styles.tab} onClick={() => { setEditing(''); setDraft(EMPTY_DRAFT); setTab('create'); }}>新建</button>
        <button type="button" role="tab" aria-selected={tab === 'import'} className={tab === 'import' ? styles.tabActive : styles.tab} onClick={() => setTab('import')}>导入</button>
      </nav>

      <div className={styles.panel}>
        {tab === 'installed' && (preview
          ? <section className={styles.preview}>
              <div className={styles.previewHead}>
                <button type="button" onClick={() => setPreview(null)}>返回</button>
                <strong>{preview.name}</strong>
              </div>
              <pre>{preview.body}</pre>
            </section>
          : skills.length
            ? <>
                {(skills.length > 3 || checkableCount > 1) && <div className={styles.listToolbar}>
                  {skills.length > 3 && <input type="text" value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、别名或简介" aria-label="搜索技能" />}
                  {checkableCount > 1 && <button type="button" disabled={busy || Boolean(batch)} onClick={() => void checkAllUpdates()}>{batch ? '检查中 ' + batch.done + '/' + batch.total : '全部检查更新'}</button>}
                </div>}
                {indexLimit > 0 && enabledCount > indexLimit && <p className={styles.hint}>已启用 {enabledCount} 个技能，助手每轮只会自动看到最常用的 {indexLimit} 个；其余技能可以在技能菜单里点名，或让助手用 skill_search 检索。</p>}
                {visibleSkills.length
                  ? visibleSkills.map((skill) => {
                    const update = updates[skill.id];
                    return <article key={skill.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <div className={styles.rowTitle}>
                    <strong>{skill.name}</strong>
                    <span className={styles.badge}>{SOURCE_LABELS[skill.source] || skill.source}</span>
                    {skill.version && <span className={styles.badge}>{skill.version.startsWith('v') ? skill.version : 'v' + skill.version}</span>}
                    {!skill.enabled && <span className={styles.badgeMuted}>未启用</span>}
                    {update?.status === 'updated' && <span className={styles.updateBadge}>有更新</span>}
                  </div>
                  <p className={styles.description}>{skill.description || '没有填写简介'}</p>
                  <p className={styles.meta}>
                    {skill.useCount ? `用过 ${skill.useCount} 次${skill.lastUsedAt ? ` · 最近使用 ${formatSkillAge(skill.lastUsedAt)}` : ''} · ` : ''}
                    {skill.tags?.length ? `别名：${skill.tags.join('、')} · ` : ''}
                    {skill.tools?.length ? `需要工具：${skill.tools.join('、')} · ` : ''}
                    {skill.files.length ? `${skill.files.length} 个附件${hasScriptFile(skill.files) ? '（含脚本）' : ''} · ` : ''}
                    更新于 {formatTime(skill.updatedAt)}
                    {skill.sourceCheckedAt ? ` · 上次检查 ${formatTime(skill.sourceCheckedAt)}` : ''}
                    {skill.sourceDir ? ` · 来源目录 ${skill.sourceDir}` : ''}
                    {skill.installer?.detail ? ` · ${skill.installer.detail}` : ''}
                  </p>
                  {update?.message && <p className={`${styles.updateLine} ${update.status === 'updated' ? styles.isUpdate : ''} ${update.status === 'error' ? styles.isError : ''}`}>
                    <span>{update.message}</span>
                    {update.status === 'updated' && <button type="button" className={styles.primary} disabled={busy} onClick={() => void checkUpdate(skill, true)}>更新重装</button>}
                  </p>}
                </div>
                <div className={styles.rowActions}>
                  <label className={styles.check}>
                    <input type="checkbox" checked={skill.enabled} disabled={busy} onChange={() => void toggleSkill(skill)} />
                    <span>启用</span>
                  </label>
                  <button type="button" disabled={busy} onClick={() => void openEditor(skill)}>编辑</button>
                  <button type="button" disabled={busy} onClick={() => void openPreview(skill)}>预览</button>
                  {canCheckUpdate(skill) && <button type="button" disabled={busy || Boolean(batch)} onClick={() => void checkUpdate(skill)}>{update?.status === 'checking' ? '检查中…' : '检查更新'}</button>}
                  <button type="button" disabled={busy} onClick={() => void exportSkill(skill)}>{skill.files.length ? '导出 zip' : '导出 md'}</button>
                  <button type="button" disabled={busy} onClick={() => void removeSkill(skill)}>{confirming === skill.id ? '确认删除' : '删除'}</button>
                </div>
              </article>;
                  })
                  : <p className={styles.empty}>没有匹配「{query}」的技能。</p>}
              </>
            : <p className={styles.empty}>还没有技能。可以新建、导入别人的 SKILL.md、粘贴 GitHub 仓库，或让助手自己安装。</p>)}

        {tab === 'create' && <section className={styles.form}>
          {editing && <p className={styles.hint}>正在编辑「{skills.find((skill) => skill.id === editing)?.name || editing}」，保存后立即生效。</p>}
          <label htmlFor="skill-name">名称</label>
          <input id="skill-name" value={draft.name} disabled={busy} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：短视频分镜脚本" />
          <label htmlFor="skill-description">简介</label>
          <input id="skill-description" value={draft.description} disabled={busy} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="一句话说明什么时候用它" />
          <label htmlFor="skill-tags">别名（可选）</label>
          <input id="skill-tags" value={draft.tags} disabled={busy} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="方便用中文检索，逗号分隔，例如：报错, 调试, 修bug" />
          <label htmlFor="skill-body">正文（Markdown）</label>
          <textarea id="skill-body" value={draft.body} disabled={busy} onChange={(event) => setDraft({ ...draft, body: event.target.value })} placeholder={'# 目标\n\n# 步骤\n1. …\n\n# 注意事项\n- …'} />
          <div className={styles.formFooter}>
            {editing ? null : overwriteToggle}
            {editing && <button type="button" disabled={busy} onClick={() => { setEditing(''); setDraft(EMPTY_DRAFT); }}>取消编辑</button>}
            <button type="button" className={styles.primary} disabled={busy || !draft.name.trim() || !draft.body.trim()} onClick={() => void saveSkill()}>{editing ? '保存修改' : '保存技能'}</button>
          </div>
        </section>}

        {tab === 'import' && <section className={styles.form}>
          {choices ? <div className={styles.choices}>
            <div className={styles.choiceHead}>
              <p className={styles.choiceTitle}>{choices.length < choicesTotal
                ? `还有 ${choices.length} 个技能没有安装成功`
                : `${choiceSource.current?.kind === 'url' ? '这个仓库' : '这个压缩包'}里有 ${choices.length} 个技能`}</p>
              <p className={styles.hint}>勾选要安装的（可多选），或直接全部安装；同名冲突仍由下方「覆盖同名技能」控制。</p>
            </div>
            <div className={styles.localList}>
              {choices.map((choice) => <article key={choice.key} className={styles.row}>
                <div className={styles.rowMain}>
                  <div className={styles.rowTitle}><strong>{choice.name || choice.key}</strong><span className={styles.badge}>{choice.root || '根目录'}</span></div>
                  <p className={styles.description}>{choice.description || '没有填写简介'}</p>
                </div>
                <div className={styles.rowActions}>
                  <label className={styles.check}>
                    <input type="checkbox" checked={selectedKeys.includes(choice.key)} disabled={busy} onChange={() => toggleChoice(choice.key)} />
                    <span>选择</span>
                  </label>
                  <button type="button" disabled={busy} onClick={() => void installChoice([choice.key])}>安装</button>
                </div>
              </article>)}
            </div>
            <div className={styles.formFooter}>
              <button type="button" disabled={busy} onClick={() => { setChoices(null); choiceSource.current = null; setSelectedKeys([]); }}>返回重新选择来源</button>
              <div className={styles.inline}>
                <button type="button" disabled={busy || !selectedKeys.length} onClick={() => void installChoice(selectedKeys)}>安装所选{selectedKeys.length ? `（${selectedKeys.length}）` : ''}</button>
                <button type="button" className={styles.primary} disabled={busy} onClick={() => void installChoice(choices.map((choice) => choice.key))}>全部安装（{choices.length}）</button>
              </div>
            </div>
          </div> : <>
          <label htmlFor="skill-url">GitHub 仓库或 SKILL.md 链接</label>
          <div className={styles.inline}>
            <input id="skill-url" value={importUrl} disabled={busy} onChange={(event) => setImportUrl(event.target.value)} placeholder="owner/repo、https://github.com/owner/repo/tree/main/skills/demo 或直链" />
            <button type="button" className={styles.primary} disabled={busy || !importUrl.trim()} onClick={() => void importFromUrl()}>导入</button>
          </div>
          <p className={styles.hint}>只允许 https 地址，内网与本机地址会被拒绝；仓库或压缩包里含多个 SKILL.md 时，会先列出技能让你选择安装。</p>

          <div className={styles.orDivider}><span>或</span></div>

          <input
            id="skill-file"
            className={styles.fileInput}
            type="file"
            accept=".zip,.md,.markdown,.txt,application/zip,text/markdown"
            disabled={busy}
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFromFile(file); }}
          />
          <label
            className={`${styles.filePick} ${dragActive ? styles.isDragActive : ''} ${busy ? styles.isBusy : ''}`}
            htmlFor="skill-file"
            onDragOver={(event) => { event.preventDefault(); if (!busy) setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDragActive(false); const file = event.dataTransfer?.files?.[0]; if (file && !busy) void importFromFile(file); }}
          >
            <b>{busy ? '正在导入…' : (fileLabel || '选择 SKILL.md 或 ZIP 文件')}</b>
            <small>支持 .md / .zip，也可以直接把文件拖进来</small>
          </label>

          {locals.length > 0 && <>
            <label>本机已有的 Agent Skills</label>
            <div className={styles.localList}>
              {locals.map((candidate) => <article key={candidate.key} className={styles.row}>
                <div className={styles.rowMain}>
                  <div className={styles.rowTitle}><strong>{candidate.name}</strong><span className={styles.badge}>{candidate.root}</span></div>
                  <p className={styles.description}>{candidate.description || '没有填写简介'}</p>
                </div>
                <div className={styles.rowActions}>
                  <button type="button" disabled={busy} onClick={() => void importFromLocal(candidate)}>导入</button>
                </div>
              </article>)}
            </div>
          </>}

          </>}

          {conflict && <p className={styles.conflict} role="alert">
            <span>{conflict}</span>
            {retryAvailable && <button type="button" className={styles.conflictRetry} disabled={busy} onClick={() => void retryImport.current?.()}>覆盖并重试</button>}
          </p>}
          <div className={styles.formFooter} ref={importFooterRef}>{overwriteToggle}</div>
        </section>}
      </div>

      <footer className={styles.footer}>
        <span className={styles.count}>{settings.enabled ? `已启用 ${enabledCount} / ${skills.length} 个技能` : '技能已全局关闭'}</span>
        <button type="button" disabled={busy} onClick={() => setOpen(false)}>关闭</button>
      </footer>
    </dialog>}
  </>;
}
