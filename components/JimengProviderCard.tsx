'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ProviderConnection, PublicState } from '@/lib/types';
import type { JimengAccount } from '@/lib/jimeng-cli';
import JimengAccountSummary from '@/components/JimengAccountSummary';

const OFFICIAL_URL = 'https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg';
const INSTALL_COMMAND = 'curl -fsSL https://jimeng.jianying.com/cli | bash';

type Props = {
  providers: ProviderConnection[];
  onStateChanged: (state: PublicState) => void;
  onNotify: (message: string) => void;
};

type AuthState = {
  status: 'idle' | 'detecting' | 'starting' | 'checking' | 'authorized' | 'failed';
  installed: boolean;
  version: string;
  command: string;
  verificationUri: string;
  userCode: string;
  deviceCode: string;
  message: string;
  error: string;
  account: JimengAccount | null;
  accountCheckedAt: string;
  accountError: string;
};

const initialAuth: AuthState = { status: 'idle', installed: false, version: '', command: '', verificationUri: '', userCode: '', deviceCode: '', message: '', error: '', account: null, accountCheckedAt: '', accountError: '' };

export default function JimengProviderCard({ providers, onStateChanged, onNotify }: Props) {
  const provider = useMemo(() => providers.find((item) => item.platform === 'jimeng-cli' || item.videoTransport === 'jimeng-cli'), [providers]);
  const [auth, setAuth] = useState<AuthState>(initialAuth);
  const [busy, setBusy] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);

  async function request(action: string, extra: Record<string, unknown> = {}) {
    const response = await fetch('/api/providers/jimeng', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '即梦 CLI 操作失败');
    if (data.state) onStateChanged(data.state);
    return data;
  }

  async function detect() {
    setAuth((old) => ({ ...old, status: 'detecting', error: '' }));
    try {
      const data = await request('detect');
      setAuth((old) => ({ ...old, ...data, status: data.authorized ? 'authorized' : data.installed ? 'idle' : 'failed', error: data.error || '' }));
      if (data.authorized && data.providerId) await syncProvider(data.providerId);
    } catch (error) {
      setAuth((old) => ({ ...old, status: 'failed', error: error instanceof Error ? error.message : '检测失败' }));
    }
  }

  async function refreshAccount() {
    if (accountBusy) return;
    setAccountBusy(true);
    setAuth((old) => ({ ...old, accountError: '' }));
    try {
      const data = await request('refresh-account');
      setAuth((old) => ({ ...old, ...data, account: data.account || null, accountError: data.accountError || '' }));
    } catch (error) {
      setAuth((old) => ({ ...old, accountError: error instanceof Error ? error.message : '读取即梦账户信息失败，请稍后重试。' }));
    } finally { setAccountBusy(false); }
  }

  useEffect(() => { void detect(); }, []);

  async function syncProvider(providerId: string) {
    const response = await fetch(`/api/providers/${providerId}/sync`, { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '即梦模型同步失败');
    if (data.state) onStateChanged(data.state);
  }

  async function waitForAuthorization(deviceCode: string) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const checked = await request('poll', { deviceCode });
      if (checked.status === 'authorized') return checked;
      if (checked.status === 'failed') throw new Error(checked.error || '即梦授权失败');
      setAuth((old) => ({ ...old, status: 'checking', message: '授权页面已打开，等待完成网页授权…' }));
    }
    throw new Error('等待即梦授权超时，请完成网页授权后点击重新连接；如果授权页面未打开，请点击下方授权链接。');
  }

  async function authorize(switchAccount = false) {
    const popup = typeof window !== 'undefined' ? window.open('', '_blank', 'noopener,noreferrer') : null;
    setBusy(true);
    setAuth((old) => ({ ...old, status: 'starting', error: '', message: '' }));
    try {
      const started = await request(switchAccount ? 'switch-account' : 'authorize');
      if (started.status === 'authorized' || started.authorized === true) {
        if (popup && !popup.closed) popup.close();
        if (started.providerId) await syncProvider(started.providerId);
        setAuth((old) => ({ ...old, ...started, status: 'authorized', message: '即梦已连接，图片和视频模型已同步。', error: '' }));
        onNotify(switchAccount ? '即梦账号已切换' : '即梦已连接');
        return;
      }
      if (!started.verificationUri) throw new Error('即梦 CLI 未返回有效授权地址，请更新 CLI 后重试');
      if (popup) popup.location.href = started.verificationUri;
      else window.open(started.verificationUri, '_blank', 'noopener,noreferrer');
      setAuth((old) => ({ ...old, ...started, status: 'checking', message: started.message || '授权页面已自动打开，请完成网页授权…' }));
      const checked = await waitForAuthorization(started.deviceCode);
      setAuth((old) => ({ ...old, ...checked }));
      await syncProvider(started.providerId);
      setAuth((old) => ({ ...old, status: 'authorized', message: '即梦已连接，图片和视频模型已同步。', error: '' }));
      onNotify(switchAccount ? '即梦账号已切换' : '即梦已连接');
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      const message = error instanceof Error ? error.message : '即梦授权失败';
      setAuth((old) => ({ ...old, status: 'failed', error: message }));
      onNotify(message);
    } finally { setBusy(false); }
  }

  async function copyInstallCommand() {
    try { await navigator.clipboard.writeText(INSTALL_COMMAND); onNotify('官方安装命令已复制'); }
    catch { onNotify('复制失败，请手动复制安装命令'); }
  }

  const connected = auth.status === 'authorized';
  const installed = auth.installed || Boolean(auth.version);
  return <article className="jimeng-provider-card surface">
    <div className="jimeng-provider-card-main">
      <div className="jimeng-provider-mark"><img src="/brand/jimeng-official.ico" alt="即梦官方 Logo" /></div>
      <div className="jimeng-provider-copy">
        <div className="jimeng-provider-title"><strong>即梦 CLI · 本地图片与视频</strong><span className={`jimeng-provider-status ${connected ? 'success' : installed ? 'ready' : 'muted'}`}>{connected ? '已连接' : installed ? '已安装，待授权' : '等待检测'}</span></div>
        <p>连接一次即梦账号，图片和视频工作台都可以直接使用。不需要 API Key，也不需要填写接口路径。</p>
        {auth.version && <small>已检测到 {auth.version}{auth.command ? ` · ${auth.command}` : ''}</small>}
        {auth.error && <small className="jimeng-provider-error">{auth.error}</small>}
        {auth.message && <small className="jimeng-provider-success">{auth.message}</small>}
      </div>
      <div className="jimeng-provider-actions">
        <button type="button" className="primary-small" disabled={busy} onClick={() => void authorize(connected)}>{busy ? '授权处理中…' : connected ? '重新授权并切换账号' : '连接即梦'}</button>
        <button type="button" className="ghost-button" disabled={auth.status === 'detecting'} onClick={() => void detect()}>{auth.status === 'detecting' ? '检测中…' : '重新检测'}</button>
      </div>
    </div>
    <JimengAccountSummary account={auth.account} checkedAt={auth.accountCheckedAt} error={auth.accountError} loading={accountBusy || auth.status === 'detecting' || auth.status === 'starting' || auth.status === 'checking'} onRefresh={provider ? () => void refreshAccount() : undefined} />
    {auth.verificationUri && <div className="jimeng-provider-auth-box"><div><span>授权窗口已准备</span><a href={auth.verificationUri} target="_blank" rel="noreferrer">如果没有自动打开，点击这里继续授权 ↗</a></div><b>{auth.userCode || '—'}</b></div>}
    {!installed && <div className="jimeng-provider-install"><span>未找到即梦 CLI？请先安装，安装后重新检测。</span><a href={OFFICIAL_URL} target="_blank" rel="noreferrer">官方安装说明 ↗</a><button type="button" onClick={() => void copyInstallCommand()}>复制安装命令</button><code>{INSTALL_COMMAND}</code></div>}
  </article>;
}
