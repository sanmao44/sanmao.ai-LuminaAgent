/**
 * 本地 stdio MCP 传输：在这台电脑上拉起一个子进程，用换行分隔的 JSON-RPC 与它对话。
 *
 * 这条传输比远程 HTTP 危险得多，所以规则是围绕「尽量不给出可乘之机」写的（任务书 §5.2、§54）：
 * - 只能启动绝对路径的可执行文件，`shell: false`，命令与参数分开传，不拼字符串；
 * - stderr 只留尾部若干字符，话多的服务不会把内存吃光；
 * - 空闲超时、子进程退出、应用关闭都会回收，不留僵尸进程；
 * - 只实现 initialize / tools/list / tools/call，MCP 其余能力（resources/prompts/sampling）先不碰。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { resolveLocalDataDir } from '@/lib/data-paths';
import {
  MCP_CALL_TIMEOUT_MS,
  MCP_INIT_TIMEOUT_MS,
  MCP_LIST_TIMEOUT_MS,
  MCP_MAX_RESPONSE_BYTES,
  MCP_PROTOCOL_VERSION,
  McpError,
  negotiateMcpProtocolVersion,
  resultText,
  type McpProtocolNegotiation,
  type McpRequestOptions,
} from './protocol';
import { MCP_MAX_TOOLS_PER_SERVER } from './store';
import type { McpRemoteTool, McpServerConfig } from './types';

/** 空闲多久回收子进程。浏览器 MCP 常驻是有意义的，但闲着还占内存就没必要。 */
export const MCP_STDIO_IDLE_TIMEOUT_MS = 5 * 60_000;
/** 每个服务最多留多少 stderr 字符：失败时要能看到原因，但不能无限涨。 */
export const MCP_STDIO_MAX_STDERR_CHARS = 8000;
/** tools/list 最多翻几页，和 HTTP 传输保持一致。 */
export const MCP_STDIO_MAX_LIST_PAGES = 5;

type Pending = {
  method: string;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
};

type StdioSession = {
  key: string;
  serverId: string;
  serverName: string;
  child: ChildProcessWithoutNullStreams;
  pending: Map<number, Pending>;
  nextId: number;
  buffer: string;
  stderr: string;
  exit: { code: number | null; signal: string | null } | null;
  idleTimer: NodeJS.Timeout | null;
  handshaken: boolean;
  /** 握手时和服务端谈成的协议版本；没握过手就是 null。 */
  protocol: McpProtocolNegotiation | null;
};

export type McpStdioStatus = {
  running: boolean;
  pid: number | null;
  exit: { code: number | null; signal: string | null } | null;
  stderrTail: string;
  /** 协商出来的协议版本（面板上标注用）；没握过手就是 null。 */
  protocol: McpProtocolNegotiation | null;
};

/**
 * 会话表挂在 globalThis 上。
 *
 * 为什么不是模块级 const：Next dev 的模块热更新会重新执行本文件，模块级 const 会被重新
 * 初始化——表空了，但子进程还活着，下一次调用又拉起一个。挂到 globalThis 之后热更拿到
 * 的是同一份表，空闲回收和退出清理都照旧。
 */
const MCP_STDIO_GLOBAL_KEY = '__sanmaoMcpStdio';

type StdioRegistry = { sessions: Map<string, StdioSession>; cleanupHooked: boolean };

function stdioRegistry(): StdioRegistry {
  const holder = globalThis as unknown as Record<string, StdioRegistry | undefined>;
  const existing = holder[MCP_STDIO_GLOBAL_KEY];
  if (existing) return existing;
  const created: StdioRegistry = { sessions: new Map(), cleanupHooked: false };
  holder[MCP_STDIO_GLOBAL_KEY] = created;
  return created;
}

const registry = stdioRegistry();

/** 会话键的前缀：不同的数据目录不该共用同一条子进程。 */
function stdioDataDirScope() {
  try {
    return resolveLocalDataDir();
  } catch {
    return '';
  }
}

/** 配置变了（命令或参数不同）就必须换一个进程，否则会拿着旧参数继续跑。 */
function sessionKey(server: McpServerConfig) {
  return `${stdioDataDirScope()}\u0000${server.id}\u0000${server.command}\u0000${(server.args || []).join('\u0000')}`;
}

/**
 * 启动前的前置检查。返回字符串表示不能启动。
 * 绝对路径这一条是硬要求：允许写 `node` 就等于允许靠 PATH 解析命令，
 * 用户机器上的 PATH 里有什么，我们并不知情。
 */
export function stdioCommandProblem(server: McpServerConfig): string | null {
  const command = String(server.command || '').trim();
  if (!command) return '本地服务缺少启动命令';
  if (!isAbsolute(command)) return `本地服务的启动命令必须是绝对路径，不接受「${command}」`;
  if (!existsSync(command)) return `找不到本地服务的可执行文件：${command}`;
  const args = server.args || [];
  if (args.some((arg) => typeof arg !== 'string')) return '本地服务的启动参数必须是字符串数组';
  return null;
}

function clearIdleTimer(session: StdioSession) {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
}

/** 进程退出：先把所有在途请求失败掉，再从表里摘掉，避免调用方一直等。 */
function failSession(session: StdioSession, error: Error) {
  clearIdleTimer(session);
  const pending = [...session.pending.values()];
  session.pending.clear();
  for (const item of pending) {
    if (item.timer) clearTimeout(item.timer);
    item.reject(error);
  }
  const current = registry.sessions.get(session.key);
  if (current === session) registry.sessions.delete(session.key);
  try {
    session.child.stdin?.destroy();
  } catch {}
}

function closeSession(session: StdioSession) {
  if (session.exit) return;
  try {
    session.child.kill();
  } catch {}
  failSession(session, new McpError(session.serverName, '本地 MCP 服务已被关闭'));
}

function handleLine(session: StdioSession, line: string) {
  let message: { id?: unknown; result?: any; error?: { message?: string } };
  try {
    message = JSON.parse(line);
  } catch {
    // 服务在 stdout 里打日志是不合规的，但确实存在；忽略这一行，别把整条连接弄坏。
    return;
  }
  if (message?.id === undefined || message?.id === null) return;
  const id = Number(message.id);
  const pending = session.pending.get(id);
  if (!pending) return;
  session.pending.delete(id);
  if (pending.timer) clearTimeout(pending.timer);
  if (message.error) pending.reject(new McpError(session.serverName, `${pending.method} 失败：${String(message.error.message || '服务返回错误')}`));
  else pending.resolve(message.result);
}

function onData(session: StdioSession, chunk: string) {
  session.buffer += chunk;
  if (session.buffer.length > MCP_MAX_RESPONSE_BYTES) {
    session.buffer = '';
    failSession(session, new McpError(session.serverName, '本地 MCP 服务输出异常（单条消息超过上限），已断开'));
    return;
  }
  let index = session.buffer.indexOf('\n');
  while (index >= 0) {
    const line = session.buffer.slice(0, index).trim();
    session.buffer = session.buffer.slice(index + 1);
    if (line) handleLine(session, line);
    index = session.buffer.indexOf('\n');
  }
}

function ensureCleanupHook() {
  if (registry.cleanupHooked) return;
  registry.cleanupHooked = true;
  // 应用退出时把子进程带走，不然会留下孤儿进程。
  process.once('exit', () => {
    for (const session of [...registry.sessions.values()]) {
      try {
        session.child.kill();
      } catch {}
    }
    registry.sessions.clear();
  });
}

function spawnSession(server: McpServerConfig): StdioSession {
  const problem = stdioCommandProblem(server);
  if (problem) throw new McpError(server.name, problem);
  const child = spawn(String(server.command), (server.args || []).map(String), {
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: server.cwd,
    env: { ...process.env, ...(server.env || {}) },
  });
  const session: StdioSession = {
    key: sessionKey(server),
    serverId: server.id,
    serverName: server.name,
    child,
    pending: new Map(),
    nextId: 1,
    buffer: '',
    stderr: '',
    exit: null,
    idleTimer: null,
    handshaken: false,
    protocol: null,
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => onData(session, chunk));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    session.stderr = (session.stderr + chunk).slice(-MCP_STDIO_MAX_STDERR_CHARS);
  });
  child.stdin.on('error', () => undefined);
  child.on('error', (error) => {
    session.exit = { code: null, signal: null };
    failSession(session, new McpError(server.name, `本地 MCP 服务启动失败：${error.message}`));
  });
  child.on('exit', (code, signal) => {
    session.exit = { code, signal };
    const tail = session.stderr.trim().split('\n').slice(-3).join(' / ');
    failSession(session, new McpError(server.name, `本地 MCP 服务已退出（code=${code ?? 'null'}${signal ? `, signal=${signal}` : ''}）${tail ? `：${tail}` : ''}`));
  });
  ensureCleanupHook();
  return session;
}

async function ensureSession(server: McpServerConfig, options: McpRequestOptions): Promise<StdioSession> {
  const key = sessionKey(server);
  const existing = registry.sessions.get(key);
  if (existing && !existing.exit) return existing;
  if (existing) registry.sessions.delete(key);
  const session = spawnSession(server);
  // 同一台服务改了命令：旧进程先关掉，避免两份同时活着抢资源。
  for (const other of [...registry.sessions.values()]) {
    if (other.key !== key && other.serverId === server.id) closeSession(other);
  }
  registry.sessions.set(key, session);
  if (options.signal?.aborted) closeSession(session);
  return session;
}

function touch(session: StdioSession) {
  clearIdleTimer(session);
  session.idleTimer = setTimeout(() => closeSession(session), MCP_STDIO_IDLE_TIMEOUT_MS);
  // 空闲计时器不该拖住整个 Node 进程（构建、测试时尤其明显）。
  session.idleTimer.unref?.();
}

function send(session: StdioSession, payload: Record<string, unknown>) {
  if (session.exit) throw new McpError(session.serverName, '本地 MCP 服务已经退出');
  session.child.stdin.write(`${JSON.stringify(payload)}\n`);
}

function request(
  session: StdioSession,
  method: string,
  params: Record<string, unknown>,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<any> {
  const id = session.nextId;
  session.nextId += 1;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.pending.delete(id);
      reject(new McpError(session.serverName, `${method} 超时（${Math.round(options.timeoutMs / 1000)} 秒）`));
    }, options.timeoutMs);
    timer.unref?.();
    const onAbort = () => {
      session.pending.delete(id);
      clearTimeout(timer);
      reject(new McpError(session.serverName, '本轮调用已停止'));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    session.pending.set(id, {
      method,
      resolve: (value) => {
        options.signal?.removeEventListener('abort', onAbort);
        touch(session);
        resolve(value);
      },
      reject: (error) => {
        options.signal?.removeEventListener('abort', onAbort);
        touch(session);
        reject(error);
      },
      timer,
    });
    try {
      send(session, { jsonrpc: '2.0', id, method, params });
    } catch (error) {
      session.pending.delete(id);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new McpError(session.serverName, '本地 MCP 服务不可用'));
    }
  });
}

function notify(session: StdioSession, method: string) {
  try {
    send(session, { jsonrpc: '2.0', method });
  } catch {}
}

async function handshake(session: StdioSession, server: McpServerConfig, options: McpRequestOptions) {
  if (session.handshaken) return;
  const requested = options.protocolVersion || MCP_PROTOCOL_VERSION;
  const result = await request(session, 'initialize', {
    protocolVersion: requested,
    capabilities: {},
    clientInfo: { name: 'SANMAO.AI', version: '1.0' },
  }, { timeoutMs: options.timeouts?.init ?? MCP_INIT_TIMEOUT_MS, signal: options.signal });
  if (!result || typeof result !== 'object') throw new McpError(server.name, '本地 MCP 服务没有完成握手');
  // 版本对不上只记下来（面板上标注），不当作错误：能连上比版本号一致更重要。
  session.protocol = negotiateMcpProtocolVersion(result?.protocolVersion, requested);
  notify(session, 'notifications/initialized');
  session.handshaken = true;
}

/**
 * 把「拿会话 → 握手 → 执行」包起来。
 * 只有进程真的死了（session.exit）并且调用方明确允许重试时才重来一次：
 * 工具可能已经执行了一半，写类工具绝不能自动重放。
 */
async function withStdioSession<T>(
  server: McpServerConfig,
  options: McpRequestOptions,
  run: (session: StdioSession) => Promise<T>,
): Promise<T> {
  const session = await ensureSession(server, options);
  await handshake(session, server, options);
  try {
    return await run(session);
  } catch (error) {
    if (options.retry !== true || options.signal?.aborted || !session.exit) throw error;
    const fresh = await ensureSession(server, options);
    await handshake(fresh, server, options);
    return await run(fresh);
  }
}

export async function listStdioServerTools(server: McpServerConfig, options: McpRequestOptions = {}): Promise<McpRemoteTool[]> {
  return withStdioSession(server, options, async (session) => {
    const tools: McpRemoteTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MCP_STDIO_MAX_LIST_PAGES; page += 1) {
      const result = await request(session, 'tools/list', cursor ? { cursor } : {}, {
        timeoutMs: options.timeouts?.list ?? MCP_LIST_TIMEOUT_MS,
        signal: options.signal,
      });
      const pageTools: McpRemoteTool[] = Array.isArray(result?.tools) ? result.tools : [];
      for (const tool of pageTools) {
        const name = String(tool?.name || '').trim();
        if (!name || tools.some((item) => item.name === name)) continue;
        tools.push({ ...tool, name });
        if (tools.length >= MCP_MAX_TOOLS_PER_SERVER) return tools;
      }
      cursor = typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
      if (!cursor) break;
    }
    return tools;
  });
}

export async function callStdioTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
  options: McpRequestOptions = {},
): Promise<{ text: string; isError: boolean }> {
  return withStdioSession(server, options, async (session) => {
    const result = await request(session, 'tools/call', { name: toolName, arguments: args }, {
      timeoutMs: options.timeouts?.call ?? MCP_CALL_TIMEOUT_MS,
      signal: options.signal,
    });
    return { text: resultText(result), isError: Boolean(result?.isError) };
  });
}

/** 面板和自检用的实时状态：进程在不在、pid、退出码、最近的 stderr。 */
export function stdioServerStatus(serverId: string): McpStdioStatus {
  for (const session of registry.sessions.values()) {
    if (session.serverId !== serverId) continue;
    return {
      running: !session.exit,
      pid: session.child.pid ?? null,
      exit: session.exit,
      stderrTail: session.stderr.slice(-2000),
      protocol: session.protocol,
    };
  }
  return { running: false, pid: null, exit: null, stderrTail: '', protocol: null };
}

/** 关掉指定服务的进程；不传 serverId 表示全部关掉（应用退出、测试清理用）。 */
export function closeStdioServer(serverId?: string) {
  for (const session of [...registry.sessions.values()]) {
    if (serverId && session.serverId !== serverId) continue;
    closeSession(session);
  }
}
