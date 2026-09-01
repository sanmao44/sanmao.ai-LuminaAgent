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
  const [bucketSetupNeeded, setBucketSetupNeeded] = useState(false);
  const [aliyunServiceSetupNeeded, setAliyunServiceSetupNeeded] = useState(false);
  const [busy, setBusy] = useState<UpscaleProviderId | null>(null);
  const [message, setMessage] = useState<Record<string, string>>({});

  function update(provider: UpscaleProviderId, patch: Partial<FormState>) {
    setForms((current) => ({ ...current, [provider]: { ...current[provider], ...patch } }));
    setMessage((current) => ({ ...current, [provider]: '' }));
    if (provider === 'tencent-ci') setBucketSetupNeeded(false);
    if (provider === 'aliyun-viapi') setAliyunServiceSetupNeeded(false);
  }

  async function submit(provider: UpscaleProviderId) {
    const form = forms[provider];
    setBusy(provider);
    try {
      const body = provider === 'tencent-ci'
        ? { provider, secretId: form.first, secretKey: form.second, bucket: form.bucket }
        : { provider, accessKeyId: form.first, accessKeySecret: form.second };
      const response = await fetch('/api/upscale/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({})) as { state?: PublicState; error?: string; code?: string; requiresBucketSelection?: boolean; requiresBucketSetup?: boolean; buckets?: Bucket[] };
      if (data.requiresBucketSetup) {
        setBucketSetupNeeded(true);
        setMessage((current) => ({ ...current, [provider]: '还差 1 步：请先创建 COS 存储桶。' }));
        return;
      }
      if (!response.ok) {
        if (provider === 'aliyun-viapi' && (data.code === 'PERMISSION_DENIED' || data.code === 'NOT_PURCHASED')) setAliyunServiceSetupNeeded(true);
        throw new Error(data.error || '连接检测失败');
      }
      if (data.requiresBucketSelection) {
        setBucketOptions(Array.isArray(data.buckets) ? data.buckets : []);
        setMessage((current) => ({ ...current, [provider]: '检测到多个存储桶，请选择一个继续。' }));
        return;
      }
      if (data.state) onStateChanged(data.state);
      setForms((current) => ({ ...current, [provider]: { first: '', second: '', bucket: '' } }));
      setBucketOptions([]);
      setBucketSetupNeeded(false);
      setAliyunServiceSetupNeeded(false);
      setMessage((current) => ({ ...current, [provider]: '连接成功，已可以在高清放大面板中使用。' }));
      onNotify(`${UPSCALE_PROVIDER_NAMES[provider]}已连接`);
    } catch (error) {
      if (provider === 'tencent-ci' && error instanceof Error && error.message.includes('存储桶')) setBucketSetupNeeded(true);
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
      if (provider === 'tencent-ci') setBucketSetupNeeded(false);
      if (provider === 'aliyun-viapi') setAliyunServiceSetupNeeded(false);
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
    const storageLink = tencent ? UPSCALE_PROVIDER_LINKS['tencent-ci'].storage : null;
    const buckets = tencent && bucketOptions.length ? bucketOptions : [];
    const credentialNames = tencent ? ['SecretId', 'SecretKey'] : ['AccessKey ID', 'AccessKey Secret'];
    return <article className="upscale-connection-card" key={provider}>
      <div className="upscale-connection-card-head"><div className={`upscale-connection-logo ${tencent ? 'tencent' : 'aliyun'}`}><img src={tencent ? '/brand/tencent-cloud.svg' : '/brand/aliyun-cloud.ico'} alt={tencent ? '腾讯云 Logo' : '阿里云 Logo'} /></div><div><strong>{UPSCALE_PROVIDER_NAMES[provider]}</strong><p>{tencent ? '只需复制两项密钥即可连接。' : '只需复制两项密钥即可连接。'}</p></div><span className={`upscale-connection-status ${connection?.connected ? 'healthy' : 'idle'}`}>{connection?.connected ? '已连接' : '未连接'}</span></div>
      {connection?.connected && <div className="upscale-connection-saved"><span>已保存：{connection.maskedCredential}</span>{tencent && <span>存储桶：{connection.bucket || '已配置'} · {connection.region || '自动识别'}</span>}<button type="button" className="ghost-button" onClick={() => void remove(provider)} disabled={busy === provider}>删除连接</button></div>}
      {!connection?.connected && <div className="upscale-connection-steps">
        <strong>照着下面做就行</strong>
        <ol>
          <li><b>1</b><span>打开官方密钥页面</span><a href={links.keys} target="_blank" rel="noopener noreferrer">打开密钥页面 ↗</a></li>
          {tencent ? <>
            <li><b>2</b><span>如果出现安全提示，勾选“我已知晓风险”，点击“继续使用”</span></li>
            <li><b>3</b><span>点击“新建密钥”，复制 SecretId 和 SecretKey</span></li>
          </> : <>
            <li><b>2</b><span>点击“创建 AccessKey”；如果出现安全提示，按页面提示确认</span></li>
            <li><b>3</b><span>立即复制 AccessKey ID 和 AccessKey Secret（密钥通常只显示一次）</span></li>
          </>}
          <li><b>4</b><span>回到这里，粘贴到下面两行，点击“检测并连接”</span></li>
        </ol>
        <small>{tencent ? '截图中的“切换使用子账号密钥”不用点；本工具只需要这两个密钥。' : '不用进入“用户”或创建 RAM 用户，本工具只需要这两个 AccessKey 值。'}</small>
      </div>}
      {tencent && storageLink && (!connection?.connected || bucketSetupNeeded) && <div className={`upscale-connection-bucket ${bucketSetupNeeded ? 'needs-setup' : ''}`}><strong>腾讯云还需要一个 COS 存储桶</strong><span>没有存储桶时，先开通 COS 并创建一个“私有”存储桶；创建后进入该存储桶开启“数据万象（CI）”处理，再回到这里点击检测。</span><a href={storageLink} target="_blank" rel="noopener noreferrer">去创建存储桶 ↗</a></div>}
      {!tencent && aliyunServiceSetupNeeded && <div className="upscale-connection-bucket needs-setup"><strong>阿里云还差 1 步：开通“图像生产”</strong><span>AccessKey 有效，但当前账号还不能调用图像超分。打开官方页面，开通图像生产后回到这里重新检测。</span><a href={links.open} target="_blank" rel="noopener noreferrer">去开通图像生产 ↗</a></div>}
      <div className="upscale-connection-cost"><strong>费用说明</strong><span>{tencent ? 'COS 和数据万象通常按量计费；新用户可能有免费额度，超出后才收费。' : '阿里云通常提供免费体验或额度，正式 API 是否收费以官方价格页为准。'}</span><a href={links.pricing} target="_blank" rel="noopener noreferrer">查看官方价格 ↗</a></div>
      <details className="upscale-connection-more"><summary>更多官方信息（可跳过）</summary><div className="upscale-connection-links"><a href={links.open} target="_blank" rel="noopener noreferrer">去开通高清服务 ↗</a>{links.docs.map((href, index) => renderLink(href, index === 0 ? '查看标准文档' : '查看生成式文档'))}</div></details>
      <div className="upscale-connection-fields">
        <label><span>第 1 行：{credentialNames[0]}</span><input value={form.first} onChange={(event) => update(provider, { first: event.target.value })} autoComplete="off" placeholder={connection?.connected ? '留空，继续使用已保存密钥' : `粘贴 ${credentialNames[0]}`} /></label>
        <label><span>第 2 行：{credentialNames[1]}</span><input type="password" value={form.second} onChange={(event) => update(provider, { second: event.target.value })} autoComplete="new-password" placeholder={connection?.connected ? '留空，继续使用已保存密钥' : `粘贴 ${credentialNames[1]}`} /></label>
        {tencent && buckets.length > 0 && <label><span>选择存储桶</span><select value={form.bucket} onChange={(event) => update(provider, { bucket: event.target.value })}><option value="">请选择</option>{buckets.map((bucket) => <option value={bucket.name} key={`${bucket.name}-${bucket.region}`}>{bucket.name} · {bucket.region || '自动识别'}</option>)}</select></label>}
      </div>
      <div className="upscale-connection-actions"><button type="button" className="primary-small" disabled={busy === provider || tencent && buckets.length > 0 && !form.bucket} onClick={() => void submit(provider)}>{busy === provider ? '检测中…' : connection?.connected ? '重新检测并保存' : '检测并连接'}</button>{message[provider] && <span className={message[provider].includes('成功') || message[provider].includes('已删除') ? 'success' : 'error'}>{message[provider]}</span>}</div>
      {tencent && <small className="upscale-connection-note">首次使用请在存储桶中开启“数据万象（CI）”，并确认已开通对应图像处理服务。本工具会把原图自动上传到你自己的 COS 桶再超分，不会依赖外网中转，也不会修改云账号权限。</small>}
      {!tencent && <small className="upscale-connection-note">阿里云无需额外工具，超分时会自动上传到官方上海 OSS 临时地址；若服务尚未购买或 RAM 权限不足，会显示对应的开通/授权提示。</small>}
    </article>;
  }

  return <section className="upscale-connection-guide surface"><div className="upscale-connection-guide-head"><div><span className="provider-platform">高清放大</span><h2>国内云高清服务</h2><p>只需要从官方页面复制两项密钥，粘贴到对应卡片即可。密钥仅保存在本机服务端并加密存储；超分时会自动上传到你自己配置的存储桶，不依赖外网中转或公网图片。</p></div></div><div className="upscale-connection-grid">{renderCard('tencent-ci')}{renderCard('aliyun-viapi')}</div></section>;
}
