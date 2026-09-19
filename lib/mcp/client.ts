import { createHash } from 'node:crypto';
import { MCP_MAX_TOOLS_PER_SERVER } from './store';
import type { McpRemoteTool, McpServerConfig } from './types';

/**
 * 最小 MCP 客户端：只实现 tools/list 与 tools/call 需要的部分
 * （initialize → notifications/initialized → tools/list / tools/call），
 * 不引入官方 SDK，也就不需要新增依赖。
 *
 * 传输只支持 Streamable HTTP：响应可能是 application/json，也可能是 text/event-stream，
 * 两种都要认（规范允许服务端自行选择）。
 */

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_INIT_TIMEOUT_MS = 10_000;
export const MCP_LIST_TIMEOUT_MS = 15_000;
export const MCP_CALL_TIMEOUT_MS = 120_000;
export const MCP_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MCP_MAX_TOOL_RESULT_CHARS = 8000;
/** 一轮对话里最多调用几次外部服务，以及这些调用加起来最多花多久。 */
export const MCP_TOOL_MAX_CALLS_PER_TURN = 4;
export const MCP_TURN_TIME_BUDGET_MS = 150_000;

export class McpError extends Error {
  readonly server: string;

  constructor(server: string, message: string) {
    super(message);
    this.name = 'McpError';
    this.server = server;
  }
}

type JsonRpcMessage = { jsonrpc?: string; id?: unknown; result?: any; error?: { code?: number; message?: string }; method?: string };
/** 各阶段超时；默认值见下面三个常量，调用方（含测试）可以单独覆盖。 */
export type McpTimeouts = { init?: number; list?: number; call?: number };
type McpClientOptions = { fetchImpl?: typeof fetch; now?: () => number; timeouts?: McpTimeouts };
type McpCallOptions = McpClientOptions & {
  signal?: AbortSignal;
  /** 失败后是否允许换一个会话重放一次；默认允许，写类工具必须显式传 false。 */
  retry?: boolean;
};

/** 已建立的会话（initialize 拿到的 mcp-session-id），按「地址 + 凭据」缓存。 */
const sessions = new Map<string, string>();
let sequence = 1;

/** 丢弃缓存的会话；配置改了（地址或请求头）必须让旧会话失效，否则会拿着旧凭据继续用。 */
export function resetMcpSessions(url?: string) {
  if (!url) {
    sessions.clear();
    return;
  }
  const prefix = `${url}\u0000`;
  for (const key of [...sessions.keys()]) {
    if (key === url || key.startsWith(prefix)) sessions.delete(key);
  }
}

/**
 * 同一地址配了两套 token 时必须各握手一次：只按 URL 缓存会让 B 服务拿着 A 的会话 ID
 * 去调用，等于把两个账号的会话混在一起。凭据只参与哈希，不进 Map 的键。
 */
function sessionKey(server: McpServerConfig) {
  const headers = Object.entries(server.headers || {})
    .map(([name, value]) => `${name}:${value}`)
    .sort()
    .join('\n');
  if (!headers) return server.url;
  return `${server.url}\u0000${createHash('sha256').update(headers).digest('hex').slice(0, 16)}`;
}

function nextId() {
  sequence += 1;
  return sequence;
}

function timeoutSignal(external: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('MCP_TIMEOUT')), ms);
  const forward = () => controller.abort(external?.reason);
  external?.addEventListener('abort', forward, { once: true });
  return {
    signal: controller.signal,
    release: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', forward);
    },
  };
}

/** 读取响应体，超过上限直接中断，避免被一个超大响应拖垮这一轮。 */
async function readCapped(response: Response, limit = MCP_MAX_RESPONSE_BYTES) {
  const body = response.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      size += value.length;
      if (size > limit) throw new Error('MCP_OVERSIZE');
      chunks.push(value);
    }
  } finally {
    // 超限时要把底层连接也停掉，只解绑 reader 会留下一条还在推数据的响应流。
    if (size > limit) await reader.cancel().catch(() => undefined);
    else reader.releaseLock?.();
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8').decode(merged);
}

/** SSE 响应里每条 data: 是一个 JSON-RPC 报文，取最后一条有效消息。 */
function parseSseMessages(text: string) {
  const messages: JsonRpcMessage[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data || data === '[DONE]') continue;
    try {
      messages.push(JSON.parse(data));
    } catch {}
  }
  return messages;
}

async function parseMcpResponse(server: McpServerConfig, response: Response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const text = await readCapped(response);
  if (contentType.includes('text/event-stream')) return parseSseMessages(text);
  if (!text.trim()) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    throw new McpError(server.name, 'MCP 返回的内容不是合法 JSON-RPC 报文');
  }
}

async function post(server: McpServerConfig, payload: Record<string, unknown>, options: McpClientOptions & { timeoutMs: number; expectReply: boolean; signal?: AbortSignal }) {
  const fetchImpl = options.fetchImpl || fetch;
  const { signal, release } = timeoutSignal(options.signal, options.timeoutMs);
  try {
    const headers: Record<string, string> = {
      ...(server.headers || {}),
      // 协议头放在用户请求头之后：用户能加自己的凭据，但不能把协议头改成别的值。
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MCP_PROTOCOL_VERSION,
    };
      const key = sessionKey(server);
      const session = sessions.get(key);
      if (session) headers['mcp-session-id'] = session;
      const response = await fetchImpl(server.url, { method: 'POST', headers, body: JSON.stringify(payload), signal });
      const issued = response.headers.get('mcp-session-id');
      if (issued) sessions.set(key, issued);
    if (response.status === 401 || response.status === 403) throw new McpError(server.name, `MCP 服务拒绝访问（${response.status}），请检查请求头里的凭据`);
    if (response.status === 404 || response.status === 405) throw new McpError(server.name, `MCP 服务地址不支持 Streamable HTTP（${response.status}），换用支持 Streamable HTTP 的远程地址`);
    if (response.status >= 400) throw new McpError(server.name, `MCP 服务返回 ${response.status}`);
    if (!options.expectReply) return null;
    const messages = await parseMcpResponse(server, response);
    const message = messages.find((item) => item && item.id !== undefined && String(item.id) === String(payload.id)) || messages.find((item) => item?.result || item?.error) || null;
    if (!message) throw new McpError(server.name, 'MCP 服务没有返回结果');
    if (message.error) throw new McpError(server.name, String(message.error.message || 'MCP 调用失败'));
    return message.result ?? null;
  } catch (error) {
    if (error instanceof McpError) throw error;
    if (options.signal?.aborted) throw options.signal.reason || new Error('AGENT_CANCELLED');
    const message = error instanceof Error ? error.message : 'MCP 请求失败';
    if (message === 'MCP_TIMEOUT') throw new McpError(server.name, 'MCP 服务响应超时');
    if (message === 'MCP_OVERSIZE') throw new McpError(server.name, 'MCP 返回内容过大，已中断');
    throw new McpError(server.name, `无法连接 MCP 服务：${message}`);
  } finally {
    release();
  }
}

async function ensureSession(server: McpServerConfig, options: McpClientOptions & { signal?: AbortSignal }) {
  if (sessions.has(sessionKey(server))) return;
  const result = await post(server, {
    jsonrpc: '2.0',
    id: nextId(),
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'SANMAO.AI', version: '1.0' },
    },
  }, { ...options, timeoutMs: options.timeouts?.init ?? MCP_INIT_TIMEOUT_MS, expectReply: true });
  if (!result || typeof result !== 'object') throw new McpError(server.name, 'MCP 服务没有完成握手');
  // 规范要求的确认通知；服务端不回内容，失败也不影响后续调用。
  await post(server, { jsonrpc: '2.0', method: 'notifications/initialized' }, { ...options, timeoutMs: options.timeouts?.init ?? MCP_INIT_TIMEOUT_MS, expectReply: false }).catch(() => null);
}

/**
 * 会话可能被服务端回收：第一次失败就丢掉缓存重来一次。
 *
 * 重放必须是安全的。读工具重放最多多读一次；写工具重放可能是第二次创建、
 * 第二次发送——服务端其实已经执行成功、只是响应没回来的情况并不少见。
 * 所以只有调用方明确说 retry !== false 时才重放。
 */
async function withSession<T>(server: McpServerConfig, options: McpCallOptions, run: () => Promise<T>): Promise<T> {
  await ensureSession(server, options);
  try {
    return await run();
  } catch (error) {
    if (options.retry === false || !(error instanceof McpError) || options.signal?.aborted) throw error;
    sessions.delete(sessionKey(server));
    await ensureSession(server, options);
    return await run();
  }
}

export async function listMcpServerTools(server: McpServerConfig, options: McpCallOptions = {}): Promise<McpRemoteTool[]> {
  return withSession(server, options, async () => {
    const tools: McpRemoteTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const result = await post(server, {
        jsonrpc: '2.0',
        id: nextId(),
        method: 'tools/list',
        params: cursor ? { cursor } : {},
      }, { ...options, timeoutMs: options.timeouts?.list ?? MCP_LIST_TIMEOUT_MS, expectReply: true });
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

function resultText(result: any) {
  const parts: string[] = [];
  const content = Array.isArray(result?.content) ? result.content : [];
  for (const item of content) {
    if (item?.type === 'text' && typeof item.text === 'string') parts.push(item.text);
    else if (typeof item?.resource?.text === 'string') parts.push(item.resource.text);
    // 图片/音频这类二进制内容不进上下文，只标注一下类型。
    else if (typeof item?.type === 'string') parts.push(`[${item.type}]`);
  }
  if (result?.structuredContent !== undefined) {
    try {
      parts.push(JSON.stringify(result.structuredContent));
    } catch {}
  }
  const text = parts.join('\n').trim();
  if (text.length <= MCP_MAX_TOOL_RESULT_CHARS) return text;
  // 截断必须说出来：否则模型会以为拿到的是完整内容，基于残缺数据下结论。
  return `${text.slice(0, MCP_MAX_TOOL_RESULT_CHARS)}\n…（结果过长已截断，以上只是前 ${MCP_MAX_TOOL_RESULT_CHARS} 个字符；如需完整内容请让用户在服务端分页或缩小查询范围。）`;
}

export async function callMcpTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
  options: McpCallOptions = {},
): Promise<{ text: string; isError: boolean }> {
  // 默认不重放：写工具重复执行的代价远高于一次失败。只读工具由调用方显式打开重试。
  return withSession(server, { ...options, retry: options.retry === true }, async () => {
    const result = await post(server, {
      jsonrpc: '2.0',
      id: nextId(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }, { ...options, timeoutMs: options.timeouts?.call ?? MCP_CALL_TIMEOUT_MS, expectReply: true });
    return { text: resultText(result), isError: Boolean(result?.isError) };
  });
}

/** 连接自检：能列工具就算连通，顺便把工具名带回去给面板展示。 */
export async function probeMcpServer(server: McpServerConfig, options: McpCallOptions = {}) {
  const tools = await listMcpServerTools(server, options);
  return { tools, readOnly: tools.filter((tool) => tool.annotations?.readOnlyHint === true).length };
}

export type { McpRemoteTool };
