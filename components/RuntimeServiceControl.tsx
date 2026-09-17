'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type RestartState = 'starting' | 'stopping' | 'building' | 'rolling-back' | 'completed' | 'failed' | 'failed-rolled-back';

type RuntimeStatus = {
  version?: string;
  buildId?: string;
  port?: number;
  networkMode?: 'local' | 'lan';
  sourceStale?: boolean;
  dependenciesChanged?: boolean;
  activeRequests?: number;
  draining?: boolean;
  restartStatus?: { operationId?: string; state?: RestartState; error?: string; rolledBack?: boolean } | null;
};

const restartInProgress = new Set<RestartState>(['starting', 'stopping', 'building', 'rolling-back']);

function reloadPage() {
  try {
    const url = new URL(window.location.href);
    // 重启（含从局域网切回本地）之后服务只监听本机，用局域网 IP 打开的页面会连不上。
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.hostname = 'localhost';
    url.searchParams.set('sanmao_reload', String(Date.now()));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}

export default function RuntimeServiceControl() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [operationId, setOperationId] = useState('');
  const reloadScheduled = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/runtime', { cache: 'no-store' });
      if (!response.ok) throw new Error(`状态读取失败：${response.status}`);
      const next = await response.json() as RuntimeStatus;
      setStatus(next);
      const restart = next.restartStatus;
      if (!restart || !operationId || restart.operationId !== operationId) return;
      if (restart.state === 'completed' && !reloadScheduled.current) {
        reloadScheduled.current = true;
        setMessage('服务已重启，正在载入最新页面…');
        window.setTimeout(reloadPage, 700);
      } else if (restart.state === 'failed-rolled-back') {
        setBusy(false);
        setMessage(`新版本启动失败，已自动恢复旧服务：${restart.error || '请查看启动器日志'}`);
      } else if (restart.state === 'failed') {
        setBusy(false);
        setMessage(restart.error || '重启失败，请使用桌面启动器重试');
      }
    } catch {
      // The expected gap during a restart is that the old server is briefly
      // unreachable. Keep the card in a restart state and let the next poll
      // observe the new server.
    }
  }, [operationId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const postAction = async (action: 'restart' | 'switch-local', force: boolean) => {
    const switching = action === 'switch-local';
    setBusy(true);
    setMessage(force ? '正在强制重启服务…' : switching ? '正在切回本地模式…' : '正在准备重启服务…');
    try {
      const response = await fetch('/api/runtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(force ? { force: true } : {}) }),
        cache: 'no-store',
      });
      const result = await response.json().catch(() => ({})) as { operationId?: string; error?: string; requiresConfirmation?: boolean; requiresFormalUpdate?: boolean };
      if (response.status === 409 && result.requiresConfirmation) {
        const confirmed = window.confirm(`${result.error || '当前有任务正在执行'}。

强制重启会中断这些任务，是否继续？`);
        if (confirmed) return void postAction(action, true);
        setBusy(false);
        setMessage('已取消重启，当前任务会继续运行。');
        return;
      }
      if (!response.ok) {
        setBusy(false);
        setMessage(result.requiresFormalUpdate ? '检测到依赖文件变化，请使用上方“正式更新”流程。' : result.error || '重启请求失败');
        return;
      }
      setOperationId(result.operationId || '');
      setMessage(switching ? '正在切回本地模式，完成后会自动刷新页面…' : '重启任务已启动，正在停止旧服务并构建…');
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : '重启请求失败');
    }
  };

  const restart = status?.restartStatus?.state;
  const inProgress = busy || Boolean(restart && restartInProgress.has(restart));
  const lan = status?.networkMode === 'lan';
  const dependencyWarning = status?.dependenciesChanged === true;

  return (
    <section className="runtime-service-card settings-card surface" aria-live="polite">
      <div className="settings-card-head">
        <div>
          <span>本地服务</span>
          <h2>服务运行与重启</h2>
        </div>
        <span className={`runtime-status-badge ${inProgress ? 'working' : 'ready'}`}>
          {inProgress ? '重启中' : '运行中'}
        </span>
      </div>
      <p className="settings-card-note">关闭网页不会关闭后台服务。代码修改后，可从这里安全重启并载入最新构建。</p>
      <div className="runtime-service-details">
        <span>版本 <b>{status?.version || '读取中…'}</b></span>
        <span>端口 <b>{status?.port || '—'}</b></span>
        <span>构建 <b>{status?.buildId ? status.buildId.slice(0, 10) : '未就绪'}</b></span>
        <span>活动任务 <b className={status?.activeRequests ? 'warning' : ''}>{status?.activeRequests ?? '—'}</b></span>
      </div>
      {lan ? <div className="runtime-service-hint">当前是局域网模式，同一网络的设备都能访问。切回本地模式后只在本机可用，其他设备会断开。</div> : null}
      {dependencyWarning ? <div className="runtime-service-hint warning">检测到依赖文件发生变化，请使用正式更新流程，不要用普通重启。</div> : null}
      {status?.sourceStale && !dependencyWarning ? <div className="runtime-service-hint warning">检测到源码尚未构建，点击重启后会重新构建。</div> : null}
      {message ? <div className={`runtime-service-message ${restart === 'failed' || restart === 'failed-rolled-back' ? 'error' : ''}`}>{message}</div> : null}
      {lan ? (
        <button type="button" className="primary-small runtime-restart-button" disabled={inProgress} onClick={() => void postAction('switch-local', false)}>
          {inProgress ? '正在切换…' : '切回本地模式'}
        </button>
      ) : (
        <button type="button" className="primary-small runtime-restart-button" disabled={dependencyWarning || inProgress} onClick={() => void postAction('restart', false)}>
          {inProgress ? '正在重启…' : '重启并载入最新代码'}
        </button>
      )}
    </section>
  );
}
