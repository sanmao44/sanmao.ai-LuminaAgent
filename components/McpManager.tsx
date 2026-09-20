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
  lazy: boolean;
  /** 谈成的协议版本；没握过手就是 null。 */
  protocol?: ProtocolView | null;
};

/**
 * 协议版本协商的结果。两边对不上不是错误：规范里由服务端决定后续用什么版本，
 * 我们照它说的用，只在面板上说明白「现在按哪个版本在跑」。
 */
type ProtocolView = { requested: string; negotiated: string; matched: boolean; newerServerVersion: boolean };

/** 版本不一致时给用户看的一句话；一致或还没握手就什么都不说。 */
function protocolNote(protocol: ProtocolView | null | undefined) {
  if (!protocol || protocol.matched) return '';
  return `协议版本不一致：服务端报 ${protocol.negotiated}，本机请求 ${protocol.requested}；已按服务端的版本继续，不影响使用。`;
}

type ProbeTool = { name: string; title: string; description: string; readOnly: boolean; enabled: boolean; oversized?: boolean; unbypassableReason?: string | null };
type ProbeState = { status: 'busy' | 'done' | 'error'; message: string; tools: ProbeTool[]; toolCount: number; readOnly: number };
type Draft = { paste: string; name: string; url: string; headers: string; allowWrite: boolean };

type RuntimeView = {
  id: string;
  name: string;
  summary: string;
  version: string;
  installNote: string;
  state: 'not_installed' | 'installing' | 'installed' | 'running' | 'error';
  installed: boolean;
  installing: boolean;
  running: boolean;
  pid: number | null;
  enabled: boolean;
  needsBrowser: boolean;
  browser: { channel: string | null; path: string | null };
  browserMode?: 'managed' | 'extension';
  installRoot: string;
  logTail: string;
  error: string | null;
  idleTimeoutMs: number;
  /** 跑着的进程是不是拿旧参数起来的：面板据此提示「重启运行时」。 */
  argsStale?: boolean;
  /** 进程启动时接的浏览器；不是扩展模式或没在跑就是 null。 */
  startedBrowserPath?: string | null;
};

/** 官方连接器在面板上的状态（任务书 §4 的九态，中文说法按用户视角写）。 */
type CatalogState = 'unavailable' | 'not_installed' | 'installing' | 'installed' | 'connecting' | 'connected' | 'auth_required' | 'error' | 'disabled';

type CatalogWriteGateView = { id: string; label: string };
type CatalogToolsetView = { id: string; label: string; summary: string; writes: CatalogWriteGateView[] };
type BrowserExtensionView = { storeName: string; storeUrl: string; storeId: string; note: string };

/**
 * 「接日常浏览器」那一侧的真实状态：接的是哪个浏览器、扩展装没装、连接码配没配。
 * extensionInstalled 为 null 是「无法确认」，不是「没装」——两种要在文案上分开。
 */
type BrowserBridgeView = {
  browserName: string;
  executablePath: string | null;
  source: 'override' | 'default' | 'candidate' | 'none';
  userDataDir: string | null;
  extensionInstalled: boolean | null;
  tokenConfigured: boolean;
};

/** 站点名单：填了才传给浏览器服务，空数组等于不限制。 */
type CatalogOriginsView = { allowed: string[]; blocked: string[] };

/** 审计日志读出来的一条：面板只显示「谁想调什么、哪一道放行或拦下」。 */
type RecentCallView = {
  at: number;
  serverName: string;
  tool: string;
  risk: string;
  allowed: boolean;
  decision: string;
  ok: boolean;
  durationMs: number;
  summary: string;
};

type CatalogEntryView = {
  id: string;
  name: string;
  summary: string;
  examples: string[];
  publisher: string;
  homepage: string;
  transport: 'stdio' | 'http';
  installMode: string;
  trust: string;
  capabilities: string[];
  permissions: string[];
  defaultReadOnly: boolean;
  setup: { requiresAuth: boolean; requiresLocalRuntime: boolean };
  version: string;
  installNote: string;
  needsBrowser: boolean;
  /** 浏览器接入方式：内置独立浏览器（managed）或接日常浏览器（extension）；非浏览器条目为 null。 */
  browserMode: 'managed' | 'extension' | null;
  /** 需要装扩展的条目：商店地址与权限说明，面板照着渲染引导。 */
  browserExtension: BrowserExtensionView | null;
  /** 接日常浏览器时的浏览器/扩展状态；非浏览器条目为 null。 */
  browserBridge: BrowserBridgeView | null;
  /** 浏览器条目的站点名单；非浏览器条目为 null。 */
  origins: CatalogOriginsView | null;
  allowedTools: number;
  needsRoots: boolean;
  allowWrite: boolean;
  enabled: boolean;
  state: CatalogState;
  blockedReason: string;
  connecting: boolean;
  error: string | null;
  /** 远端连接器连上之后问到的账号名（例如 GitHub 的登录名）。 */
  account: string;
  /** 谈成的协议版本；服务端没报版本就是 null。 */
  protocol?: ProtocolView | null;
  auth: { required: boolean; optional: boolean; label: string; helpUrl: string; note: string; configured: boolean };
  /** 远端条目才有：能力组（GitHub toolsets）与写权限分项。 */
  toolsets: CatalogToolsetView[];
  enabledToolsets: string[];
  writeGates: CatalogWriteGateView[];
  enabledWriteGates: string[];
};

/** 工具授权记忆在面板上的说法：没记住就是「每次都要问」。 */
const TOOL_MEMORY_LABELS: Record<string, string> = {
  always_allow: '不再问：直接允许',
  block: '不再问：直接拒绝',
};

/** 审计里的判定来源：面板上要能一眼看出「是谁放行的、又是谁拦下的」。 */
const DECISION_LABELS: Record<string, string> = {
  policy: '权限拦下',
  block: '你设的直接拒绝',
  guard: '路径拦下',
  approval: '你确认过',
  rejected: '你拒绝了',
  call: '直接执行',
};

const CATALOG_STATE_LABELS: Record<string, string> = {
  unavailable: '还差一步',
  not_installed: '未安装',
  installing: '安装中',
  installed: '已安装',
  connecting: '连接中',
  connected: '已连接',
  auth_required: '需要重新连接',
  error: '出错',
  disabled: '已停用',
};

/** 状态颜色：能用的用强调色，出错的用警告色，其余是中性徽标。 */
const CATALOG_STATE_TONE: Record<string, 'on' | 'warn' | 'muted'> = {
  connected: 'on',
  installed: 'on',
  running: 'on',
  installing: 'muted',
  connecting: 'muted',
  disabled: 'muted',
  not_installed: 'muted',
  unavailable: 'warn',
  auth_required: 'warn',
  error: 'warn',
};

const PERMISSION_LABELS: Record<string, string> = {
  network: '联网',
  'fs:read': '读本机文件',
  'fs:write': '写本机文件',
  'artifact:read': '读生成的文件',
  'artifact:write': '生成文件',
  'external:write': '改动外部数据',
};

const RUNTIME_STATE_LABELS: Record<string, string> = {
  not_installed: '未安装',
  installing: '安装中',
  installed: '已安装',
  running: '运行中',
  error: '出错',
};

const BROWSER_LABELS: Record<string, string> = { chrome: 'Chrome', msedge: 'Edge' };

const BROWSER_MODE_LABELS: Record<'managed' | 'extension', string> = {
  managed: '内置独立浏览器',
  extension: '接我日常的浏览器',
};

/**
 * 接日常浏览器时先回答「接的是哪个浏览器、扩展装没装」：这两件事决定了用户下一步该干什么。
 * 「自动确认不了」要和「确认没装」分开说，否则又是一次「我明明装了」。
 */
function browserBridgeNote(bridge: BrowserBridgeView | null | undefined) {
  if (!bridge) return '';
  if (!bridge.executablePath) return '还没找到能接的浏览器：装一个 Chromium 系浏览器，或在下面手填它的可执行文件路径。';
  const source = bridge.source === 'override'
    ? '（你指定的路径）'
    : bridge.source === 'default'
      ? '（系统默认浏览器）'
      : '（本机装的 Chrome/Edge）';
  const installed = bridge.extensionInstalled === true
    ? '已找到'
    : bridge.extensionInstalled === false
      ? `没找到（查的是 ${bridge.userDataDir || bridge.browserName}）`
      : '没法自动确认（这个浏览器的 profile 目录推不出来），请到它的扩展页看一眼';
  return `接的是：${bridge.browserName}${source} · ${bridge.executablePath} · 扩展：${installed}`;
}

/** 顶部状态必须显示实际会被连接器使用的浏览器，不能只看 managed 模式的 channel。 */
function browserDisplayName(runtime: RuntimeView | null | undefined, bridge?: BrowserBridgeView | null) {
  if (!runtime?.needsBrowser) return '';
  if (runtime.browserMode === 'extension' && bridge?.browserName) {
    return `浏览器：${bridge.browserName}`;
  }
  if (runtime.browser?.channel) {
    return `浏览器：${BROWSER_LABELS[runtime.browser.channel] || runtime.browser.channel}`;
  }
  return '未检测到 Chrome 或 Edge，需要先装一个';
}

/**
 * 审批档位（与 lib/agent/approval.ts 的取值一一对应）。
 * 第一档是 v1 的老行为，第二档是默认值，第三档等价 Codex 的「完全访问」。
 */
const APPROVAL_POLICIES = [
  { id: 'always', label: '每次确认', summary: '非只读的 MCP 调用都要你点一次「允许」。' },
  { id: 'trusted', label: '标准信任', summary: '导航、切标签、截图这类不改动外部数据的动作不问；提交、付款、删除这类不可逆操作仍然会问。' },
  { id: 'full', label: '完全访问', summary: '所有 MCP 调用直接执行，不再询问——包括提交、付款、删除。' },
] as const;

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

/**
 * 面板里的折叠区块：标题行本身就是开关，右侧可以挂常驻动作（刷新状态、展开表单）。
 * 长说明一律放进 body，标题行只留「这是什么 + 现在几项」的摘要，省得用户先读一屏字。
 */
function PanelSection({ id, title, summary, aside, open, onToggle, children }: {
  id: string;
  title: string;
  summary?: ReactNode;
  aside?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return <div className={styles.form}>
    <div className={styles.formHead}>
      <h3 className={styles.sectionTitle}>
        <button type="button" className={styles.sectionToggle} aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle}>
          <span className={styles.sectionIcon} aria-hidden="true" />
          <span>{title}</span>
          {summary ? <span className={styles.sectionSummary}>{summary}</span> : null}
          <span className={styles.sectionChevron} aria-hidden="true">{open ? '−' : '+'}</span>
        </button>
      </h3>
      {aside}
    </div>
    {open && <div id={id} className={styles.sectionBody}>{children}</div>}
  </div>;
}

export default function McpManager({ disabled, icon }: { disabled: boolean; icon: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeView[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntryView[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  /** 每个授权目录带不带写权限：面板上的「✓读取 □写入」照这份渲染。 */
  const [rootEntries, setRootEntries] = useState<{ path: string; write: boolean }[]>([]);
  const [rootSuggestions, setRootSuggestions] = useState<string[]>([]);
  /** 站点名单的编辑态：按条目 id 存草稿，没编辑过的条目用服务端给的值。 */
  const [originDrafts, setOriginDrafts] = useState<Record<string, { allowed: string; blocked: string }>>({});
  /** 最近的 MCP 判定 / 调用（审计日志的读侧）：谁想调什么、哪一道放行或拦下。 */
  const [recentCalls, setRecentCalls] = useState<RecentCallView[]>([]);
  /** 工具授权记忆：always_allow / block；ask 不落盘，也不会出现在这里。 */
  const [toolPolicies, setToolPolicies] = useState<Record<string, string>>({});
  // 凭据只在内存里放一会儿：提交后立刻清掉，绝不回显已保存的值。
  const [tokens, setTokens] = useState<Record<string, string>>({});
  /** 扩展的免点击连接码：和远端凭据一个规矩，提交后立刻清空输入框。 */
  const [extensionTokens, setExtensionTokens] = useState<Record<string, string>>({});
  /** 手填的浏览器路径：一般留空（跟系统默认浏览器走）。 */
  const [browserPaths, setBrowserPaths] = useState<Record<string, string>>({});
  const [rootDraft, setRootDraft] = useState('');
  const [limit, setLimit] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [probes, setProbes] = useState<Record<string, ProbeState>>({});
  const [confirming, setConfirming] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * 正在跑的动作（哪个连接器的哪个动作）。
   * 安装/启动/连接这些动作要拉进程、等自检，几秒到几十秒都有可能；
   * 之前它们和全局 busy 共用一个开关，一个动作没回来整个面板（包括关闭）都点不动，
   * 用户看到的就是「按钮按不了、也收不回」。现在只锁动作所在的那一行。
   */
  const [pending, setPending] = useState<{ id: string; action: string } | null>(null);
  /** 系统选择框已经弹出来了：这期间按钮显示「等待选择…」，也避免连点弹出两个框。 */
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [formOpen, setFormOpen] = useState<boolean | null>(null);
  /** 当前审批档位：存在设置里（/api/settings），面板只负责切换。 */
  const [approvalPolicy, setApprovalPolicy] = useState('trusted');
  /** 「完全访问」要点两次：第一下只是把按钮变成待确认状态。 */
  const [policyArmed, setPolicyArmed] = useState(false);
  /**
   * 折叠区块：值为 true 表示收起。默认收起「运行时详情 / 工具记忆 / 站点名单 / 扩展进阶设置」
   * 这些一年动不了两次的内容，常看的几块保持展开。
   */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ runtime: true, memory: true, browserExt: true, origins: true });
  const toggleSection = useCallback((key: string) => setCollapsed((current) => ({ ...current, [key]: !current[key] })), []);
  /** 列表头的「＋ 添加服务」直接把人送到面板底部的表单，省得自己找。 */
  const addSection = useRef<HTMLElement | null>(null);
  const jumpToAddForm = useCallback(() => {
    setFormOpen(true);
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    addSection.current?.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, []);
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

  /* 「完全访问」的待确认状态同样会自己复位：悬着容易变成下次误点就生效。 */
  useEffect(() => {
    if (!policyArmed) return;
    const timer = setTimeout(() => setPolicyArmed(false), 6000);
    return () => clearTimeout(timer);
  }, [policyArmed]);

  const applyPayload = useCallback((data: Record<string, unknown>) => {
    if (Array.isArray(data.servers)) setServers(data.servers as McpServerView[]);
    if (Array.isArray(data.runtimes)) setRuntimes(data.runtimes as RuntimeView[]);
    if (Array.isArray(data.catalog)) setCatalog(data.catalog as CatalogEntryView[]);
    if (Array.isArray(data.roots)) setRoots(data.roots as string[]);
    if (Array.isArray(data.rootEntries)) setRootEntries(data.rootEntries as { path: string; write: boolean }[]);
    if (Array.isArray(data.rootSuggestions)) setRootSuggestions(data.rootSuggestions as string[]);
    if (Array.isArray(data.recentCalls)) setRecentCalls(data.recentCalls as RecentCallView[]);
    if (data.toolPolicies && typeof data.toolPolicies === 'object') setToolPolicies(data.toolPolicies as Record<string, string>);
    if (typeof data.limit === 'number' && data.limit > 0) setLimit(data.limit);
    // 审批档位来自设置：/api/state 直接给 settings，/api/settings 把新的 state 包在 state 里。
    const settings = ((data.state && typeof data.state === 'object' ? (data.state as Record<string, unknown>) : data).settings || {}) as { mcpApprovalPolicy?: unknown };
    if (typeof settings.mcpApprovalPolicy === 'string' && settings.mcpApprovalPolicy) setApprovalPolicy(settings.mcpApprovalPolicy);
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

  /** 只锁一行的那种 run：慢动作不再把整个面板冻住，其余按钮照常可用。 */
  const runItem = useCallback(async (id: string, action: string, task: () => Promise<void>) => {
    setPending({ id, action });
    setError('');
    try {
      await task();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作失败');
    } finally {
      setPending(null);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void run(async () => {
      applyPayload(await requestJson('/api/mcp'));
      // 本地运行时的安装/运行状态单独取：远程地址和本机进程是两件事。
      applyPayload(await requestJson('/api/tools'));
      // 审批档位是全局设置，跟 MCP 面板共用一个开关。
      applyPayload(await requestJson('/api/state'));
    });
  }, [open, run, applyPayload]);

  /* 安装依赖是分钟级的动作：装的过程中每两秒取一次状态和日志，装完自动停。
     远端条目的「连接」也要轮询：探测要几百毫秒到几秒，面板得能显示「连接中」。 */
  const installingRuntime = runtimes.some((runtime) => runtime.installing);
  const connectingEntry = catalog.some((item) => item.connecting);
  useEffect(() => {
    if (!open || (!installingRuntime && !connectingEntry)) return;
    const timer = setInterval(() => {
      void requestJson('/api/tools').then(applyPayload).catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [open, installingRuntime, connectingEntry, applyPayload]);

  const enabledCount = servers.filter((server) => server.enabled).length;
  /* 已经有服务时，"添加服务"表单默认收起：那个表单要占掉四百多像素，展开着会把工具清单挤到只剩一两行。 */
  const showForm = formOpen ?? servers.length === 0;

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
      setFormOpen(false);
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
      const data = await requestJson(`/api/mcp/${encodeURIComponent(server.id)}`, { method: 'DELETE' });
      applyPayload(data);
      // 删光了就把表单放出来，否则空列表会提示"可以在下面粘贴配置"而下面什么都没有。
      if (!(data.servers as unknown[] | undefined)?.length) setFormOpen(null);
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

  /** 批量放行：工具多的服务挨个点太费劲，一次把范围设好。 */
  async function selectTools(server: McpServerView, names: string[], emptyMessage: string) {
    if (!names.length) { setNotice(emptyMessage); return; }
    await run(async () => {
      applyPayload(await requestJson(`/api/mcp/${encodeURIComponent(server.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabledTools: names }),
      }));
      setProbes((current) => {
        const probe = current[server.id];
        if (!probe) return current;
        return { ...current, [server.id]: { ...probe, tools: probe.tools.map((tool) => ({ ...tool, enabled: names.includes(tool.name) })) } };
      });
      setNotice(`已把「${server.name}」的放行范围改成 ${names.length} 个工具。`);
    });
  }

  async function refreshRuntimes() {
    await run(async () => {
      applyPayload(await requestJson('/api/tools'));
    });
  }

  /** 官方连接器的动作：本机条目走安装/启动/停止，远端条目走连接/断开/配置。 */
  async function runCatalog(action: 'install' | 'start' | 'stop' | 'cancel' | 'connect' | 'disconnect', item: CatalogEntryView, runtime?: RuntimeView) {
    // 安装、启动、连接都要拉进程再等自检，几十秒都有可能：只锁这一行，别把整个面板锁住。
    await runItem(item.id, action, async () => {
      const data = await requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, id: item.id, ...(action === 'connect' ? { token: (tokens[item.id] || '').trim() } : {}) }),
      });
      applyPayload(data);
      if (action === 'connect') setTokens((current) => ({ ...current, [item.id]: '' }));
      if (action === 'connect') {
        // 探测结果由服务端给：连上、401、超时都要说清，不能只说「失败了」。
        const connection = data.connection as { state?: string; error?: string | null } | undefined;
        setNotice(connection?.state === 'connected'
          ? `${item.name} 已连接，工具在下一轮对话生效。`
          : `${item.name} 连接失败：${connection?.error || '原因未知'}。配置已经留着，改好再点一次「连接」。`);
        return;
      }
      setNotice(action === 'disconnect'
        ? `已断开 ${item.name}，本机保存的那份凭据也一起删掉了。`
        : action === 'install'
          ? `开始安装 ${item.name}；装完后点「启动」。`
          : action === 'start'
            ? `${item.name} 已启动，工具在下一轮对话生效。`
            : action === 'stop'
              ? `${item.name} 已停止，工具已从下一轮对话里移除。`
              : '已取消安装。');
    });
  }

  /**
   * 重启运行时：先停再起。
   * 启动参数（接哪个浏览器、站点名单…）只在拉起进程那一刻算一次，改完设置不重启就还是旧的——
   * 「扩展明明装着，助手却说没装」最常见的原因就是这个，用户不该自己去猜「停一下再启动」。
   */
  async function restartRuntime(item: CatalogEntryView) {
    await runItem(item.id, 'restart', async () => {
      const post = (body: Record<string, unknown>) => requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      applyPayload(await post({ action: 'stop', id: item.id }));
      applyPayload(await post({ action: 'start', id: item.id }));
      setNotice(`${item.name} 已按当前设置重新启动：下一轮对话起用新参数。`);
    });
  }

  /** 写入权限：本机条目写条目状态，远端条目还要顺手改服务端请求头里的只读开关（服务端一起改才算数）。 */
  async function toggleCatalogWrite(item: CatalogEntryView) {
    await runItem(item.id, 'write', async () => {
      const allowWrite = !item.allowWrite;
      const data = await requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'allow-write', id: item.id, allowWrite }),
      });
      applyPayload(data);
      // 远端连接器的写入权限写在请求头上：这一步会顺带重连，重连失败要说清楚，不能只报「已改好」。
      const connection = data.connection as { state?: string; error?: string | null } | undefined;
      if (connection && connection.state !== 'connected') {
        setNotice(`已改「${item.name}」的写入权限，但重新连接没成功：${connection.error || '原因未知'}。改好凭据后点一次「重新连接」。`);
        return;
      }
      setNotice(allowWrite
        ? `已允许「${item.name}」执行有副作用的操作${item.writeGates.length ? '；还要在写权限里逐项打开具体操作' : ''}；是否逐次确认取决于上面的审批档位。`
        : `已把「${item.name}」改回只读，写工具不会下发给助手。`);
    });
  }

  /** 能力组（GitHub 的 toolsets）：关掉的组服务端就不再公布，所以要重连一次才算数。 */
  async function toggleCatalogToolset(item: CatalogEntryView, toolset: CatalogToolsetView) {
    await runItem(item.id, 'toolset', async () => {
      const enabled = !item.enabledToolsets.includes(toolset.id);
      const data = await requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'toolset', id: item.id, toolset: toolset.id, enabled }),
      });
      applyPayload(data);
      const connection = data.connection as { state?: string; error?: string | null } | undefined;
      if (item.state === 'connected' && connection && connection.state !== 'connected') {
        setNotice(`已${enabled ? '打开' : '关掉'}「${toolset.label}」，但重新连接没成功：${connection.error || '原因未知'}。改好后再点一次「重新连接」。`);
        return;
      }
      setNotice(enabled
        ? `已打开「${toolset.label}」：助手在下一轮对话里能看到这组工具。`
        : `已关掉「${toolset.label}」：这组工具不会交给助手。`);
    });
  }

  /** 写权限分项：只决定本机下发哪些写工具，每一项调用仍然要单独确认。 */
  async function toggleCatalogWriteGate(item: CatalogEntryView, gate: CatalogWriteGateView) {
    await runItem(item.id, 'gate', async () => {
      const enabled = !item.enabledWriteGates.includes(gate.id);
      applyPayload(await requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'write-gate', id: item.id, gate: gate.id, enabled }),
      }));
      setNotice(enabled
        ? `已放开「${gate.label}」：助手可以做这件事，但每一次仍然要你确认。`
        : `已收回「${gate.label}」：助手不会执行这类操作。`);
    });
  }

  /** 授权文件夹：只能由用户在这里加，助手侧的 MCP 管理工具不碰这份清单。 */
  async function addRootPath(value: string) {
    const path = value.trim();
    if (!path) return;
    await run(async () => {
      applyPayload(await requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'roots-add', path }),
      }));
      setRootDraft('');
      setNotice(`已授权 ${path}：本地文件服务重启后能在里面读写。`);
    });
  }

  async function addRoot() {
    await addRootPath(rootDraft);
  }

  /**
   * 「选择文件夹…」：浏览器拿不到本机绝对路径，所以由本机服务端弹出系统选择框，选完直接进授权清单。
   * 取消不报错；远端访问会被服务端拒掉，错误信息负责把人引回手填路径。
   */
  async function pickRootFolder() {
    if (picking) return;
    setError('');
    setNotice('');
    setPicking(true);
    try {
      const data = await requestJson('/api/mcp/pick-folder', { method: 'POST' });
      const picked = String(data.path || '').trim();
      if (!picked) {
        setNotice('没有选择文件夹，授权清单没有变化。');
        return;
      }
      await addRootPath(picked);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '打不开系统选择框');
    } finally {
      setPicking(false);
    }
  }

  async function removeRoot(path: string) {
    await run(async () => {
      applyPayload(await requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'roots-remove', path }),
      }));
      setNotice(`已取消授权 ${path}：它的文件不会再交给助手。`);
    });
  }

  /** 写权限单独勾：只读授权和「可以写入」是两件事，取消勾走同一个动作。 */
  async function toggleRootWrite(path: string, write: boolean) {
    await run(async () => {
      applyPayload(await requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'roots-write', path, write }),
      }));
      setNotice(write ? `已允许助手写入 ${path}。` : `已收回 ${path} 的写入权限，现在只读。`);
    });
  }

  /** 站点名单：留空等于不限制；填了之后浏览器只在这些站点里活动（改完要重启运行时才生效）。 */
  async function saveOrigins(item: CatalogEntryView) {
    const draft = originDrafts[item.id] || {
      allowed: (item.origins?.allowed || []).join('\n'),
      blocked: (item.origins?.blocked || []).join('\n'),
    };
    await run(async () => {
      applyPayload(await requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'origins', id: item.id, allowedOrigins: draft.allowed, blockedOrigins: draft.blocked }),
      }));
      setNotice('已保存站点名单：浏览器下次启动时按新名单走。');
    });
  }

  /** 清掉一条工具授权记忆：清掉之后就回到「每次都问」。 */
  async function forgetToolPolicy(toolId: string) {
    await run(async () => {
      applyPayload(await requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'tool-policy', toolId, policy: 'ask' }),
      }));
      setNotice('已清掉这条记忆：这个工具下次还会先问你。');
    });
  }

  /**
   * 工具授权记忆：点一下走一格（每次问 → 以后直接允许 → 以后直接拒绝 → 每次问）。
   * 记的是「这个工具」，不是「这一次参数」——所以按钮上的字要说清记的是什么。
   */
  async function cycleToolMemory(server: McpServerView, toolName: string) {
    const toolId = `mcp:${server.id}:${toolName}`;
    const current = toolPolicies[toolId];
    const next = current === 'always_allow' ? 'block' : current === 'block' ? 'ask' : 'always_allow';
    await run(async () => {
      applyPayload(await requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'tool-policy', toolId, policy: next }),
      }));
      setNotice(next === 'always_allow'
        ? `已记住：${toolName} 以后直接允许，不再问你。`
        : next === 'block'
          ? `已记住：${toolName} 以后直接拒绝，助手也不会再问。`
          : `${toolName} 改回每次都要问。`);
    });
  }

  /** 打开文件夹：浏览器拿不到本机目录，交给服务端用系统文件管理器打开；服务端只认授权清单里的路径。 */
  async function openRoot(path: string) {
    await run(async () => {
      await requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'roots-open', path }),
      });
      setNotice(`已让系统文件管理器打开 ${path}。`);
    });
  }

  /** 运行时安装目录同理：目录由服务端按条目 id 算出，面板只能传 id。 */
  async function openRuntimeFolder(runtime: RuntimeView) {
    await run(async () => {
      await requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'runtime-open', id: runtime.id }),
      });
      setNotice(`已让系统文件管理器打开 ${runtime.name} 的安装目录。`);
    });
  }

  /**
   * 审批档位：全局设置，写在设置里，本机所有 MCP 服务共用。
   * 「完全访问」要点两次：它会连提交、付款、删除一起放行，不能一下点中就生效。
   */
  async function changeApprovalPolicy(next: string) {
    const known = APPROVAL_POLICIES.find((item) => item.id === next);
    if (!known) return;
    if (next === 'full' && !policyArmed) {
      setPolicyArmed(true);
      setNotice('再点一次「完全访问」就会生效：之后所有 MCP 调用都直接执行，包括提交、付款、删除，不会再问你。');
      return;
    }
    setPolicyArmed(false);
    await run(async () => {
      const data = await requestJson('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mcpApprovalPolicy: next }),
      });
      applyPayload(data);
      setApprovalPolicy(next);
      setNotice(next === 'full'
        ? '已切到「完全访问」：MCP 调用不再询问，风险由你承担。想收回随时切回上面两档。'
        : next === 'always'
          ? '已切到「每次确认」：非只读的 MCP 调用都会先问你一次。'
          : '已切到「标准信任」：不改动外部数据的浏览器动作不再打扰你，不可逆操作仍然会问。');
    });
  }

  /** 浏览器接入方式：本机条目的启动参数跟着变，服务端会重启进程并顺手自检一次。 */
  async function switchBrowserMode(item: CatalogEntryView, mode: 'managed' | 'extension') {
    // 换接入方式要收掉旧进程再自检一次：这块面板不该跟着一起冻住。
    await runItem(item.id, 'mode', async () => {
      const data = await requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'browser-mode', id: item.id, mode }),
      });
      applyPayload(data);
      const failure = String(data.runtimeError || '').trim();
      if (failure) {
        setNotice(`已切到「${BROWSER_MODE_LABELS[mode]}」，但自检没通过：${failure}`);
        return;
      }
      setNotice(mode === 'extension'
        ? '已切到「接我日常的浏览器」：保持那个浏览器开着，第一次操作会在它里面弹一个连接页，选一个标签页点「Connect」（想免点击就填下面的扩展连接码）。'
        : '已切回「内置独立浏览器」：助手用它自己的窗口和登录状态，不碰你日常浏览器。');
    });
  }

  /** 免点击连接码：填了之后连接页自动确认；clear 为真表示清除（回到每次点一次）。 */
  async function saveExtensionToken(item: CatalogEntryView, clear = false) {
    const value = clear ? '' : (extensionTokens[item.id] || '').trim();
    if (!clear && !value) {
      setNotice('先把扩展页上的 PLAYWRIGHT_MCP_EXTENSION_TOKEN=… 整行复制到输入框里，再点保存。');
      return;
    }
    await runItem(item.id, 'token', async () => {
      const data = await requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'extension-token', id: item.id, token: value }),
      });
      applyPayload(data);
      setExtensionTokens((current) => ({ ...current, [item.id]: '' }));
      setNotice(clear
        ? '已清除扩展连接码：下次连接要在弹出的连接页点一次「Connect」。'
        : '已保存扩展连接码：下次启动后连接页会自动确认，不再需要点。');
    });
  }

  /** 浏览器路径：手填就用它（会自动识别系统默认浏览器）；留空表示回到自动识别。 */
  async function saveBrowserExecutable(item: CatalogEntryView) {
    const value = (browserPaths[item.id] || '').trim();
    await runItem(item.id, 'exe', async () => {
      const data = await requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'browser-exe', id: item.id, path: value }),
      });
      applyPayload(data);
      setBrowserPaths((current) => ({ ...current, [item.id]: '' }));
      setNotice(value ? '已记住你指定的浏览器路径：下次启动用它。' : '已回到自动识别：按系统默认浏览器来接。');
    });
  }

  /** 自建扩展目录：从 microsoft/playwright 源码构建的那份，走「加载已解压的扩展程序」。 */
  async function openExtensionFolder() {
    await run(async () => {
      await requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'extension-open' }),
      });
      setNotice('已让系统文件管理器打开自建扩展目录：在浏览器的扩展页用「加载已解压的扩展程序」选中它即可。');
    });
  }

  /** 安装 / 启动 / 停止 / 取消：请求体只有白名单里的动作名 + 条目 id。 */
  async function runRuntime(action: 'install' | 'start' | 'stop' | 'cancel', runtime: RuntimeView) {
    await run(async () => {
      const data = await requestJson('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, id: runtime.id }),
      });
      applyPayload(data);
      setNotice(action === 'install'
        ? `开始安装 ${runtime.name}；装完后点「启动」。`
        : action === 'start'
          ? `${runtime.name} 已启动，工具在下一轮对话生效。`
          : action === 'stop'
            ? `${runtime.name} 已停止，工具已从下一轮对话里移除。`
            : '已取消安装。');
    });
  }  return (
    <>
      <button type="button" className={styles.trigger} data-tooltip={enabledCount ? `MCP · ${enabledCount} 个服务已启用` : 'MCP 服务'} aria-label={enabledCount ? `MCP 服务（${enabledCount} 个已启用）` : 'MCP 服务'} aria-haspopup="dialog" disabled={disabled} onClick={() => { setError(''); setNotice(''); setConfirming(''); setHelpOpen(false); setOpen(true); }}>{icon}{enabledCount > 0 && <span className={styles.activeBadge} aria-hidden="true">{enabledCount > 9 ? '9+' : enabledCount}</span>}</button>
      {open && <dialog ref={dialog} className={styles.dialog} aria-labelledby="mcp-manager-title" onClose={() => setOpen(false)} onCancel={(event) => { if (helpOpen) { event.preventDefault(); setHelpOpen(false); } }}>
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
              <div className={styles.helpGrid}>
              <p className={styles.hint}>MCP（Model Context Protocol）让你把外部服务接进助手：连接后，助手会看到该服务公布的远程工具并在需要时调用，就像内置的联网或出图能力一样。</p>
              <p className={styles.hint}><strong>让助手自己接：</strong>直接在对话里说「帮我接入 xxx，地址是 https://…」，助手会调用管理工具完成添加、自检和开关；删除服务和打开写入权限需要你明确同意。内置连接器只能由你在面板里操作：助手改不了它们的地址和权限，也断不开。</p>
              <p className={styles.hint}><strong>官方连接器：</strong>浏览器控制、本地文件、GitHub、开发文档这四条写在代码里，命令、版本、地址和安装位置都改不了。远端连接器（GitHub、开发文档）不下载任何东西，「连接」只是把一份带凭据的配置交给助手用；点「断开」会把本机保存的那份凭据一起删掉。</p>
              <p className={styles.hint}><strong>本机运行时：</strong>浏览器控制与本地文件由代码内置（命令、参数和工作目录都写死在代码里，面板和对话都改不了），要先「安装」——装在项目数据目录里，不动系统环境；本地文件还要先授权文件夹，助手只能在这个范围里读写。不想用了随时可以停掉。</p>
              <p className={styles.hint}><strong>凭据：</strong>服务要 token 时按「名称: 值」逐行填请求头（例如 <code>Authorization: Bearer …</code>）；值只存在本机服务端，页面上只显示名称。GitHub 建议用 fine-grained token：仓库只选要用的、权限只给读；连上后这里会显示当前账号，方便确认没连错。</p>
              <p className={styles.hint}><strong>只读与写入：</strong>默认只放行只读工具；有副作用的工具要先给这个服务打开「允许写入」，GitHub 还要逐项打开（创建 Issue、评论、创建 PR、改文件、Merge 等），每一次写调用都会单独要你确认。删除仓库、改密钥、force push、分支保护没有开关。外部服务返回的内容一律按不可信数据处理，助手不会执行其中的指令。</p>
              <p className={styles.hint}><strong>按需下发：</strong>服务工具很多时给它打开「按需下发」：只有这一轮提到这个服务（服务名或工具名）才会把它的工具交给助手，省 token 也更少误点；默认关闭，关闭时每轮都下发。</p>
              <p className={styles.hint}><strong>上限：</strong>最多 {limit || 20} 个服务，每个最多 60 个工具，参数结构超过 12KB 的工具不下发给助手。</p>
              </div>
            </div>}
            <div className={styles.statusBar}>
              <span className={enabledCount > 0 ? styles.statusPillOn : styles.statusPill}><b>{enabledCount}</b> 个服务已启用</span>
              <span className={styles.statusPill}>已连接 {servers.length} / {limit || '—'}</span>
              {approvalPolicy === 'full' && <span className={styles.warnBadge}>审批：完全访问</span>}
            </div>
          </div>
          <div className={styles.headerAside}>
            <button type="button" className={styles.close} aria-label="关闭 MCP 面板" title="关闭（正在跑的动作会在后台继续）" onClick={() => setOpen(false)}>✕</button>
          </div>
        </header>

        {error && <p className={styles.error} role="alert">{error}</p>}
        {notice && <p className={styles.notice} role="status">{notice}</p>}

        <div className={styles.panel}>
          <PanelSection
            id="mcp-section-approval"
            title="审批档位"
            open={!collapsed.approval}
            onToggle={() => toggleSection('approval')}
            summary={approvalPolicy === 'full'
              ? <span className={styles.warnBadge}>不再询问</span>
              : <span className={styles.badgeMuted}>{APPROVAL_POLICIES.find((item) => item.id === approvalPolicy)?.label || approvalPolicy}</span>}
          >
            <p className={styles.hint}>只影响 MCP 服务的外部调用（浏览器、GitHub、本地文件等）；内置工具（生成文件、技能）另有各自的开关。</p>
            <div className={styles.segments}>
              {APPROVAL_POLICIES.map((item) => <button
                key={item.id}
                type="button"
                className={approvalPolicy === item.id ? styles.segmentOn : styles.segment}
                disabled={busy}
                title={item.summary}
                onClick={() => void changeApprovalPolicy(item.id)}
              >{approvalPolicy === item.id ? `✓ ${item.label}` : item.label}{policyArmed && item.id === 'full' ? '（再点一次确认）' : ''}</button>)}
            </div>
            <p className={styles.meta}>{APPROVAL_POLICIES.find((item) => item.id === approvalPolicy)?.summary || ''}</p>
            {approvalPolicy === 'full' && <p className={styles.hint}>「完全访问」下助手执行提交、付款、删除这类操作也不会再问你，只在你明确信任这些服务时使用。</p>}
          </PanelSection>

          <PanelSection
            id="mcp-section-servers"
            title="已连接的服务"
            open={!collapsed.servers}
            onToggle={() => toggleSection('servers')}
            summary={servers.length ? `${servers.length} 个` : '还没有'}
            aside={<button type="button" className={styles.addService} disabled={busy} onClick={jumpToAddForm}>＋ 添加服务</button>}
          >
          {!servers.length && <p className={styles.empty}>还没有连接任何 MCP 服务。可以在下面粘贴一份配置或直接填地址；也可以直接在对话里说「帮我接入 xxx，地址是 https://…」。添加后会自动做一次连接自检。</p>}
          {servers.map((server) => {
            const probe = probes[server.id];
            // 自检出来的工具列表可能有几十条：摊在面板里能把整页撑满，所以要能收回去。
            const probeKey = `probe:${server.id}`;
            return <article key={server.id} className={styles.row}>
              <div className={styles.rowMain}>
                <div className={styles.rowTitle}>
                  <strong>{server.name}</strong>
                  {server.enabled ? <span className={styles.badgeOn}>已启用</span> : <span className={styles.badgeMuted}>已停用</span>}
                  {server.allowWrite ? <span className={styles.warnBadge}>允许写入</span> : <span className={styles.badge}>只读</span>}
                  {server.lazy && <span className={styles.badgeMuted}>按需下发</span>}
                  {server.hasHeaders && <span className={styles.badge}>请求头 {server.headerNames.length} 个</span>}
                  {server.enabledTools.length > 0 && <span className={styles.badge}>已选 {server.enabledTools.length} 个工具</span>}
                </div>
                <p className={styles.endpoint} title={server.url}><code>{hostOf(server.url)}</code><span className={styles.endpointUrl}>{server.url}</span></p>
                {protocolNote(server.protocol) && <p className={styles.meta}>{protocolNote(server.protocol)}</p>}
                {probe && <div className={styles.probe}>
                  <div className={styles.probeHead}>
                    <p className={probe.status === 'error' ? styles.meta : styles.description} role="status">{probe.status === 'busy' ? '正在连接…' : probe.message}</p>
                    {probe.status === 'done' && probe.tools.length > 0 && <button type="button" className={styles.miniButton} aria-expanded={!collapsed[probeKey]} aria-controls={collapsed[probeKey] ? undefined : `mcp-tools-${server.id}`} onClick={() => toggleSection(probeKey)}>{collapsed[probeKey] ? `展开 ${probe.tools.length} 个工具` : '收起工具列表'}</button>}
                    {probe.status === 'done' && probe.tools.length > 1 && <button type="button" disabled={busy} onClick={() => void selectTools(server, probe.tools.filter((tool) => !tool.oversized).map((tool) => tool.name), '这个服务没有可以放行的工具。')}>全部放行</button>}
                    {probe.status === 'done' && probe.tools.some((tool) => tool.readOnly && !tool.oversized) && <button type="button" disabled={busy} onClick={() => void selectTools(server, probe.tools.filter((tool) => tool.readOnly && !tool.oversized).map((tool) => tool.name), '这个服务没有只读工具，只能逐个勾选。')}>只放行只读</button>}
                  </div>
                  {probe.status === 'done' && probe.tools.length > 0 && !collapsed[probeKey] && <p className={styles.hint}>勾选要放行的工具，未勾选的不下发给助手。</p>}
                  {probe.tools.length > 0 && !collapsed[probeKey] && <div id={`mcp-tools-${server.id}`} className={styles.toolList}>
                    {probe.tools.map((tool) => <div key={tool.name} className={styles.toolRow} title={tool.description || tool.title || tool.name}>
                      <label>
                        <input type="checkbox" checked={tool.enabled} disabled={busy || Boolean(tool.oversized)} onChange={() => void toggleTool(server, tool.name)} />
                        <span className={styles.toolBody}>
                          <span className={styles.toolHead}><code>{tool.name}</code>{tool.oversized ? <span>参数结构过大，不会下发给助手</span> : tool.readOnly ? <span>只读</span> : <span>可能写入</span>}</span>
                          {(tool.description || tool.title) && <span className={styles.toolDescription}>{tool.description || tool.title}</span>}
                        </span>
                      </label>
                      {tool.unbypassableReason
                        // 上传本机文件、在页面里执行代码这两类确认免不掉，记忆只会显示一个不生效的状态。
                        ? <button type="button" className={styles.miniButton} disabled title={`这一步每次都要问：${tool.unbypassableReason}，所以不能记成「以后直接允许」`}>{'每次都问（不可记住）'}</button>
                        : <button type="button" className={styles.miniButton} disabled={busy} title="点一下依次切换：每次都要问 → 以后直接允许 → 以后直接拒绝" onClick={() => void cycleToolMemory(server, tool.name)}>
                          {TOOL_MEMORY_LABELS[toolPolicies[`mcp:${server.id}:${tool.name}`]] || '每次都要问'}
                        </button>}
                    </div>)}
                  </div>}
                </div>}
              </div>
              <div className={styles.rowActions}>
                <button type="button" disabled={busy} onClick={() => void probeServer(server)}>{probe?.status === 'busy' ? '连接中…' : '连接自检'}</button>
                <label className={styles.check}><input type="checkbox" checked={server.enabled} disabled={busy} onChange={() => void updateServer(server, { enabled: !server.enabled })} />启用</label>
                <label className={styles.check}><input type="checkbox" checked={server.allowWrite} disabled={busy} onChange={() => void updateServer(server, { allowWrite: !server.allowWrite })} />允许写入</label>
                <label className={styles.check} title="工具很多的服务建议打开：只有这一轮提到它时才会把它的工具交给助手"><input type="checkbox" checked={server.lazy} disabled={busy} onChange={() => void updateServer(server, { lazy: !server.lazy })} />按需下发</label>
                <button type="button" disabled={busy} onClick={() => void removeServer(server)}>{confirming === server.id ? '再点一次删除' : '删除'}</button>
              </div>
            </article>;
          })}
          </PanelSection>

        <PanelSection
          id="mcp-section-catalog"
          title="官方连接器"
          open={!collapsed.catalog}
          onToggle={() => toggleSection('catalog')}
          summary={`${catalog.filter((item) => CATALOG_STATE_TONE[item.state] === 'on').length} / ${catalog.length} 个已连接`}
          aside={<button type="button" disabled={busy} onClick={() => void refreshRuntimes()}>{busy ? '处理中…' : '刷新状态'}</button>}
        >
          <p className={styles.hint}>这些连接器来自内置清单：命令、参数和安装位置都写在代码里，面板和对话都改不了。远端连接器不下载任何东西，「连接」只是把一份带凭据的配置交给助手用；凭据只存在本机，页面上只看得到名字。</p>
          {!catalog.length && <p className={styles.hint}>正在读取连接器状态…</p>}
          {catalog.map((item) => {
            const runtime = runtimes.find((entry) => entry.id === item.id);
            const remote = item.transport === 'http';
            const token = tokens[item.id] || '';
            const tone = CATALOG_STATE_TONE[item.state] || 'muted';
            // 这一行自己的动作在跑时只锁这一行：全局面板照常可用，关闭按钮永远点得动。
            const rowPending = pending?.id === item.id ? pending.action : '';
            const rowBusy = busy || Boolean(rowPending);
            return <article key={item.id} className={styles.row}>
              <div className={styles.rowMain}>
                <div className={styles.rowTitle}>
                  <strong>{item.name}</strong>
                  <span className={tone === 'on' ? styles.badgeOn : tone === 'warn' ? styles.warnBadge : styles.badgeMuted}>{CATALOG_STATE_LABELS[item.state] || item.state}</span>
                  {item.defaultReadOnly && (item.allowWrite ? <span className={styles.warnBadge}>允许写入</span> : <span className={styles.badge}>只读</span>)}
                  <span className={styles.badgeMuted}>{item.publisher}</span>
                  <span className={styles.badgeMuted}>{remote ? '远端' : '本机'}</span>
                  {item.version && <span className={styles.badgeMuted}>{item.version}</span>}
                </div>
                <p className={styles.description}>{item.summary}</p>
                {item.examples.length > 0 && <p className={styles.hint}>可以直接说：{item.examples.join(' · ')}</p>}
                <div className={styles.facts}>
                  <span className={styles.fact}>权限 <b>{item.permissions.map((permission) => PERMISSION_LABELS[permission] || permission).join('、') || '—'}</b></span>
                  <span className={styles.fact}>能力 <b>{item.capabilities.join('、')}</b></span>
                  {item.allowedTools ? <span className={styles.fact}>放行 <b>{item.allowedTools}</b> 个工具</span> : null}
                </div>
                {remote && item.account && <p className={styles.meta}>账号：@{item.account}（连接时确认过一次，换成别的凭据要重新连接）</p>}
                {protocolNote(item.protocol) && <p className={styles.meta}>{protocolNote(item.protocol)}</p>}
                {item.blockedReason && <p className={styles.meta}>{item.blockedReason}</p>}
                {item.state === 'auth_required' && <p className={styles.meta}>上次连接被拒（凭据过期或权限不足）：填一份新的{item.auth.label}再点「连接」。</p>}
                {(item.error || runtime?.error) && <p className={styles.meta}>上次失败：{item.error || runtime?.error}</p>}
                {runtime?.installing && <p className={styles.meta}>正在下载依赖，日志会实时刷新；关掉面板不会中断安装。</p>}
                {runtime?.installing && runtime.logTail && <pre className={styles.logTail}>{runtime.logTail}</pre>}
                {runtime?.argsStale && <p className={styles.warnNote}>运行时还是拿上一套参数起来的{runtime.startedBrowserPath ? `（启动时接的是 ${runtime.startedBrowserPath}）` : ''}：助手现在走的是那一个，不是你这一页选的。点右边的「重启运行时」让它按当前设置重来——「扩展装了却说没装」多半就是这个原因。</p>}
                {runtime?.needsBrowser && <p className={styles.meta}>{browserDisplayName(runtime, item.browserBridge)}</p>}
                {runtime?.needsBrowser && item.browserMode && <div className={styles.policy}>
                  <p className={styles.meta}>接入方式：{BROWSER_MODE_LABELS[item.browserMode]}{item.browserMode === 'managed' ? '（助手用它自己的窗口和登录状态）' : '（用你日常浏览器的登录状态和标签页）'}</p>
                  <div className={styles.segments}>
                    {(['managed', 'extension'] as const).map((mode) => <button
                      key={mode}
                      type="button"
                      className={item.browserMode === mode ? styles.segmentOn : styles.segment}
                      disabled={rowBusy}
                      onClick={() => void switchBrowserMode(item, mode)}
                    >{item.browserMode === mode ? `✓ ${BROWSER_MODE_LABELS[mode]}` : BROWSER_MODE_LABELS[mode]}</button>)}
                  </div>
                  {item.browserMode === 'extension' && item.browserExtension && <>
                    <p className={styles.meta}>{browserBridgeNote(item.browserBridge)}</p>
                    <ol className={styles.steps}>
                      <li>把官方扩展装到「{item.browserBridge?.browserName || '你日常用的浏览器'}」里：<a className={styles.link} href={item.browserExtension.storeUrl} target="_blank" rel="noreferrer">{item.browserExtension.storeName}</a></li>
                      <li>保持这个浏览器开着，回到这里点「启动」再对话——第一次操作会在它里面弹一个连接页，选一个标签页点「Connect」。</li>
                    </ol>
                    <p className={styles.hint}>{item.browserExtension.note}</p>
                    <div className={styles.advancedHead}>
                      <button type="button" className={styles.miniButton} aria-expanded={!collapsed.browserExt} aria-controls={collapsed.browserExt ? undefined : `mcp-ext-${item.id}`} onClick={() => toggleSection('browserExt')}>{collapsed.browserExt ? '进阶设置' : '收起进阶设置'}</button>
                      <span className={styles.hint}>连接码、浏览器路径，以及商店打不开时怎么自建扩展。</span>
                    </div>
                    {!collapsed.browserExt && <div id={`mcp-ext-${item.id}`} className={styles.advanced}>
                      <p className={styles.hint}>连接码在扩展页上（把 <code>PLAYWRIGHT_MCP_EXTENSION_TOKEN=…</code> 整行复制进来）：填了之后连接页自动确认，不用每次点。它只存在本机，只交给这个服务进程。</p>
                      <div className={styles.inline}>
                        <input type="password" aria-label="扩展连接码" value={extensionTokens[item.id] || ''} disabled={rowBusy} placeholder={item.browserBridge?.tokenConfigured ? '已保存连接码（留空表示不改）' : '扩展连接码（可留空）'} onChange={(event) => setExtensionTokens((current) => ({ ...current, [item.id]: event.target.value }))} />
                        <button type="button" className={styles.miniButton} disabled={rowBusy} onClick={() => void saveExtensionToken(item)}>保存连接码</button>
                        {item.browserBridge?.tokenConfigured && <button type="button" className={styles.miniButton} disabled={rowBusy} onClick={() => void saveExtensionToken(item, true)}>清除连接码</button>}
                      </div>
                      <div className={styles.inline}>
                        <input type="text" aria-label="浏览器可执行文件路径" value={browserPaths[item.id] || ''} disabled={rowBusy} placeholder={item.browserBridge?.executablePath || '浏览器可执行文件路径（一般不用填）'} onChange={(event) => setBrowserPaths((current) => ({ ...current, [item.id]: event.target.value }))} />
                        <button type="button" className={styles.miniButton} disabled={rowBusy} onClick={() => void saveBrowserExecutable(item)}>用这个路径</button>
                      </div>
                      <div className={styles.inline}>
                        <button type="button" className={styles.miniButton} disabled={rowBusy} onClick={() => void openExtensionFolder()}>打开自建扩展目录</button>
                        <span className={styles.hint}>商店打不开时（国内常见）：在项目里运行 npm run build:playwright-extension 生成自建扩展，再到浏览器的扩展页用「加载已解压的扩展程序」选中这个目录。</span>
                      </div>
                    </div>}
                  </>}
                </div>}
                {runtime?.running && <p className={styles.meta}>空闲 {Math.max(1, Math.round(runtime.idleTimeoutMs / 60000))} 分钟后自动关闭{runtime.pid ? ` · 进程 ${runtime.pid}` : ''}</p>}
                {remote && <div className={styles.inline}>
                  <input type="password" aria-label={item.auth.label || '凭据'} value={token} disabled={rowBusy} placeholder={item.auth.configured ? '已保存（留空表示不改）' : item.auth.label || '凭据'} onChange={(event) => setTokens((current) => ({ ...current, [item.id]: event.target.value }))} />
                  {item.auth.helpUrl && <a className={styles.link} href={item.auth.helpUrl} target="_blank" rel="noreferrer">去哪儿拿 {item.auth.label}</a>}
                </div>}
                {remote && item.auth.note && <p className={styles.hint}>{item.auth.note}</p>}
                {item.toolsets.length > 0 && <div className={styles.policy}>
                  <p className={styles.meta}>能力组：关掉的组不会交给助手（改动会自动重连一次）</p>
                  <div className={styles.policyGrid}>
                    {item.toolsets.map((toolset) => <label key={toolset.id} className={styles.check} title={toolset.summary}>
                      <input type="checkbox" checked={item.enabledToolsets.includes(toolset.id)} disabled={rowBusy} onChange={() => void toggleCatalogToolset(item, toolset)} />{toolset.label}
                    </label>)}
                  </div>
                </div>}
                {item.writeGates.length > 0 && <div className={styles.policy}>
                  <p className={styles.meta}>{item.allowWrite
                    ? `写权限：已放开 ${item.enabledWriteGates.length} / ${item.writeGates.length} 项，每一次写操作仍然要你确认`
                    : '写权限：全部关闭（先打开上面的「允许写入」，再逐项放开）'}</p>
                  <div className={styles.policyGrid}>
                    {item.writeGates.map((gate) => <label key={gate.id} className={styles.check}>
                      <input type="checkbox" checked={item.enabledWriteGates.includes(gate.id)} disabled={busy || !item.allowWrite} onChange={() => void toggleCatalogWriteGate(item, gate)} />{gate.label}
                    </label>)}
                  </div>
                  <p className={styles.hint}>删除仓库、改密钥、force push、分支保护这类操作没有开关，Catalog 里不会执行。</p>
                </div>}
                {item.needsBrowser && <div className={styles.rootEditor}>
                  <div className={styles.advancedHead}>
                    <button type="button" className={styles.miniButton} aria-expanded={!collapsed.origins} aria-controls={collapsed.origins ? undefined : `mcp-origins-${item.id}`} onClick={() => toggleSection('origins')}>{collapsed.origins ? '站点名单' : '收起站点名单'}</button>
                    <span className={styles.hint}>留空就是不限制：填了之后浏览器只在这些站点里活动（下载、截图这类动作也只在名单内）。</span>
                  </div>
                  {!collapsed.origins && <div id={`mcp-origins-${item.id}`} className={styles.sectionBody}>
                  <label htmlFor={`mcp-origins-allow-${item.id}`}>允许访问的站点（每行一个，例如 <code>https://example.com</code> 或 <code>*://*.example.com</code>）</label>
                  <textarea
                    id={`mcp-origins-allow-${item.id}`}
                    value={originDrafts[item.id]?.allowed ?? (item.origins?.allowed || []).join('\n')}
                    disabled={rowBusy}
                    spellCheck={false}
                    onChange={(event) => setOriginDrafts((current) => ({
                      ...current,
                      [item.id]: {
                        allowed: event.target.value,
                        blocked: current[item.id]?.blocked ?? (item.origins?.blocked || []).join('\n'),
                      },
                    }))}
                  />
                  <label htmlFor={`mcp-origins-block-${item.id}`}>禁止访问的站点（每行一个，优先级高于上面的名单）</label>
                  <textarea
                    id={`mcp-origins-block-${item.id}`}
                    value={originDrafts[item.id]?.blocked ?? (item.origins?.blocked || []).join('\n')}
                    disabled={rowBusy}
                    spellCheck={false}
                    onChange={(event) => setOriginDrafts((current) => ({
                      ...current,
                      [item.id]: {
                        blocked: event.target.value,
                        allowed: current[item.id]?.allowed ?? (item.origins?.allowed || []).join('\n'),
                      },
                    }))}
                  />
                  <div className={styles.inline}>
                    <button type="button" disabled={rowBusy} onClick={() => void saveOrigins(item)}>保存站点名单</button>
                    <span className={styles.hint}>改完要重启运行时才生效；当前名单对正在运行的浏览器不追溯。</span>
                  </div>
                  </div>}
                </div>}
                {item.needsRoots && <div className={styles.rootEditor}>
                  <p className={styles.meta}>{roots.length ? `已授权 ${roots.length} 个文件夹；勾了「写入」的目录才允许助手改文件。` : '还没有授权文件夹；本地文件服务需要至少一个文件夹才能启动。'}</p>
                  <div className={styles.inline}>
                    <button type="button" className={styles.primary} disabled={busy || picking} onClick={() => void pickRootFolder()}>{picking ? '等待选择…' : '选择文件夹…'}</button>
                    <input type="text" aria-label="授权文件夹路径" value={rootDraft} disabled={rowBusy} placeholder="或手填绝对路径，例如 D:\文档（只能填文件夹）" onChange={(event) => setRootDraft(event.target.value)} />
                    <button type="button" disabled={busy || picking || !rootDraft.trim()} onClick={() => void addRoot()}>添加授权文件夹</button>
                  </div>
                  <p className={styles.hint}>「选择文件夹…」由本机弹出系统选择框，选完直接加入授权；远程访问时弹不出来，手填绝对路径即可。</p>
                  {rootSuggestions.length > 0 && <div className={styles.inline}>
                    <span className={styles.meta}>常用位置：</span>
                    {rootSuggestions.map((suggestion) => <button key={suggestion} type="button" disabled={rowBusy} title={`授权 ${suggestion}`} onClick={() => void addRootPath(suggestion)}>+ {suggestion}</button>)}
                  </div>}
                  {roots.map((root) => <div key={root} className={styles.rootRow}>
                    <code>{root}</code>
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={rootEntries.find((entry) => entry.path === root)?.write === true}
                        disabled={rowBusy}
                        onChange={(event) => void toggleRootWrite(root, event.target.checked)}
                      />允许写入
                    </label>
                    <div className={styles.folderActions}>
                      <button type="button" className={styles.miniButton} disabled={rowBusy} title="用系统文件管理器打开这个文件夹" onClick={() => void openRoot(root)}>打开文件夹</button>
                      <button type="button" className={styles.miniButton} disabled={rowBusy} onClick={() => void removeRoot(root)}>移除</button>
                    </div>
                  </div>)}
                  <ul className={styles.notes}>
                    <li>助手只能读这个范围里的文件；要让它改文件，勾上对应目录的「写入」。</li>
                    <li>.env、私钥、浏览器 profile 这类文件即使就在里面也不会读。</li>
                    <li>不确定授权的是哪个目录，点这一行的「打开文件夹」看一眼。</li>
                  </ul>
                </div>}
              </div>
              <div className={styles.rowActions}>
                {!remote && (runtime?.installing
                  ? <button type="button" disabled={rowBusy} onClick={() => void runRuntime('cancel', runtime)}>取消安装</button>
                  : <>
                    {!runtime?.installed && <button type="button" className={styles.primary} disabled={rowBusy || !runtime} onClick={() => runtime && void runRuntime('install', runtime)}>安装</button>}
                    {runtime?.installed && !runtime.running && <button type="button" className={styles.primary} disabled={rowBusy || item.state === 'unavailable'} onClick={() => void runCatalog('start', item, runtime)}>{rowPending === 'start' ? '启动中…' : '启动'}</button>}
                    {runtime?.running && <button type="button" disabled={rowBusy} onClick={() => void runCatalog('stop', item, runtime)}>{rowPending === 'stop' ? '停止中…' : '停止'}</button>}
                    {runtime?.running && runtime.argsStale && <button type="button" className={styles.primary} disabled={rowBusy} onClick={() => void restartRuntime(item)}>{rowPending === 'restart' ? '重启中…' : '重启运行时'}</button>}
                  </>)}
                {remote && (item.connecting
                  ? <button type="button" disabled>连接中…</button>
                  : <>
                    <button type="button" className={styles.primary} disabled={rowBusy} onClick={() => void runCatalog('connect', item)}>{rowPending === 'connect' ? '连接中…' : item.state === 'connected' ? '重新连接' : '连接'}</button>
                    {item.state === 'connected' && <button type="button" disabled={rowBusy} onClick={() => void runCatalog('disconnect', item)}>断开</button>}
                  </>)}
                {item.defaultReadOnly && <label className={styles.check}><input type="checkbox" checked={item.allowWrite} disabled={rowBusy} onChange={() => void toggleCatalogWrite(item)} />允许写入</label>}
              </div>
            </article>;
          })}
        </PanelSection>

        <PanelSection
          id="mcp-section-runtime"
          title="本地工具运行时详情"
          open={!collapsed.runtime || installingRuntime}
          onToggle={() => toggleSection('runtime')}
          summary={`${runtimes.filter((runtime) => runtime.installed).length} / ${runtimes.length} 个已安装`}
        >
          {!runtimes.length && <p className={styles.hint}>正在读取本地运行时的安装与运行状态…</p>}
          {runtimes.map((runtime) => <article key={runtime.id} className={styles.row}>
            <div className={styles.rowMain}>
              <div className={styles.rowTitle}>
                <strong>{runtime.name}</strong>
                <span className={runtime.running ? styles.badgeOn : runtime.state === 'error' ? styles.warnBadge : runtime.installed ? styles.badge : styles.badgeMuted}>{RUNTIME_STATE_LABELS[runtime.state] || runtime.state}</span>
                {runtime.version && <span className={styles.badgeMuted}>{runtime.version}</span>}
              </div>
              <div className={styles.folderRow}>
                <code>{runtime.installRoot}</code>
                {runtime.installed ? <div className={styles.folderActions}><button type="button" className={styles.miniButton} disabled={busy} title="用系统文件管理器打开安装目录" onClick={() => void openRuntimeFolder(runtime)}>打开目录</button></div> : null}
              </div>
              <p className={styles.meta}>
                {runtime.needsBrowser ? browserDisplayName(runtime) : ''}
                {runtime.needsBrowser ? ' · ' : ''}空闲 {Math.max(1, Math.round(runtime.idleTimeoutMs / 60000))} 分钟后自动关闭{runtime.pid ? ` · 进程 ${runtime.pid}` : ''}
              </p>
              {runtime.installing && runtime.logTail && <pre className={styles.logTail}>{runtime.logTail}</pre>}
              {runtime.installNote && <p className={styles.hint}>{runtime.installNote}</p>}
            </div>
          </article>)}
          <ul className={styles.notes}>
            <li>依赖装在本机工作目录里，不写进应用自身依赖。</li>
            <li>浏览器默认用助手自己的 profile（不碰你日常浏览器的登录状态）；也可以在上面的浏览器控制卡片里切到「接我日常的浏览器」，用官方扩展接你自己开着的那个窗口。是否逐次确认取决于上面的审批档位。</li>
            <li>安装始终由你在这里点；助手只能查看状态，并在你明确说「启动 / 关闭浏览器运行时」时启停它。</li>
          </ul>
        </PanelSection>

        <PanelSection
          id="mcp-section-memory"
          title="工具授权记忆与最近调用"
          open={!collapsed.memory}
          onToggle={() => toggleSection('memory')}
          summary={`已记住 ${Object.keys(toolPolicies).length} 个工具`}
        >
          {Object.keys(toolPolicies).length > 0 ? <>
            <p className={styles.meta}>这些工具你已经表过态，助手不会再为它们停下来问。换参数不等于换工具，记错了在这里改回来。</p>
            <div className={styles.memoryList}>
            {Object.entries(toolPolicies).map(([toolId, policy]) => <div key={toolId} className={styles.rootRow}>
              <code>{toolId}</code>
              <em className={policy === 'always_allow' ? styles.policyAllow : styles.policyBlock}>{policy === 'always_allow' ? '以后直接允许' : '以后直接拒绝'}</em>
              <div className={styles.folderActions}>
                <button type="button" className={styles.miniButton} disabled={busy} onClick={() => void forgetToolPolicy(toolId)}>改回每次都问</button>
              </div>
            </div>)}
            </div>
          </> : <p className={styles.hint}>还没有记住任何工具授权：助手每次都会先问你。想少被打断，就在上面每个工具右边点一下「每次都要问」，改成「以后直接允许」或「以后直接拒绝」。</p>}
          {recentCalls.length > 0 && <>
            <p className={styles.meta}>最近调用（只记摘要，不记完整参数与凭据）：</p>
            <div className={styles.memoryList}>
            {recentCalls.slice(0, 10).map((call, index) => <div key={`${call.at}-${index}-${call.tool}`} className={styles.rootRow}>
              <code>{call.serverName} · {call.tool}</code>
              <em className={call.allowed ? styles.policyAllow : styles.policyBlock}>{DECISION_LABELS[call.decision] || call.decision}{call.allowed ? (call.ok ? '，成功' : '，失败') : ''}</em>
              <small className={styles.meta}>{call.summary}</small>
            </div>)}
            </div>
          </>}
        </PanelSection>

        <section className={styles.form} ref={addSection}>
          <div className={styles.formHead}>
            <h3 className={styles.sectionTitle}>
              <button type="button" className={styles.sectionToggle} aria-expanded={showForm} aria-controls="mcp-add-body" disabled={busy} onClick={() => setFormOpen(!showForm)}>
                <span className={styles.sectionIcon} aria-hidden="true" />
                <span>添加 MCP 服务</span>
                {!showForm && <span className={styles.sectionSummary}>接入新服务时展开这里</span>}
                <span className={styles.sectionChevron} aria-hidden="true">{showForm ? '−' : '+'}</span>
              </button>
            </h3>
          </div>
          {showForm && <div id="mcp-add-body" className={styles.sectionBody}>
          <label htmlFor="mcp-paste">快速接入：粘贴配置或地址（可选）</label>
          <textarea id="mcp-paste" value={draft.paste} disabled={busy} spellCheck={false} placeholder={'{"mcpServers":{"notion":{"url":"https://mcp.notion.com/mcp","headers":{"Authorization":"Bearer …"}}}}\n或直接粘贴 https://example.com/mcp'} onChange={(event) => setDraft((current) => ({ ...current, paste: event.target.value }))} />
          <div className={styles.inline}>
            <button type="button" disabled={busy || !draft.paste.trim()} onClick={importConfig}>识别并填入</button>
            <span className={styles.hint}>支持 mcpServers 配置、单个服务对象或纯地址，会填好名称、地址和请求头。</span>
          </div>
          <div className={styles.fieldGrid}>
            <div className={styles.field}>
              <label htmlFor="mcp-name">名称</label>
              <input id="mcp-name" type="text" value={draft.name} disabled={busy} placeholder="留空则按地址推断，例如 GitHub" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div className={styles.field}>
              <label htmlFor="mcp-url">服务地址</label>
              <input id="mcp-url" type="url" value={draft.url} disabled={busy} placeholder="https://example.com/mcp" onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value, name: current.name.trim() ? current.name : deriveMcpServerName(event.target.value) }))} />
            </div>
          </div>
          <label htmlFor="mcp-headers">请求头（可选，每行一条 <code>名称: 值</code>，例如 <code>Authorization: Bearer …</code>）</label>
          <textarea id="mcp-headers" value={draft.headers} disabled={busy} spellCheck={false} onChange={(event) => setDraft((current) => ({ ...current, headers: event.target.value }))} />
          <div className={styles.formFooter}>
            <label className={styles.check}><input type="checkbox" checked={draft.allowWrite} disabled={busy} onChange={() => setDraft((current) => ({ ...current, allowWrite: !current.allowWrite }))} />添加后立即允许写入（有副作用的工具会被放行）</label>
            <button type="button" className={styles.primary} disabled={busy || !draft.url.trim()} onClick={() => void addServer()}>{busy ? '处理中…' : '添加并自检'}</button>
          </div>
          </div>}
        </section>

        </div>

        <footer className={styles.footer}>
          <span className={styles.count}>新增或改动的服务在下一轮对话生效；连不上只会跳过这个服务，不影响其他对话。</span>
          <button type="button" className={styles.primary} disabled={busy} onClick={() => setOpen(false)}>完成</button>
        </footer>
      </dialog>}
    </>
  );
}
