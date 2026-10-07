import { isAdminRequest } from '@/lib/auth';
import {
  MCP_CATALOG_ENTRIES,
  catalogEntryAccount,
  catalogEntryAllowWrite,
  catalogBrowserBridge,
  catalogEntryBrowserMode,
  catalogEntryEnabled,
  catalogEntryError,
  catalogEntryToolsets,
  catalogEntryWriteGates,
  findCatalogEntry,
  isCatalogInstalled,
  isRemoteCatalogEntry,
  isStdioCatalogEntry,
  requireStdioCatalogEntry,
  setCatalogEntryAllowWrite,
  setCatalogEntryBrowserExecutablePath,
  setCatalogEntryBrowserMode,
  setCatalogEntryEnabled,
  setCatalogEntryExtensionToken,
  setCatalogEntryWriteGate,
} from '@/lib/mcp/catalog';
import {
  catalogEntryState,
  configureRemoteCatalogEntry,
  connectRemoteCatalogEntry,
  disconnectRemoteCatalogEntry,
  findRemoteCatalogServer,
  isCatalogEntryConnecting,
  setRemoteCatalogToolset,
} from '@/lib/mcp/catalog-remote';
import {
  MCP_CATALOG_INSTALL_TIMEOUT_MS,
  cancelCatalogInstall,
  catalogRuntimeStatus,
  installCatalogServer,
  startCatalogServer,
  stopCatalogServer,
  type McpCatalogRuntimeStatus,
} from '@/lib/mcp/catalog-runtime';
import { addFilesystemRoot, listFilesystemRoots, readFilesystemRootEntries, removeFilesystemRoot, setFilesystemRootWrite, suggestFilesystemRoots } from '@/lib/mcp/filesystem-roots';
import { catalogEntryOrigins, setCatalogEntryOrigins } from '@/lib/mcp/catalog';
import { readToolApprovalPolicies, setToolApprovalPolicy } from '@/lib/agent/approval';
import { MCP_AUDIT_RECENT_LIMIT, recentMcpCalls } from '@/lib/mcp/audit';
import { openBrowserExtensionFolder, openCatalogFolder, openFilesystemRoot } from '@/lib/mcp/open-folder';
import { listMcpServers, redactMcpServer } from '@/lib/mcp/store';
import { closeStdioServer } from '@/lib/mcp/stdio';
import { clearMcpToolCache } from '@/lib/mcp/tools';
import { resolveMcpProtocolNegotiation } from '@/lib/mcp/client';

export const runtime = 'nodejs';

/**
 * 允许的动作写死在服务端：请求体只能选其中之一，带不了命令、参数或安装路径。
 * 本机运行时（stdio）是安装/启停，远端连接器（http）是连接/断开/配置。
 */
const TOOL_ACTIONS = ['install', 'start', 'stop', 'cancel', 'connect', 'disconnect', 'configure', 'allow-write', 'toolset', 'write-gate', 'roots-add', 'roots-write', 'roots-remove', 'roots-open', 'runtime-open', 'browser-mode', 'extension-open', 'origins', 'tool-policy', 'browser-exe', 'extension-token'] as const;

/** 工具授权记忆只有这三个值：写别的进来等于清掉记忆，不如直接拒掉。 */
const TOOL_POLICY_VALUES = ['ask', 'always_allow', 'block'] as const;

function snapshot() {
  // 授权目录整份只读一次：同一个响应里的运行时状态和条目状态必须来自同一份授权清单。
  const rootEntries = readFilesystemRootEntries();
  const roots = rootEntries.map((entry) => entry.path);
  const runtimes: McpCatalogRuntimeStatus[] = [];
  for (const entry of MCP_CATALOG_ENTRIES) {
    if (!isStdioCatalogEntry(entry)) continue;
    try {
      runtimes.push(catalogRuntimeStatus(entry.id, { roots }));
    } catch {
      // 单个条目取不到状态不该让整个面板打不开。
    }
  }
  const rawServers = listMcpServers();
  // 协议版本跟着传输走：远程 HTTP 记在客户端会话里，本地 stdio 记在进程状态里。
  const servers = rawServers.map((server) => ({ ...redactMcpServer(server), protocol: resolveMcpProtocolNegotiation(server) }));
  const catalog = MCP_CATALOG_ENTRIES.map((entry) => {
    const runtime = runtimes.find((item) => item.id === entry.id);
    const config = rawServers.find((item) => item.id === entry.id);
    return {
      id: entry.id,
      name: entry.name,
      summary: entry.summary,
      examples: [...(entry.examples || [])],
      publisher: entry.publisher,
      homepage: entry.homepage,
      transport: entry.transport,
      installMode: entry.installMode,
      trust: entry.trust,
      capabilities: [...entry.capabilities],
      permissions: [...entry.permissions],
      defaultReadOnly: entry.defaultReadOnly,
      setup: entry.setup,
      version: entry.version || '',
      installNote: entry.installNote || '',
      needsBrowser: isStdioCatalogEntry(entry) ? entry.needsBrowser : false,
      // 浏览器接入方式：内置独立浏览器（默认）还是接用户日常浏览器（需要官方扩展）。
      browserMode: isStdioCatalogEntry(entry) && entry.needsBrowser ? catalogEntryBrowserMode(entry.id) : null,
      // 接日常浏览器时：接的是哪个浏览器、扩展装没装、连接码配没配（连接码的值不出服务端）。
      browserBridge: isStdioCatalogEntry(entry) ? catalogBrowserBridge(entry) : null,
      /** 需要装扩展的条目：商店地址与权限说明由目录给，面板照着渲染引导。 */
      browserExtension: isStdioCatalogEntry(entry) && entry.browserExtension ? { ...entry.browserExtension } : null,
      // 站点名单：只有浏览器条目才有；空数组表示不限制。
      origins: isStdioCatalogEntry(entry) && entry.needsBrowser ? catalogEntryOrigins(entry.id) : null,
      allowedTools: entry.allowedTools.length,
      allowWrite: catalogEntryAllowWrite(entry.id),
      enabled: catalogEntryEnabled(entry.id),
      needsRoots: isStdioCatalogEntry(entry) && entry.requiresRoots === true,
      state: catalogEntryState(entry, { runtime, roots }),
      /** 状态之外的「还差什么」：面板直接显示这句话，不让用户去猜为什么点不动。 */
      blockedReason: isStdioCatalogEntry(entry) && entry.requiresRoots && !roots.length ? '先在下面添加一个授权文件夹，这个服务才知道能读哪里' : '',
      connecting: isCatalogEntryConnecting(entry.id),
      error: catalogEntryError(entry.id),
      /** 连上之后问到的账号名：面板显示「连的是谁」，空字符串表示还没问到。 */
      account: catalogEntryAccount(entry.id),
      /** 谈成的协议版本：两边不一致时面板标注一句；服务端没报版本就是 null。 */
      protocol: runtime?.protocol ?? (config ? resolveMcpProtocolNegotiation(config) : null),
      // 凭据只回「配没配」和去哪儿申请，值永远不出服务端。
      auth: {
        required: entry.setup.requiresAuth,
        optional: entry.auth?.optional === true,
        label: entry.auth?.label || '',
        helpUrl: entry.auth?.helpUrl || '',
        note: entry.auth?.note || '',
        configured: Boolean(config && Object.keys(config.headers || {}).length),
      },
      // 远端条目的可选项：能力组（toolsets）与写权限分项。写权限项打平成一维，
      // 面板只关心「有哪几项、哪几项是开的」。
      toolsets: (entry.toolsets || []).map((toolset) => ({
        id: toolset.id,
        label: toolset.label,
        summary: toolset.summary || '',
        writes: (toolset.writes || []).map((gate) => ({ id: gate.id, label: gate.label })),
      })),
      enabledToolsets: catalogEntryToolsets(entry.id),
      writeGates: (entry.toolsets || []).flatMap((toolset) => (toolset.writes || []).map((gate) => ({ id: gate.id, label: gate.label }))),
      enabledWriteGates: catalogEntryWriteGates(entry.id),
    };
  });
  // 常用位置：主目录下的桌面 / 文档 / 下载。只做建议，加不加仍然由用户点。
  const rootSuggestions = suggestFilesystemRoots({ excluded: roots });
  return {
    runtimes,
    catalog,
    servers,
    roots,
    // 每个目录带不带写权限：面板上「✓读取 □写入」就是照这份渲染的。
    rootEntries,
    rootSuggestions,
    // 最近几次 MCP 判定/调用：谁想调什么、哪一道放行或拦下。这是审计日志的读侧接口。
    recentCalls: recentMcpCalls(MCP_AUDIT_RECENT_LIMIT),
    // 工具授权记忆（ask 不落盘，所以这里只出现 always_allow / block）。
    toolPolicies: readToolApprovalPolicies(),
    installTimeoutMs: MCP_CATALOG_INSTALL_TIMEOUT_MS,
  };
}

/** 面板状态：本地工具运行时的安装/运行情况 + 官方连接器状态 + 用户自己配的远程服务（凭据只回键名）。 */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  return Response.json({ ok: true, ...snapshot() });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const data = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      id?: unknown;
      /** 远端凭据（connect / configure 用）或扩展连接码（extension-token 用）：后者留空表示清除。 */
      token?: unknown;
      /** 授权目录（roots-add / roots-remove / roots-open 用）或浏览器可执行文件（browser-exe 用，留空表示自动识别）。 */
      path?: unknown;
      /** 授权目录的写权限（roots-add / roots-write 用）：true 才允许助手改这个目录里的文件。 */
      write?: unknown;
      /** 工具授权记忆（tool-policy 动作用）：工具 id 与 ask / always_allow / block。 */
      toolId?: unknown;
      policy?: unknown;
      /** 站点名单（origins 动作用）：浏览器条目放行 / 拦截的站点。 */
      allowedOrigins?: unknown;
      blockedOrigins?: unknown;
      allowWrite?: unknown;
      enabled?: unknown;
      lazy?: unknown;
      enabledTools?: unknown;
      /** 能力组（toolset 动作用）：要开/关的组 id。 */
      toolset?: unknown;
      /** 写权限分项（write-gate 动作用）：要开/关的项 id。 */
      gate?: unknown;
      /** 浏览器接入方式（browser-mode 动作用）：managed / extension。 */
      mode?: unknown;
    };
    const action = String(data?.action || '');
    if (!(TOOL_ACTIONS as readonly string[]).includes(action)) {
      return Response.json({ error: '未知动作，只支持安装、启动、停止、取消、连接、断开、配置、权限设置和打开文件夹。' }, { status: 400 });
    }
    if (action === 'cancel') {
      cancelCatalogInstall(data?.id);
      return Response.json({ ok: true, ...snapshot() });
    }
    if (action === 'roots-add' || action === 'roots-remove') {
      // 授权文件夹只能由用户在面板里维护：助手侧的管理工具不碰这份清单（任务书 §12/§42）。
      // 新增默认只读；用户勾了「写入」才连写权限一起给。
      if (action === 'roots-add') addFilesystemRoot(data?.path, { write: data?.write === true });
      else removeFilesystemRoot(data?.path);
      // 启动参数变了：旧进程还带着上一份目录，先收掉；工具表也要重算。
      closeStdioServer('filesystem');
      clearMcpToolCache();
      return Response.json({ ok: true, ...snapshot() });
    }
    if (action === 'roots-write') {
      // 写权限只改这一行，启动参数（Filesystem 只吃路径）没变，所以不用重拉进程。
      setFilesystemRootWrite(data?.path, data?.write === true);
      return Response.json({ ok: true, ...snapshot() });
    }
    if (action === 'tool-policy') {
      const policy = String(data?.policy || '');
      if (!(TOOL_POLICY_VALUES as readonly string[]).includes(policy)) {
        return Response.json({ error: '未知的工具授权记忆，只支持 ask / always_allow / block。' }, { status: 400 });
      }
      // 只记「这个工具以后怎么处理」，不记参数：同一个工具换个参数风险可能完全不同。
      // 在页面里执行代码这类工具的确认免不掉，setToolApprovalPolicy 会直接拒绝并说明原因。
      setToolApprovalPolicy(data?.toolId, policy);
      return Response.json({ ok: true, ...snapshot() });
    }
    if (action === 'origins') {
      const entry = requireStdioCatalogEntry(data?.id);
      if (!entry.needsBrowser) return Response.json({ error: `${entry.name}没有站点名单这一项。` }, { status: 400 });
      setCatalogEntryOrigins(entry.id, { allowed: data?.allowedOrigins, blocked: data?.blockedOrigins });
      // 站点名单是启动参数：旧进程还带着上一套名单，先收掉，下次调用按新的拉起。
      closeStdioServer(entry.id);
      return Response.json({ ok: true, ...snapshot() });
    }
    if (action === 'roots-open' || action === 'runtime-open') {
      // 「打开文件夹」只把授权目录、代码里写死的运行时安装目录交给系统文件管理器：
      // 路径全在服务端解析，请求体只能给动作名，授权目录还要再过一遍授权清单。
      const opened = action === 'roots-open' ? await openFilesystemRoot(data?.path) : await openCatalogFolder(data?.id);
      return Response.json({ ok: true, opened });
    }
    if (action === 'extension-open') {
      // 我们自建的扩展目录（scripts/build-playwright-extension.mjs 的产物）：路径由服务端算，面板只能给动作名。
      return Response.json({ ok: true, opened: await openBrowserExtensionFolder() });
    }
    if (action === 'browser-mode') {
      const entry = requireStdioCatalogEntry(data?.id);
      if (!entry.needsBrowser) return Response.json({ error: `${entry.name}没有「接日常浏览器」这种说法。` }, { status: 400 });
      const mode = data?.mode === 'extension' ? 'extension' : 'managed';
      const wasEnabled = catalogEntryEnabled(entry.id);
      setCatalogEntryBrowserMode(entry.id, mode);
      // 启动参数跟着模式变：旧进程还带着上一套参数，先收掉；工具表缓存也要丢。
      closeStdioServer(entry.id);
      clearMcpToolCache();
      // 装过且开着就顺手自检一次：失败原因原样带回面板（没装扩展、浏览器没开、没授权都要说清）。
      let runtimeError = '';
      if (isCatalogInstalled(entry) && wasEnabled) {
        try {
          await startCatalogServer(entry.id, { roots: listFilesystemRoots() });
        } catch (error) {
          runtimeError = error instanceof Error ? error.message : '自检失败';
          // 换模式不应该顺手把用户的「启用」关掉：自检失败只报告原因，开关仍按用户原来的选择。
          setCatalogEntryEnabled(entry.id, wasEnabled);
        }
      }
      return Response.json({ ok: true, runtimeError, ...snapshot() });
    }
    if (action === 'browser-exe') {
      const entry = requireStdioCatalogEntry(data?.id);
      if (!entry.needsBrowser) return Response.json({ error: `${entry.name}没有浏览器可执行文件这一项。` }, { status: 400 });
      setCatalogEntryBrowserExecutablePath(entry.id, data?.path ?? '');
      // 换浏览器 = 换启动参数：旧进程先收掉，工具表也要重算。
      closeStdioServer(entry.id);
      clearMcpToolCache();
      return Response.json({ ok: true, ...snapshot() });
    }
    if (action === 'extension-token') {
      const entry = requireStdioCatalogEntry(data?.id);
      if (!entry.browserExtension) return Response.json({ error: `${entry.name}没有扩展连接码这一项。` }, { status: 400 });
      setCatalogEntryExtensionToken(entry.id, data?.token ?? '');
      // 连接码是子进程的环境变量：只有换进程才生效。
      closeStdioServer(entry.id);
      clearMcpToolCache();
      return Response.json({ ok: true, ...snapshot() });
    }
    if (action === 'allow-write') {
      const entry = findCatalogEntry(data?.id);
      if (!entry) return Response.json({ error: `未知的本地服务：${String(data?.id || '')}` }, { status: 400 });
      const allowWrite = data?.allowWrite === true;
      setCatalogEntryAllowWrite(entry.id, allowWrite);
      // 写入权限决定哪些工具会上报：缓存必须丢掉，否则这一轮还是旧工具表。
      clearMcpToolCache();
      if (isRemoteCatalogEntry(entry) && findRemoteCatalogServer(entry)) {
        // 远端条目的写权限一半在服务端（x-mcp-readonly 请求头）：连同请求头改掉，
        // 否则会出现「本机放行、服务端仍然拒绝」这种对不上的状态。
        const connection = await configureRemoteCatalogEntry(entry, { allowWrite, retest: true });
        return Response.json({ ok: true, connection, ...snapshot() });
      }
      return Response.json({ ok: true, ...snapshot() });
    }
    if (action === 'toolset' || action === 'write-gate') {
      const entry = findCatalogEntry(data?.id);
      if (!entry || !isRemoteCatalogEntry(entry)) {
        return Response.json({ error: `${String(data?.id || '')} 不是远端连接器，能力组只有远端才有。` }, { status: 400 });
      }
      if (action === 'toolset') {
        // 能力组写在请求头上，要重连一次服务端才会按新的组公布工具。
        const connection = await setRemoteCatalogToolset(entry, data?.toolset, data?.enabled === true);
        return Response.json({ ok: true, connection, ...snapshot() });
      }
      // 写权限分项只影响本机下发哪些写工具：不用重连，但工具表缓存要丢掉。
      setCatalogEntryWriteGate(entry.id, data?.gate, data?.enabled === true);
      clearMcpToolCache();
      return Response.json({ ok: true, ...snapshot() });
    }
    if (action === 'connect' || action === 'disconnect' || action === 'configure') {
      const entry = findCatalogEntry(data?.id);
      if (!entry || !isRemoteCatalogEntry(entry)) {
        return Response.json({ error: `${String(data?.id || '')} 不是远端连接器，远端才能连接。` }, { status: 400 });
      }
      if (action === 'disconnect') {
        disconnectRemoteCatalogEntry(entry);
        return Response.json({ ok: true, ...snapshot() });
      }
      if (action === 'connect') {
        const connection = await connectRemoteCatalogEntry(entry, { token: typeof data.token === 'string' ? data.token : '' });
        return Response.json({ ok: true, connection, ...snapshot() });
      }
      const connection = await configureRemoteCatalogEntry(entry, {
        token: typeof data.token === 'string' ? data.token : '',
        allowWrite: typeof data.allowWrite === 'boolean' ? data.allowWrite : undefined,
        enabledTools: data.enabledTools,
        lazy: typeof data.lazy === 'boolean' ? data.lazy : undefined,
        enabled: typeof data.enabled === 'boolean' ? data.enabled : undefined,
      });
      return Response.json({ ok: true, connection, ...snapshot() });
    }
    // 剩下的三个动作都是本机运行时：id 必须是目录里的 stdio 条目。
    const entry = requireStdioCatalogEntry(data?.id);
    if (action === 'stop') {
      stopCatalogServer(entry.id);
      // 工具表变了：不清缓存，模型下一轮还会拿着已经停掉的工具继续规划。
      clearMcpToolCache();
      return Response.json({ ok: true, ...snapshot() });
    }
    const result = action === 'install'
      ? await installCatalogServer(entry.id)
      : await startCatalogServer(entry.id, { roots: listFilesystemRoots() });
    clearMcpToolCache();
    return Response.json({ ok: true, runtime: result, ...snapshot() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '工具运行时操作失败。' }, { status: 400 });
  }
}
