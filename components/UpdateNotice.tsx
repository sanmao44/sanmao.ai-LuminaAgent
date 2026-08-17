'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type UpdateStatus = {
  configured?: boolean;
  currentVersion: string;
  latestVersion?: string;
  hasUpdate: boolean;
  releaseUrl?: string;
  projectUrl?: string;
  packageUrl?: string;
  canApply?: boolean;
  notes?: string[];
  error?: string;
};

type ApplyState = 'idle' | 'working' | 'started' | 'error';
type CheckNoticeTone = 'success' | 'error';

const DISMISSED_KEY = 'sanmao-dismissed-update-version';
const CHECKED_KEY = 'sanmao-update-checked-at';
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

function openExternal(url?: string) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export default function UpdateNotice() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [applyState, setApplyState] = useState<ApplyState>('idle');
  const [applyMessage, setApplyMessage] = useState('');
  const [checkNotice, setCheckNotice] = useState('');
  const [checkNoticeTone, setCheckNoticeTone] = useState<CheckNoticeTone>('success');
  const checkNoticeTimerRef = useRef<number | null>(null);

  const announceCheckResult = useCallback((message: string, tone: CheckNoticeTone = 'success') => {
    if (checkNoticeTimerRef.current !== null) window.clearTimeout(checkNoticeTimerRef.current);
    setCheckNoticeTone(tone);
    setCheckNotice(message);
    checkNoticeTimerRef.current = message
      ? window.setTimeout(() => {
        setCheckNotice('');
        checkNoticeTimerRef.current = null;
      }, 3000)
      : null;
  }, []);

  useEffect(() => () => {
    if (checkNoticeTimerRef.current !== null) window.clearTimeout(checkNoticeTimerRef.current);
  }, []);

  const check = useCallback(async (force = false, announce = false) => {
    setBusy(true);
    if (announce) announceCheckResult('');
    try {
      const response = await fetch(`/api/update${force ? '?force=1' : ''}`, { cache: 'no-store' });
      const data = await response.json() as UpdateStatus;
      if (!response.ok || data.error) {
        setStatus(data);
        if (announce) announceCheckResult(data.error || '检查更新失败，请稍后重试', 'error');
        return;
      }

      setStatus(data);
      window.localStorage.setItem(CHECKED_KEY, String(Date.now()));
      const wasDismissed = data.latestVersion
        ? window.localStorage.getItem(DISMISSED_KEY) === data.latestVersion
        : false;
      if (data.hasUpdate && (!wasDismissed || announce)) setShowModal(true);
      if (announce && !data.hasUpdate) announceCheckResult('当前已是最新版本');
    } catch {
      if (announce) announceCheckResult('检查更新失败，请稍后重试', 'error');
      // 更新检查失败不应影响主应用。
    } finally {
      setBusy(false);
    }
  }, [announceCheckResult]);

  useEffect(() => {
    const lastChecked = Number(window.localStorage.getItem(CHECKED_KEY) || 0);
    void check(Date.now() - lastChecked > CHECK_INTERVAL);
  }, [check]);

  const updateLabel = useMemo(() => {
    if (applyState === 'working') return '正在准备更新…';
    if (applyState === 'started') return '更新已开始，等待重启…';
    return status?.canApply ? '立即更新并重启' : '前往下载';
  }, [applyState, status?.canApply]);

  function dismissUpdate() {
    if (status?.latestVersion) window.localStorage.setItem(DISMISSED_KEY, status.latestVersion);
    setShowModal(false);
  }

  async function applyUpdate() {
    if (!status?.hasUpdate) return;
    if (!status.canApply) {
      openExternal(status.releaseUrl);
      return;
    }

    setApplyState('working');
    setApplyMessage('正在下载并校验更新包，用户数据不会被覆盖。');
    try {
      const response = await fetch('/api/update/apply', { method: 'POST', cache: 'no-store' });
      const data = await response.json() as { started?: boolean; error?: string };
      if (!response.ok || !data.started) throw new Error(data.error || '更新准备失败');

      setApplyState('started');
      setApplyMessage('服务即将重启，请保持此页面打开。');
      const startedAt = Date.now();
      const poll = window.setInterval(async () => {
        if (Date.now() - startedAt > 90_000) {
          window.clearInterval(poll);
          setApplyState('error');
          setApplyMessage('服务重启超时，请重新运行启动器完成更新。');
          return;
        }
        try {
          const checkResponse = await fetch('/api/update?force=1', { cache: 'no-store' });
          if (!checkResponse.ok) return;
          const next = await checkResponse.json() as UpdateStatus;
          if (next.currentVersion !== status.currentVersion) {
            window.clearInterval(poll);
            window.location.reload();
          }
        } catch {
          // 更新器正在停止旧服务，短暂请求失败是预期情况。
        }
      }, 1500);
    } catch (error) {
      setApplyState('error');
      setApplyMessage(error instanceof Error ? error.message : '更新失败，请前往 GitHub 手动下载。');
    }
  }

  const hasUpdate = Boolean(status?.hasUpdate && status.latestVersion && status.releaseUrl);

  return (
    <>
      <aside className={`version-card ${hasUpdate ? 'has-update' : ''}`} aria-label="SANMAO.AI 版本信息">
        <button
          type="button"
          className="version-card-head"
          title={hasUpdate ? '发现新版本，点击查看更新' : busy ? '正在检查更新…' : '点击检查更新'}
          disabled={busy}
          onClick={() => hasUpdate ? setShowModal(true) : void check(true, true)}
        >
          <span className="version-card-github" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.084-.729.084-.729 1.205.084 1.84 1.236 1.84 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.404 1.02.005 2.04.137 3 .404 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.212 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>
          </span>
          <div>
            <strong>SANMAO.AI</strong>
            <small>v{status?.currentVersion || '…'}</small>
          </div>
          {hasUpdate ? <i className="version-update-dot" aria-label="有可用更新" /> : null}
        </button>
        {hasUpdate ? (
          <button type="button" className="version-update-button" onClick={() => setShowModal(true)}>
            <span>发现 v{status?.latestVersion}</span>
            <span aria-hidden="true">→</span>
          </button>
        ) : null}
        <div className="version-card-actions">
          {status?.projectUrl ? <button type="button" onClick={() => openExternal(status.projectUrl)}>项目主页</button> : null}
          <button type="button" disabled={busy} onClick={() => void check(true)}>{busy ? '检查中…' : '检查更新'}</button>
        </div>
      </aside>

      {hasUpdate && showModal ? (
        <div className="update-modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setShowModal(false); }}>
          <section className="update-modal" role="dialog" aria-modal="true" aria-labelledby="update-modal-title">
            <div className="update-modal-icon" aria-hidden="true">↗</div>
            <div className="update-modal-copy">
              <span className="update-modal-eyebrow">SANMAO.AI 更新提醒</span>
              <h2 id="update-modal-title">发现新版本 v{status?.latestVersion}</h2>
              <p>当前版本 v{status?.currentVersion}。更新会保留本地配置、API Key、历史记录和图片。</p>
              {status?.notes?.length ? <ul>{status.notes.slice(0, 4).map((note) => <li key={note}>{note}</li>)}</ul> : null}
              {applyState !== 'idle' ? <div className={`update-progress ${applyState}`} role="status">{applyMessage}</div> : null}
            </div>
            <div className="update-modal-actions">
              <button type="button" className="ghost-button" disabled={applyState === 'working'} onClick={dismissUpdate}>稍后提醒</button>
              <button type="button" className="primary-small" disabled={applyState === 'working' || applyState === 'started'} onClick={() => void applyUpdate()}>
                {applyState === 'working' ? <span className="mini-loader" /> : null}
                {updateLabel}
              </button>
            </div>
            {status?.canApply ? <small className="update-modal-safe-note">已启用本地安全更新：下载包会校验 SHA-256。</small> : <small className="update-modal-safe-note">当前版本将打开 GitHub Release 下载页，下载后重新运行启动器即可。</small>}
          </section>
        </div>
      ) : null}

      {checkNotice ? (
        <div className={`version-check-result ${checkNoticeTone}`} role="status" aria-live="polite">
          <span className="version-check-result-mark" aria-hidden="true">{checkNoticeTone === 'success' ? '✓' : '!'}</span>
          <span>{checkNotice}</span>
        </div>
      ) : null}
    </>
  );
}
