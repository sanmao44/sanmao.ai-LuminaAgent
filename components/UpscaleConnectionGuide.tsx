'use client';

import { useState } from 'react';
import type { PublicState, UpscaleConnection, UpscaleProviderId } from '@/lib/types';
import { UPSCALE_PROVIDER_LINKS, UPSCALE_PROVIDER_NAMES } from '@/lib/upscale-catalog';

type Props = {
  connections: UpscaleConnection[];
  onStateChanged: (state: PublicState) => void;
  onNotify: (message: string) => void;
};

type FormState = { first: string; second: string; bucket: string };
type Bucket = { name: string; region: string };

const initialForms: Record<UpscaleProviderId, FormState> = {
  'tencent-ci': { first: '', second: '', bucket: '' },
  'aliyun-viapi': { first: '', second: '', bucket: '' },
};

function connectionFor(connections: UpscaleConnection[], provider: UpscaleProviderId) {
  return connections.find((connection) => connection.provider === provider);
}

export default function UpscaleConnectionGuide({ connections, onStateChanged, onNotify }: Props) {
  const [forms, setForms] = useState(initialForms);
  const [bucketOptions, setBucketOptions] = useState<Bucket[]>([]);
  const [busy, setBusy] = useState<UpscaleProviderId | null>(null);
  const [message, setMessage] = useState<Record<string, string>>({});

  function update(provider: UpscaleProviderId, patch: Partial<FormState>) {
    setForms((current) => ({ ...current, [provider]: { ...current[provider], ...patch } }));
    setMessage((current) => ({ ...current, [provider]: '' }));
  }

  async function submit(provider: UpscaleProviderId) {
    const form = forms[provider];
    setBusy(provider);
    try {
      const body = provider === 'tencent-ci'
        ? { provider, secretId: form.first, secretKey: form.second, bucket: form.bucket }
        : { provider, accessKeyId: form.first, accessKeySecret: form.second };
      const response = await fetch('/api/upscale/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({})) as { state?: PublicState; error?: string; requiresBucketSelection?: boolean; buckets?: Bucket[] };
      if (!response.ok) throw new Error(data.error || '连接检测失败');
      if (data.requiresBucketSelection) {
        setBucketOptions(Array.isArray(data.buckets) ? data.buckets : []);
        setMessage((current) => ({ ...current, [provider]: '检测到多个存储桶，请选择一个继续。' }));
        return;
      }
      if (data.state) onStateChanged(data.state);
      setForms((current) => ({ ...current, [provider]: { first: '', second: '', bucket: '' } }));
      setBucketOptions([]);
      setMessage((current) => ({ ...current, [provider]: '连接成功，已可以在高清放大面板中使用。' }));
      onNotify(`${UPSCALE_PROVIDER_NAMES[provider]}已连接`);
    } catch (error) {
      setMessage((current) => ({ ...current, [provider]: error instanceof Error ? error.message : '连接检测失败' }));
    } finally { setBusy(null); }
  }

  async function remove(provider: UpscaleProviderId) {
    if (!window.confirm(`确定删除${UPSCALE_PROVIDER_NAMES[provider]}连接吗？`)) return;
    setBusy(provider);
    try {
      const response = await fetch(`/api/upscale/connections/${provider}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({})) as { state?: PublicState; error?: string };
      if (!response.ok) throw new Error(data.error || '删除连接失败');
      if (data.state) onStateChanged(data.state);
      setMessage((current) => ({ ...current, [provider]: '连接已删除。' }));
    } catch (error) { setMessage((current) => ({ ...current, [provider]: error instanceof Error ? error.message : '删除连接失败' })); }
    finally { setBusy(null); }
  }

  function renderLink(href: string, label: string) {
    return <a href={href} target="_blank" rel="noopener noreferrer" key={href}>{label} ↗</a>;
  }

  function renderCard(provider: UpscaleProviderId) {
    const connection = connectionFor(connections, provider);
    const form = forms[provider];
    const tencent = provider === 'tencent-ci';
    const links = UPSCALE_PROVIDER_LINKS[provider];
    const buckets = tencent && bucketOptions.length ? bucketOptions : [];
    return <article className="upscale-connection-card" key={provider}>
      <div className="upscale-connection-card-head"><div className="upscale-connection-logo">{tencent ? '腾' : '阿'}</div><div><strong>{UPSCALE_PROVIDER_NAMES[provider]}</strong><p>{tencent ? '连接后使用腾讯云高清超分。' : '连接后使用标准超分和 AI 生成式超分。'}</p></div><span className={`upscale-connection-status ${connection?.connected ? 'healthy' : 'idle'}`}>{connection?.connected ? '已连接' : '未连接'}</span></div>
      {connection?.connected && <div className="upscale-connection-saved"><span>凭证：{connection.maskedCredential}</span>{tencent && <span>存储桶：{connection.bucket || '已配置'} · {connection.region || '自动识别'}</span>}<button type="button" className="ghost-button" onClick={() => void remove(provider)} disabled={busy === provider}>删除连接</button></div>}
      <div className="upscale-connection-links"><a href={links.open} target="_blank" rel="noopener noreferrer">去官方开通 ↗</a>{links.docs.map((href, index) => renderLink(href, index === 0 ? '查看标准文档' : '查看生成式文档'))}<a href={links.pricing} target="_blank" rel="noopener noreferrer">查看官方价格 ↗</a></div>
      <div className="upscale-connection-fields">
        <label><span>{tencent ? 'SecretId' : 'AccessKey ID'}</span><input value={form.first} onChange={(event) => update(provider, { first: event.target.value })} autoComplete="off" placeholder={connection?.connected ? '留空继续使用已保存凭证' : '粘贴官方凭证'} /></label>
        <label><span>{tencent ? 'SecretKey' : 'AccessKey Secret'}</span><input type="password" value={form.second} onChange={(event) => update(provider, { second: event.target.value })} autoComplete="new-password" placeholder={connection?.connected ? '留空继续使用已保存凭证' : '粘贴官方密钥'} /></label>
        {tencent && buckets.length > 0 && <label><span>选择存储桶</span><select value={form.bucket} onChange={(event) => update(provider, { bucket: event.target.value })}><option value="">请选择</option>{buckets.map((bucket) => <option value={bucket.name} key={`${bucket.name}-${bucket.region}`}>{bucket.name} · {bucket.region || '自动识别'}</option>)}</select></label>}
      </div>
      <div className="upscale-connection-actions"><button type="button" className="primary-small" disabled={busy === provider || tencent && buckets.length > 0 && !form.bucket} onClick={() => void submit(provider)}>{busy === provider ? '检测中…' : connection?.connected ? '重新检测并保存' : '检测并连接'}</button>{message[provider] && <span className={message[provider].includes('成功') || message[provider].includes('已删除') ? 'success' : 'error'}>{message[provider]}</span>}</div>
      {tencent && <small className="upscale-connection-note">首次使用可能还需要在腾讯云控制台完成数据万象授权；本工具不会自动开通收费服务或修改云账号权限。</small>}
      {!tencent && <small className="upscale-connection-note">阿里云只保存加密凭证；若服务尚未购买或 RAM 权限不足，会显示对应的开通/授权提示。</small>}
    </article>;
  }

  return <section className="upscale-connection-guide surface"><div className="upscale-connection-guide-head"><div><span className="provider-platform">高清放大</span><h2>国内云高清服务</h2><p>密钥仅保存在本机服务端并加密存储，网页不会保存或回显完整密钥。</p></div></div><div className="upscale-connection-grid">{renderCard('tencent-ci')}{renderCard('aliyun-viapi')}</div></section>;
}
