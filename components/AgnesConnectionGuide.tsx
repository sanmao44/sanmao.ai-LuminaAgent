type Props = {
  baseUrl?: string;
  videoBaseUrl?: string;
  savedBaseUrl?: string;
  savedVideoBaseUrl?: string;
  savedKeyMasked?: string;
  hasDraftKey?: boolean;
  testResult?: string;
  onUseDomesticEndpoint?: () => void;
};

export default function AgnesConnectionGuide({ baseUrl, videoBaseUrl, savedBaseUrl, savedVideoBaseUrl, savedKeyMasked, hasDraftKey, testResult = '', onUseDomesticEndpoint }: Props) {
  const invalidKey = /(?:HTTP\s*)?401|API Key.*(?:无效|过期)|无效的令牌/i.test(testResult);
  const verified = !invalidKey && /Agnes API Key 已验证/i.test(testResult);
  const state = invalidKey ? 'error' : verified ? 'success' : hasDraftKey || savedKeyMasked ? 'pending' : 'empty';
  const stateLabel = invalidKey ? 'Agnes 拒绝了这个 Key' : verified ? '本次 Key 已验证' : hasDraftKey ? '新 Key 待测试' : savedKeyMasked ? '当前 Key 待验证' : '尚未填写密钥';
  const endpointChanged = Boolean(
    (baseUrl && savedBaseUrl && baseUrl.replace(/\/+$/, '') !== savedBaseUrl.replace(/\/+$/, ''))
    || (videoBaseUrl && savedVideoBaseUrl && videoBaseUrl.replace(/\/+$/, '') !== savedVideoBaseUrl.replace(/\/+$/, '')),
  );
  const keySource = hasDraftKey ? '新粘贴的 Key' : savedKeyMasked ? '当前保存的 Key' : '未提供';

  return <section className={`agnes-connection-guide ${state}`} aria-label="Agnes 连接检查">
    <div className="agnes-guide-head">
      <div>
        <span className="agnes-guide-kicker">AGNES CONNECTION CHECK</span>
        <strong>{stateLabel}</strong>
      </div>
      <span className="agnes-guide-status"><i aria-hidden="true" />{state === 'error' ? 'HTTP 401' : state === 'success' ? 'READY' : 'STEP 1/2'}</span>
    </div>
    <p>{hasDraftKey ? '本次测试会使用你刚粘贴的 Key；测试失败不会覆盖当前保存的 Key。' : savedKeyMasked ? '输入框留空时会继续使用当前保存的 Key；更换 Key 必须先把新的完整 Key 粘贴进来。' : '模型目录不会代替鉴权。请粘贴完整 Key，先点“只测试连接”，确认通过后再保存。'}</p>
    <div className="agnes-guide-meta">
      <span><b>本次测试地址</b><code>{baseUrl || '未配置'}</code></span>
      {videoBaseUrl && <span><b>本次视频地址</b><code>{videoBaseUrl}</code></span>}
      {savedBaseUrl && <span><b>已保存地址</b><code>{savedBaseUrl}</code></span>}
      {savedVideoBaseUrl && <span><b>已保存视频地址</b><code>{savedVideoBaseUrl}</code></span>}
      <span><b>本次使用 Key</b><code>{keySource}{savedKeyMasked && !hasDraftKey ? ` · ${savedKeyMasked}` : ''}</code></span>
    </div>
    {endpointChanged && <div className="agnes-guide-warning"><strong>地址与已保存配置不同</strong><span>只有测试成功并保存后，新的 API 地址和 Key 才会写入；当前两者不是同一个请求目标。</span></div>}
    {invalidKey && <div className="agnes-guide-error"><strong>Agnes 拒绝了当前 API Key</strong><span>请从 Agnes 平台复制一枚仍有效的完整 Key，覆盖输入框后重新测试。应用无法把过期或粘贴不完整的 Key 自动修复。</span></div>}
    {onUseDomesticEndpoint && (baseUrl !== 'https://api.agnes-ai.cn/v1' || videoBaseUrl !== 'https://api.agnes-ai.cn') && <button type="button" className="agnes-guide-action" onClick={onUseDomesticEndpoint}>切换到国内官方地址（与 .cn Key 配套）</button>}
    <a className="agnes-guide-link" href="https://platform.agnes-ai.cn/settings/apiKeys" target="_blank" rel="noreferrer">打开 Agnes API Keys 管理页 ↗</a>
  </section>;
}
