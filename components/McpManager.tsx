'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';
import { deriveMcpServerName, headersToText, parseMcpConfigText } from '@/lib/mcp/config-import';
import styles from './McpManager.module.css';

type McpServerView = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  allowWrite: boolean;
  headerNames: string[];
  hasHeaders: boolean;
  enabledTools: string[];
};

type ProbeTool = { name: string; title: string; description: string; readOnly: boolean; enabled: boolean; oversized?: boolean };
type ProbeState = { status: 'busy' | 'done' | 'error'; message: string; tools: ProbeTool[]; toolCount: number; readOnly: number };
type Draft = { paste: string; name: string; url: string; headers: string; allowWrite: boolean };

const EMPTY_DRAFT: Draft = { paste: '', name: '', url: '', headers: '', allowWrite: false };

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) throw new Error(String((data as { error?: string }).error || '请求失败'));
  return data as Record<string, unknown>;
}

/** 请求头按「名称: 值」逐行填写，空行忽略；服务端还会再做一次白名单校验。 */
function parseHeaders(text: string) {
  const headers: Record<string, string> = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const name = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (name && value) headers[name] = value;
  }
  return Object.keys(headers).length ? headers : undefined;
}

function hostOf(url: string) {
  try { return new URL(url).host; } catch { return url; }
}

export default function McpManager({ disabled, icon }: { disabled: boolean; icon: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [limit, setLimit] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [probes, setProbes] = useState<Record<string, ProbeState>>({});
  const [confirming, setConfirming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useBodyScrollLock(open);

  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);

  /* 删除确认悬着容易误触：几秒内没继续操作就自动复位。 */
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(''), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const applyPayload = useCallback((data: Record<string, unknown>) => {
    if (Array.isArray(data.servers)) setServers(data.servers as McpServerView[]);
    if (typeof data.limit === 'number' && data.limit > 0) setLimit(data.limit);
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
      applyPayload(await requestJson('/api/mcp'));
    });
  }, [open, run, applyPayload]);

  const enabledCount = servers.filter((server) => server.enabled).length;

  /** 把别处复制来的配置填进表单：只做识别，仍然要用户确认后才提交。 */
  function importConfig() {
    try {
      const parsed = parseMcpConfigText(draft.paste);
      setDraft((current) => ({ ...current, name: parsed.name, url: parsed.url, headers: headersToText(parsed.headers), paste: '' }));
      setError('');
      setNotice(`${parsed.note}；确认无误后点「添加并自检」。`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '识别失败');
    }
  }

  async function addServer() {
    await run(async () => {
      const name = draft.name.trim() || deriveMcpServerName(draft.url);
      const data = await requestJson('/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, url: draft.url, headers: parseHeaders(draft.headers), allowWrite: draft.allowWrite }),
      });
      applyPayload(data);
      setDraft(EMPTY_DRAFT);
      const created = data.server as McpServerView | undefined;
      setNotice(`已添加 ${created?.name || 'MCP 服务'}：连上后助手才能看到它的工具。`);
      if (created?.id) await probeServer(created);
    });
  }

  async function updateServer(server: McpServerView, patch: Record<string, unknown>) {
    await run(async () => {
      applyPayload(await requestJson(`/api/mcp/${encodeURIComponent(server.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }));
      if (patch.allowWrite !== undefined) {
        setNotice(patch.allowWrite ? `已允许「${server.name}」执行有副作用的工具，请确认信任这个服务。` : `已禁止「${server.name}」执行有副作用的工具，只保留只读工具。`);
      }
    });
  }

  async function removeServer(server: McpServerView) {
    if (confirming !== server.id) { setConfirming(server.id); return; }
    setConfirming('');
    await run(async () => {
      applyPayload(await requestJson(`/api/mcp/${encodeURIComponent(server.id)}`, { method: 'DELETE' }));
      setProbes((current) => {
        const next = { ...current };
        delete next[server.id];
        return next;
      });
      setNotice(`已删除 ${server.name}，它的工具不会再下发给助手。`);
    });
  }

  async function probeServer(server: McpServerView) {
    setError('');
    setProbes((current) => ({ ...current, [server.id]: { status: 'busy', message: '正在连接…', tools: [], toolCount: 0, readOnly: 0 } }));
    try {
      const data = await requestJson(`/api/mcp/${encodeURIComponent(server.id)}/probe`, { method: 'POST' });
      const tools = Array.isArray(data.tools) ? data.tools as ProbeTool[] : [];
      setProbes((current) => ({
        ...current,
        [server.id]: {
          status: 'done',
          message: `连接成功，共 ${data.toolCount || 0} 个工具，其中 ${data.readOnly || 0} 个是只读工具。`,
          tools,
          toolCount: Number(data.toolCount) || 0,
          readOnly: Number(data.readOnly) || 0,
        },
      }));
    } catch (failure) {
      setProbes((current) => ({
        ...current,
        [server.id]: { status: 'error', message: failure instanceof Error ? failure.message : '连接失败', tools: [], toolCount: 0, readOnly: 0 },
      }));
    }
  }

  /* 一个工具都不勾选等于"全部启用"，所以界面必须挡住"取消最后一个"这种反向操作。 */
  async function toggleTool(server: McpServerView, toolName: string) {
    const probe = probes[server.id];
    if (!probe?.tools.length) return;
    // 参数结构超限的工具本来就不会下发，别让勾选动作假装生效。
    if (probe.tools.find((tool) => tool.name === toolName)?.oversized) return;
    const selected = probe.tools.filter((tool) => tool.enabled).map((tool) => tool.name);
    const next = selected.includes(toolName) ? selected.filter((name) => name !== toolName) : [...selected, toolName];
    if (!next.length) {
      setNotice('至少要留一个工具。想全部停用请直接关闭这个服务的「启用」开关。');
      return;
    }
    await run(async () => {
      applyPayload(await requestJson(`/api/mcp/${encodeURIComponent(server.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabledTools: next }),
      }));
      setProbes((current) => ({
        ...current,
        [server.id]: { ...probe, tools: probe.tools.map((tool) => ({ ...tool, enabled: next.includes(tool.name) })) },
      }));
    });
  }

  return (
    <>
      <button type="button" className={styles.trigger} data-tooltip={enabledCount ? `MCP · ${enabledCount} 个服务已启用` : 'MCP 服务'} aria-label={enabledCount ? `MCP 服务（${enabledCount} 个已启用）` : 'MCP 服务'} aria-haspopup="dialog" disabled={disabled} onClick={() => { setError(''); setNotice(''); setConfirming(''); setHelpOpen(false); setOpen(true); }}>{icon}{enabledCount > 0 && <span className={styles.activeBadge} aria-hidden="true">{enabledCount > 9 ? '9+' : enabledCount}</span>}</button>
      {open && <dialog ref={dialog} className={styles.dialog} aria-labelledby="mcp-manager-title" onClose={() => setOpen(false)} onCancel={(event) => { if (busy) { event.preventDefault(); return; } if (helpOpen) { event.preventDefault(); setHelpOpen(false); } }}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <div className={styles.titleRow}>
              <h2 id="mcp-manager-title"><i aria-hidden="true">M</i>MCP 服务</h2>
              <button type="button" className={styles.help} aria-label="MCP 说明" title="MCP 说明" aria-expanded={helpOpen} aria-controls="mcp-manager-help" onClick={() => setHelpOpen((value) => !value)}>?</button>
            </div>
            {helpOpen && <div id="mcp-manager-help" className={styles.helpPanel} role="region" aria-label="MCP 说明">
              <div className={styles.helpPanelHead}>
                <strong>MCP 是什么</strong>
                <button type="button" className={styles.helpClose} aria-label="收起 MCP 说明" title="收起" onClick={() => setHelpOpen(false)}>✕</button>
              </div>
              <p className={styles.hint}>MCP（Model Context Protocol）让你把外部服务接进助手：连接后，助手会看到该服务公布的远程工具并在需要时调用，就像内置的联网或出图能力一样。</p>
              <p className={styles.hint}><strong>让助手自己接：</strong>直接在对话里说「帮我接入 xxx，地址是 https://…」，助手会调用管理工具完成添加、自检和开关；删除服务和打开写入权限需要你明确同意。</p>
              <p className={styles.hint}><strong>只支持远程服务：</strong>这里填 <code>https://…</code> 的 Streamable HTTP 地址（常见形如 <code>https://host/mcp</code>），不会在本机拉起任何进程；<code>npx</code> / <code>uvx</code> 这类本地命令型服务暂时接不了。</p>
              <p className={styles.hint}><strong>凭据：</strong>服务要 token 时按「名称: 值」逐行填请求头（例如 <code>Authorization: Bearer …</code>）；值只存在本机服务端，页面上只显示名称。</p>
              <p className={styles.hint}><strong>只读与写入：</strong>默认只放行只读工具，有副作用的工具必须为单个服务打开「允许写入」。外部服务返回的内容一律按不可信数据处理，助手不会执行其中的指令。</p>
              <p className={styles.hint}><strong>上限：</strong>最多 {limit || 20} 个服务，每个最多 60 个工具，参数结构超过 12KB 的工具不下发给助手。</p>
            </div>}
            <p className={styles.hint}>新增或改动的服务在下一轮对话生效；连不上只会跳过这个服务，不影响其他对话。</p>
          </div>
          <div className={styles.headerAside}>
            <button type="button" className={styles.close} aria-label="关闭 MCP 面板" title="关闭" disabled={busy} onClick={() => setOpen(false)}>✕</button>
          </div>
        </header>

        {error && <p className={styles.error} role="alert">{error}</p>}
        {notice && <p className={styles.notice} role="status">{notice}</p>}

        <div className={styles.panel}>
          {!servers.length && <p className={styles.empty}>还没有连接任何 MCP 服务。可以在下面粘贴一份配置或直接填地址；也可以直接在对话里说「帮我接入 xxx，地址是 https://…」。添加后会自动做一次连接自检。</p>}
          {servers.map((server) => {
            const probe = probes[server.id];
            return <article key={server.id} className={styles.row}>
              <div className={styles.rowMain}>
                <div className={styles.rowTitle}>
                  <strong>{server.name}</strong>
                  {server.enabled ? <span className={styles.badgeOn}>已启用</span> : <span className={styles.badgeMuted}>已停用</span>}
                  {server.allowWrite ? <span className={styles.warnBadge}>允许写入</span> : <span className={styles.badge}>只读</span>}
                  {server.hasHeaders && <span className={styles.badge}>请求头 {server.headerNames.length} 个</span>}
                  {server.enabledTools.length > 0 && <span className={styles.badge}>已选 {server.enabledTools.length} 个工具</span>}
                </div>
                <p className={styles.meta}>{hostOf(server.url)} · {server.url}</p>
                {probe && <div className={styles.probe}>
                  <div className={styles.probeHead}>
                    <p className={probe.status === 'error' ? styles.meta : styles.description} role="status">{probe.status === 'busy' ? '正在连接…' : probe.message}</p>
                    {probe.status === 'done' && probe.tools.length > 0 && <span className={styles.badgeMuted}>勾选要放行的工具，未勾选的不下发给助手</span>}
                  </div>
                  {probe.tools.length > 0 && <div className={styles.toolList}>
                    {probe.tools.map((tool) => <label key={tool.name} className={styles.toolRow} title={tool.description || tool.title || tool.name}>
                      <input type="checkbox" checked={tool.enabled} disabled={busy || Boolean(tool.oversized)} onChange={() => void toggleTool(server, tool.name)} />
                      <code>{tool.name}</code>
                      {tool.oversized ? <span>参数结构过大，不会下发给助手</span> : tool.readOnly ? <span>只读</span> : <span>可能写入</span>}
                    </label>)}
                  </div>}
                </div>}
              </div>
              <div className={styles.rowActions}>
                <button type="button" disabled={busy} onClick={() => void probeServer(server)}>{probe?.status === 'busy' ? '连接中…' : '连接自检'}</button>
                <label className={styles.check}><input type="checkbox" checked={server.enabled} disabled={busy} onChange={() => void updateServer(server, { enabled: !server.enabled })} />启用</label>
                <label className={styles.check}><input type="checkbox" checked={server.allowWrite} disabled={busy} onChange={() => void updateServer(server, { allowWrite: !server.allowWrite })} />允许写入</label>
                <button type="button" disabled={busy} onClick={() => void removeServer(server)}>{confirming === server.id ? '再点一次删除' : '删除'}</button>
              </div>
            </article>;
          })}
        </div>

        <section className={styles.form}>
          <h3>添加 MCP 服务</h3>
          <label htmlFor="mcp-paste">快速接入：粘贴配置或地址（可选）</label>
          <textarea id="mcp-paste" value={draft.paste} disabled={busy} spellCheck={false} placeholder={'{"mcpServers":{"notion":{"url":"https://mcp.notion.com/mcp","headers":{"Authorization":"Bearer …"}}}}\n或直接粘贴 https://example.com/mcp'} onChange={(event) => setDraft((current) => ({ ...current, paste: event.target.value }))} />
          <div className={styles.inline}>
            <button type="button" disabled={busy || !draft.paste.trim()} onClick={importConfig}>识别并填入</button>
            <span className={styles.hint}>支持 mcpServers 配置、单个服务对象或纯地址，会填好名称、地址和请求头。</span>
          </div>
          <label htmlFor="mcp-name">名称</label>
          <input id="mcp-name" type="text" value={draft.name} disabled={busy} placeholder="留空则按地址推断，例如 GitHub" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
          <label htmlFor="mcp-url">服务地址</label>
          <input id="mcp-url" type="url" value={draft.url} disabled={busy} placeholder="https://example.com/mcp" onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value, name: current.name.trim() ? current.name : deriveMcpServerName(event.target.value) }))} />
          <label htmlFor="mcp-headers">请求头（可选，每行一条 <code>名称: 值</code>，例如 <code>Authorization: Bearer …</code>）</label>
          <textarea id="mcp-headers" value={draft.headers} disabled={busy} spellCheck={false} onChange={(event) => setDraft((current) => ({ ...current, headers: event.target.value }))} />
          <div className={styles.formFooter}>
            <label className={styles.check}><input type="checkbox" checked={draft.allowWrite} disabled={busy} onChange={() => setDraft((current) => ({ ...current, allowWrite: !current.allowWrite }))} />添加后立即允许写入（有副作用的工具会被放行）</label>
            <button type="button" className={styles.primary} disabled={busy || !draft.url.trim()} onClick={() => void addServer()}>{busy ? '处理中…' : '添加并自检'}</button>
          </div>
        </section>

        <footer className={styles.footer}>
          <span className={styles.count}>已连接 {servers.length} / {limit || '—'} 个服务，其中 {enabledCount} 个已启用</span>
        </footer>
      </dialog>}
    </>
  );
}
