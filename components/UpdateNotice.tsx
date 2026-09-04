'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';

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
type UpdateProgressResponse = {
  progress?: UpdateProgress | null;
  currentVersion?: string;
};
type UpdateProgress = {
  jobId: string;
  version: string;
  stage: 'queued' | 'downloading' | 'verifying' | 'starting' | 'completed' | 'failed';
  message: string;
  percent: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  startedAt: string;
  updatedAt: string;
  error?: string;
};

const DISMISSED_KEY = 'sanmao-dismissed-update-version';
const CHECKED_KEY = 'sanmao-update-checked-at';
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const PROJECT_URL = 'https://github.com/sanmao44/sanmao.ai-LuminaAgent';
const AUTO_RELOAD_DELAY_MS = 1500;

function openExternal(url?: string) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function versionParts(value: string) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : [0, 0, 0];
}

function isVersionAtLeast(currentVersion: string | undefined, targetVersion: string | undefined) {
  if (!currentVersion || !targetVersion) return false;
  const current = versionParts(currentVersion);
  const target = versionParts(targetVersion);
  for (let index = 0; index < 3; index += 1) {
    if (current[index] !== target[index]) return current[index] > target[index];
  }
  return true;
}

export default function UpdateNotice() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [showModal, setShowModal] = useState(false);
  useBodyScrollLock(showModal);
  const [applyState, setApplyState] = useState<ApplyState>('idle');
  const [applyMessage, setApplyMessage] = useState('');
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [refreshedVersion, setRefreshedVersion] = useState('');
  const [checkNotice, setCheckNotice] = useState('');
  const [checkNoticeTone, setCheckNoticeTone] = useState<CheckNoticeTone>('success');
  const checkNoticeTimerRef = useRef<number | null>(null);
  const updateTargetVersionRef = useRef<string | null>(null);
  const autoReloadTimerRef = useRef<number | null>(null);
  const autoReloadScheduledRef = useRef(false);

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
    if (autoReloadTimerRef.current !== null) window.clearTimeout(autoReloadTimerRef.current);
  }, []);

  const forceReloadApp = useCallback(() => {
    // Cancelling any pending timer here prevents a double navigation when the
    // user clicks the tray while the automatic restart countdown is running.
    if (autoReloadTimerRef.current !== null) {
      window.clearTimeout(autoReloadTimerRef.current);
      autoReloadTimerRef.current = null;
    }
    try {
      const url = new URL(window.location.href);
      // A cache-busting query makes the browser request the main document from
      // the restarted server instead of reusing a cached shell. The server then
      // returns fresh HTML that references the newly built, content-hashed
      // static assets, so layout/CSS changes from the update actually render.
      url.searchParams.set('sanmao_reload', String(Date.now()));
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  }, []);

  const announceRefreshRequired = useCallback((version: string) => {
    updateTargetVersionRef.current = null;
    setUpdateProgress(null);
    setApplyState('idle');
    setShowModal(false);
    setRefreshedVersion(version);
    setRefreshRequired(true);
    // Do not rely on the user manually refreshing: a normal reload can leave
    // the previous build's layout cached. Force the app to restart against the
    // newly installed build after a short, visible grace period.
    if (autoReloadScheduledRef.current) return;
    autoReloadScheduledRef.current = true;
    if (autoReloadTimerRef.current !== null) window.clearTimeout(autoReloadTimerRef.current);
    autoReloadTimerRef.current = window.setTimeout(() => {
      autoReloadTimerRef.current = null;
      void forceReloadApp();
    }, AUTO_RELOAD_DELAY_MS);
  }, [forceReloadApp]);

  const readProgress = useCallback(async (jobId?: string) => {
    try {
      const params = new URLSearchParams();
      if (jobId) params.set('jobId', jobId);
      const query = params.toString() ? `?${params.toString()}` : '';
      const response = await fetch(`/api/update/progress${query}`, { cache: 'no-store' });
      if (!response.ok) return null;
      const data = await response.json() as UpdateProgressResponse;
      if (!data.progress) {
        const targetVersion = updateTargetVersionRef.current;
        if (targetVersion && data.currentVersion && isVersionAtLeast(data.currentVersion, targetVersion)) {
          announceRefreshRequired(data.currentVersion);
          return null;
        }
        setUpdateProgress(null);
        setApplyState('idle');
        return null;
      }
      updateTargetVersionRef.current = data.progress.version;
      setUpdateProgress(data.progress);
      setApplyMessage(data.progress.error || data.progress.message);
      setApplyState(data.progress.stage === 'failed' ? 'error' : data.progress.stage === 'completed' ? 'started' : 'started');
      return data.progress;
    } catch {
      return null;
    }
  }, [announceRefreshRequired]);

  useEffect(() => {
    void readProgress();
  }, [readProgress]);

  useEffect(() => {
    if (!updateProgress || updateProgress.stage === 'failed' || !status?.currentVersion) return;
    if (isVersionAtLeast(status.currentVersion, updateProgress.version)) {
      if (updateTargetVersionRef.current) {
        announceRefreshRequired(status.currentVersion);
        return;
      }
      updateTargetVersionRef.current = null;
      setUpdateProgress(null);
      setApplyState('idle');
      return;
    }
    let cancelled = false;
    const poll = window.setInterval(async () => {
      const progress = await readProgress(updateProgress.jobId);
      if (cancelled || !progress) return;
      if ((progress.stage === 'starting' || progress.stage === 'completed') && !isVersionAtLeast(status?.currentVersion, progress.version)) {
        try {
          const checkResponse = await fetch('/api/update?force=1', { cache: 'no-store' });
          if (checkResponse.ok) {
            const next = await checkResponse.json() as UpdateStatus;
            setStatus(next);
            if (isVersionAtLeast(next.currentVersion, progress.version)) {
              window.clearInterval(poll);
              announceRefreshRequired(next.currentVersion);
            }
          }
        } catch {
          // 服务重启期间短暂不可访问，继续保留进度条并重试。
        }
      }
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [announceRefreshRequired, readProgress, status?.currentVersion, updateProgress?.jobId, updateProgress?.stage]);

  const check = useCallback(async (force = false) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/update${force ? '?force=1' : ''}`, { cache: 'no-store' });
      const data = await response.json() as UpdateStatus;
      if (!response.ok || data.error) {
        setStatus(data);
        return;
      }

      setStatus(data);
      window.localStorage.setItem(CHECKED_KEY, String(Date.now()));
      const wasDismissed = data.latestVersion
        ? window.localStorage.getItem(DISMISSED_KEY) === data.latestVersion
        : false;
      if (data.hasUpdate && !wasDismissed) setShowModal(true);
    } catch {
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
    if (applyState === 'working') return '正在启动更新…';
    if (applyState === 'started') return '更新进行中…';
    return status?.canApply ? '立即更新并重启' : '前往下载';
  }, [applyState, status?.canApply]);

  function dismissUpdate() {
    if (status?.latestVersion) window.localStorage.setItem(DISMISSED_KEY, status.latestVersion);
    setShowModal(false);
  }

  async function applyUpdate(runInBackground = false) {
    if (!status?.hasUpdate) return;
    if (!status.canApply) {
      openExternal(status.releaseUrl);
      return;
    }

    setApplyState('working');
    setApplyMessage('正在启动后台更新任务，用户数据不会被覆盖。');
    try {
      const response = await fetch('/api/update/apply', { method: 'POST', cache: 'no-store' });
      const data = await response.json() as { started?: boolean; jobId?: string; version?: string; error?: string };
      if (!response.ok || !data.started) throw new Error(data.error || '更新准备失败');

      updateTargetVersionRef.current = data.version || status.latestVersion || null;
      setApplyState('started');
      await readProgress(data.jobId);
      if (runInBackground) setShowModal(false);
    } catch (error) {
      setApplyState('error');
      setApplyMessage(error instanceof Error ? error.message : '更新失败，请前往 GitHub 手动下载。');
    }
  }

  const progressPercent = updateProgress?.percent;
  const progressLabel = updateProgress
    ? updateProgress.stage === 'downloading' ? '正在下载更新'
      : updateProgress.stage === 'verifying' ? '正在校验更新'
        : updateProgress.stage === 'starting' ? '正在安装并重启'
          : updateProgress.stage === 'completed' ? '更新即将完成'
            : updateProgress.stage === 'failed' ? '更新失败'
              : '正在准备更新'
    : '';
  const updateInProgress = Boolean(updateProgress && !['failed', 'completed'].includes(updateProgress.stage));

  const hasUpdate = Boolean(status?.hasUpdate && status.latestVersion && status.releaseUrl);
  const projectUrl = status?.projectUrl || PROJECT_URL;
  const versionLabel = hasUpdate
    ? '发现新版本，点击查看更新'
    : busy
      ? '正在自动检查更新…'
      : status?.error
        ? '暂时无法获取更新状态'
        : status
          ? '当前已是最新版本'
          : '正在获取版本状态…';

  return (
    <>
      {refreshRequired ? (
        <button
          type="button"
          className="update-progress-tray complete refresh-required"
          onClick={() => void forceReloadApp()}
          aria-label="应用正在自动重启以载入新版本"
        >
          <span className="update-progress-tray-orb" aria-hidden="true" />
          <span className="update-progress-tray-copy">
            <strong>更新完成，正在自动重启…</strong>
            <small>已更新到 v{refreshedVersion || status?.currentVersion || '最新版本'}，如未自动跳转可点击此处</small>
          </span>
          <span className="update-progress-tray-value">重启</span>
        </button>
      ) : updateProgress ? (
        <button
          type="button"
          className={`update-progress-tray ${updateProgress.stage === 'failed' ? 'error' : updateProgress.stage === 'completed' ? 'complete' : ''}`}
          onClick={() => setShowModal(true)}
          aria-label="查看更新进度"
        >
          <span className="update-progress-tray-orb" aria-hidden="true" />
          <span className="update-progress-tray-copy">
            <strong>{progressLabel}</strong>
            <small>{updateProgress.message}</small>
          </span>
          <span className="update-progress-tray-value">{progressPercent === null ? '…' : `${progressPercent}%`}</span>
        </button>
      ) : null}
      <aside className={`version-card ${hasUpdate ? 'has-update' : ''}`} aria-label="SANMAO.AI 版本信息">
        <div className="version-card-anchor">
          <div className="version-card-head">
            <a
              className="version-card-github"
              href={projectUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="打开 SANMAO.AI GitHub 项目主页（新窗口）"
              data-tooltip="打开 GitHub 项目主页"
            >
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.084-.729.084-.729 1.205.084 1.84 1.236 1.84 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.404 1.02.005 2.04.137 3 .404 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.212 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>
            </a>
            <button
              type="button"
              className="version-card-check"
              aria-label={versionLabel}
              disabled={busy}
              onClick={() => {
                if (hasUpdate) setShowModal(true);
                else announceCheckResult(status?.error || (status ? '当前已是最新版本' : '正在获取版本状态…'), status?.error ? 'error' : 'success');
              }}
            >
              <div>
                <strong>SANMAO.AI</strong>
                <small>v{status?.currentVersion || '…'}</small>
              </div>
              {hasUpdate ? <i className="version-update-dot" aria-label="有可用更新" /> : null}
            </button>
          </div>
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
          <button type="button" onClick={() => openExternal(projectUrl)}>项目主页</button>
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
              {applyState !== 'idle' || updateProgress ? (
                <div className={`update-progress ${applyState} ${progressPercent !== null ? 'is-determinate' : ''}`} role="status" aria-live="polite">
                  <div className="update-progress-head">
                    {updateProgress?.stage === 'failed' || applyState === 'error' ? <span className="update-progress-error-mark" aria-hidden="true">!</span> : <span className="update-progress-spinner" aria-hidden="true" />}
                    <strong>{updateProgress ? progressLabel : applyState === 'working' ? '正在启动更新' : applyState === 'started' ? '更新进行中' : '更新失败'}</strong>
                    {updateProgress?.stage !== 'failed' && applyState !== 'error' ? <span className="update-progress-dots" aria-hidden="true">...</span> : null}
                  </div>
                  <div className="update-progress-bar" aria-hidden="true"><span style={progressPercent === null || progressPercent === undefined ? undefined : { width: `${Math.max(0, Math.min(100, progressPercent))}%` }} /></div>
                  <p>{updateProgress?.error || updateProgress?.message || applyMessage}</p>
                </div>
              ) : null}
            </div>
            <div className="update-modal-actions">
              <button type="button" className="ghost-button" disabled={applyState === 'working'} onClick={dismissUpdate}>稍后提醒</button>
              {status?.canApply && applyState === 'idle' ? <button type="button" className="ghost-button update-background-button" onClick={() => void applyUpdate(true)}>后台更新</button> : null}
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
