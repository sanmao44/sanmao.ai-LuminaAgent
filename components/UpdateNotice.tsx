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
type UpdateProgressStage = 'queued' | 'downloading' | 'verifying' | 'starting' | 'completed' | 'failed';
type UpdateProgress = {
  jobId: string;
  version: string;
  stage: UpdateProgressStage;
  message: string;
  percent: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error?: string;
};

const DISMISSED_KEY = 'sanmao-dismissed-update-version';
const CHECKED_KEY = 'sanmao-update-checked-at';
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const MANUAL_CHECK_COOLDOWN = 30 * 1000;

function getCheckErrorMessage(data: UpdateStatus, responseStatus?: number) {
  const error = data.error || '';
  if (responseStatus === 429 || /\b(?:429|5\d\d)\b|rate.?limit|too many requests|更新清单返回 HTTP 5/i.test(error)) {
    return '更新服务暂时繁忙，请稍后再试';
  }
  if (/timeout|timed out|aborted|fetch failed|网络|ECONNRESET|ENETUNREACH/i.test(error)) {
    return '网络连接超时，请检查网络后重试';
  }
  return error || '检查更新失败，请稍后重试';
}

function isTransientCheckError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /timeout|timed out|aborted/i.test(message);
}

function openExternal(url?: string) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 1024) return `${Math.max(0, Math.round(value))} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
}

function progressStageLabel(stage?: UpdateProgressStage) {
  switch (stage) {
    case 'queued': return '准备中';
    case 'downloading': return '下载中';
    case 'verifying': return '校验中';
    case 'starting': return '启动更新';
    case 'completed': return '正在重启';
    case 'failed': return '需要重试';
    default: return '处理中';
  }
}

export default function UpdateNotice() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [applyState, setApplyState] = useState<ApplyState>('idle');
  const [applyMessage, setApplyMessage] = useState('');
  const [applyProgress, setApplyProgress] = useState<UpdateProgress | null>(null);
  const [checkNotice, setCheckNotice] = useState('');
  const [checkNoticeTone, setCheckNoticeTone] = useState<CheckNoticeTone>('success');
  const checkNoticeTimerRef = useRef<number | null>(null);
  const lastManualCheckRef = useRef(0);

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
    if (announce) {
      const elapsed = Date.now() - lastManualCheckRef.current;
      if (elapsed < MANUAL_CHECK_COOLDOWN) {
        announceCheckResult('检查过于频繁，请稍后再试', 'error');
        return;
      }
      lastManualCheckRef.current = Date.now();
    }
    setBusy(true);
    if (announce) announceCheckResult('');
    try {
      const response = await fetch(`/api/update${force ? '?force=1' : ''}`, { cache: 'no-store' });
      const data = await response.json() as UpdateStatus;
      if (!response.ok || data.error) {
        setStatus(data);
        if (announce) announceCheckResult(getCheckErrorMessage(data, response.status), 'error');
        return;
      }

      setStatus(data);
      window.localStorage.setItem(CHECKED_KEY, String(Date.now()));
      const wasDismissed = data.latestVersion
        ? window.localStorage.getItem(DISMISSED_KEY) === data.latestVersion
        : false;
      if (data.hasUpdate && (!wasDismissed || announce)) setShowModal(true);
      if (announce && !data.hasUpdate) announceCheckResult('当前已是最新版本');
    } catch (error) {
      if (announce) announceCheckResult(
        isTransientCheckError(error) ? '更新服务暂时繁忙，请稍后再试' : '检查更新失败，请稍后重试',
        'error',
      );
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
    if (applyState === 'error') return '重试更新';
    return status?.canApply ? '立即更新并重启' : '前往下载';
  }, [applyState, status?.canApply]);

  function dismissUpdate() {
    if (status?.latestVersion) window.localStorage.setItem(DISMISSED_KEY, status.latestVersion);
    setShowModal(false);
  }

  async function waitForRestart(currentVersion: string) {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      try {
        const checkResponse = await fetch('/api/update?force=1', { cache: 'no-store' });
        if (checkResponse.ok) {
          const next = await checkResponse.json() as UpdateStatus;
          if (next.currentVersion !== currentVersion) {
            window.location.reload();
            return;
          }
        }
      } catch {
        // 更新器正在停止旧服务，短暂请求失败是预期情况。
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
    setApplyState('error');
    setApplyMessage('更新程序启动超时，请重新运行启动器完成更新。');
  }

  async function watchUpdateProgress(jobId: string, currentVersion: string) {
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`/api/update/progress?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
        if (response.ok) {
          const progress = await response.json() as UpdateProgress;
          setApplyProgress(progress);
          setApplyMessage(progress.message);
          if (progress.stage === 'failed') {
            setApplyState('error');
            return;
          }
          if (progress.stage === 'completed') {
            setApplyState('started');
            await waitForRestart(currentVersion);
            return;
          }
        }
      } catch {
        // 网络短暂抖动时继续轮询，避免把正在下载的任务误判为失败。
      }
      await new Promise((resolve) => window.setTimeout(resolve, 650));
    }
    setApplyState('error');
    setApplyMessage('更新任务响应超时，请检查网络后重试。');
  }

  async function applyUpdate() {
    if (!status?.hasUpdate) return;
    if (!status.canApply) {
      openExternal(status.releaseUrl);
      return;
    }

    setApplyState('working');
    setApplyProgress(null);
    setApplyMessage('正在下载并校验更新包，用户数据不会被覆盖。');
    try {
      const response = await fetch('/api/update/apply', { method: 'POST', cache: 'no-store' });
      const data = await response.json() as { started?: boolean; jobId?: string; error?: string; progress?: UpdateProgress };
      if ((!response.ok && response.status !== 409) || !data.jobId) throw new Error(data.error || '更新准备失败');
      if (data.progress) setApplyProgress(data.progress);
      if (data.error && response.status !== 409) throw new Error(data.error);
      await watchUpdateProgress(data.jobId, status.currentVersion);
    } catch (error) {
      setApplyState('error');
      setApplyMessage(error instanceof Error ? error.message : '更新失败，请检查网络后重试。');
    }
  }

  const hasUpdate = Boolean(status?.hasUpdate && status.latestVersion && status.releaseUrl);

  return (
    <>
      <aside className={`version-card ${hasUpdate ? 'has-update' : ''}`} aria-label="SANMAO.AI 版本信息">
        <div className="version-card-anchor">
        <button
          type="button"
          className="version-card-head"
          aria-label={hasUpdate ? '发现新版本，点击查看更新' : busy ? '正在检查更新…' : '点击检查更新'}
          data-tooltip={hasUpdate ? '发现新版本，点击查看更新' : busy ? '正在检查更新…' : '点击检查更新'}
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
        {checkNotice ? (
          <div className={`version-check-result ${checkNoticeTone}`} role="status" aria-live="polite">
            <span className="version-check-result-mark" aria-hidden="true">{checkNoticeTone === 'success' ? '✓' : '!'}</span>
            <span>{checkNotice}</span>
          </div>
        ) : null}
        </div>
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
              {applyState !== 'idle' ? (
                <div className={`update-progress ${applyState}`} role="status" aria-live="polite">
                  <div className="update-progress-heading">
                    <span className="update-progress-loader" aria-hidden="true" />
                    <strong>{applyProgress?.message || applyMessage}</strong>
                    <b>{applyProgress?.percent === null || applyProgress?.percent === undefined ? '…' : `${applyProgress.percent}%`}</b>
                  </div>
                  <div className="update-progress-track" aria-hidden="true">
                    <span className={applyProgress?.percent === null || applyProgress?.percent === undefined ? 'indeterminate' : ''} style={{ width: `${Math.max(3, applyProgress?.percent || 0)}%` }} />
                  </div>
                  <div className="update-progress-meta">
                    <span>{progressStageLabel(applyProgress?.stage)}</span>
                    {applyProgress?.downloadedBytes ? <span>{formatBytes(applyProgress.downloadedBytes)}{applyProgress.totalBytes ? ` / ${formatBytes(applyProgress.totalBytes)}` : ''}</span> : null}
                  </div>
                  {applyState === 'error' && applyProgress?.error ? <small>{applyProgress.error}</small> : null}
                </div>
              ) : null}
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

    </>
  );
}
