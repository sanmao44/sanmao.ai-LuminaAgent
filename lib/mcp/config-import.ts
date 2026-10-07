/**
 * 把别处复制的 MCP 配置翻译成面板表单字段，让「接入」不用手抄地址和请求头。
 *
 * 认得的形状：`{"mcpServers":{"x":{…}}}`（Claude Desktop / Cursor 文档里的写法）、
 * 单个服务对象、以及直接粘贴一个 https:// 地址。本地命令型（stdio）配置要明确拒绝——
 * 那种服务需要在本机拉起进程，含糊地填进去只会让用户以为接好了。
 */

export type McpConfigImport = {
  name: string;
  url: string;
  headers: Record<string, string>;
  /** 回显用：识别到了什么、还差什么。 */
  note: string;
};

const URL_KEYS = ['url', 'serverUrl', 'endpoint', 'baseUrl', 'address'] as const;
/** 出现这些字段说明要跑本地进程：当前版本接不了。 */
const STDIO_KEYS = ['command', 'args', 'stdio', 'docker'] as const;
const CONTAINER_KEYS = ['mcpServers', 'servers', 'mcp'] as const;
/** 主机名里这些词不算服务名，用来从地址推断一个可读名称。 */
const GENERIC_HOST_LABELS = new Set(['mcp', 'api', 'www', 'server', 'gateway', 'app', 'com', 'cn', 'io', 'ai', 'dev', 'net', 'org', 'co', 'xyz', 'top']);
const PLACEHOLDER_PATTERN = /\$\{[^}]+\}|\{\{[^}]+\}|<[^>\s]+>/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** 从地址推断服务名：https://mcp.notion.com/mcp → notion。 */
export function deriveMcpServerName(url: string) {
  try {
    const host = new URL(String(url || '').trim()).hostname.toLowerCase();
    if (/^[\d.]+$/.test(host)) return 'local-mcp';
    const parts = host.split('.').filter(Boolean);
    const label = parts.find((part) => !GENERIC_HOST_LABELS.has(part)) || parts[0] || 'mcp';
    return label.slice(0, 40);
  } catch {
    return 'mcp';
  }
}

/** 请求头按面板约定的「名称: 值」逐行写回，方便用户核对。 */
export function headersToText(headers: Record<string, string>) {
  return Object.entries(headers || {}).map(([key, value]) => `${key}: ${value}`).join('\n');
}

function pickUrl(entry: Record<string, unknown>) {
  for (const key of URL_KEYS) {
    const value = entry[key];
    if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) return value.trim();
  }
  return '';
}

function pickHeaders(entry: Record<string, unknown>) {
  const raw = asRecord(entry.headers);
  if (!raw) return {};
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const name = key.trim();
    const text = typeof value === 'string' ? value.trim() : '';
    if (name && text) headers[name] = text;
  }
  return headers;
}

export function parseMcpConfigText(text: string): McpConfigImport {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('先粘贴 MCP 配置或服务地址，再点识别。');

  if (!raw.startsWith('{') && !raw.startsWith('[')) {
    if (/^https?:\/\/\S+$/i.test(raw)) {
      return { name: deriveMcpServerName(raw), url: raw, headers: {}, note: '已按服务地址识别。' };
    }
    throw new Error('没认出配置：可以粘贴一段含 url 的 JSON，或直接粘贴 https:// 开头的服务地址。');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('这段内容不是合法 JSON：检查括号和引号，或改成只粘贴 https:// 开头的服务地址。');
  }
  const root = asRecord(parsed);
  if (!root) throw new Error('配置的顶层需要是一个对象。');

  let key = '';
  let entry: Record<string, unknown> | null = null;
  let note = '';
  for (const containerKey of CONTAINER_KEYS) {
    const container = asRecord(root[containerKey]);
    if (!container) continue;
    const entries = Object.entries(container).filter(([, value]) => asRecord(value));
    if (!entries.length) break;
    key = entries[0][0];
    entry = asRecord(entries[0][1]);
    if (entries.length > 1) note = `配置里有 ${entries.length} 个服务，已填入第一个「${key}」，其余的照同样方式逐个添加。`;
    break;
  }
  if (!entry) {
    entry = root;
    key = typeof root.name === 'string' ? root.name : typeof root.id === 'string' ? root.id : '';
  }

  const url = pickUrl(entry);
  if (!url) {
    const stdio = STDIO_KEYS.some((stdioKey) => entry?.[stdioKey] !== undefined);
    throw new Error(stdio
      ? '这是本地命令型（stdio）服务：它要在这台电脑上拉起进程，当前只支持远程 http(s) 地址。请换服务方给的远程 MCP 地址。'
      : '配置里没有 http(s) 地址（url / serverUrl / endpoint）。');
  }

  const rawName = typeof entry.name === 'string' ? entry.name : typeof entry.title === 'string' ? entry.title : '';
  const name = (rawName.trim() || key || deriveMcpServerName(url)).slice(0, 40);
  const headers = pickHeaders(entry);
  const notes = [
    `已识别「${name}」`,
    note,
    headers && Object.keys(headers).length ? '请求头已填入，保存前确认一下是真实凭据。' : '',
    PLACEHOLDER_PATTERN.test(raw) ? '配置里的 ${…} 占位符要换成真实值再添加。' : '',
  ].filter(Boolean);
  return { name, url, headers, note: notes.join('；') };
}
