/**
 * MCP 调用审计：每次调用外部服务都往 `.data/mcp/calls/YYYY-MM-DD.jsonl` 追加一行。
 *
 * 为什么只写摘要：这份日志是用来回答「助手到底动了什么」的，不是用来复现请求的。
 * 完整参数里可能有 token、cookie、刚读进来的文件内容，落盘等于把它们又抄了一份。
 * 所以这里只写：谁、调了什么工具、哪一道判定放行的、成没成、花了多久、结果前 200 字。
 * 凭据样式的内容在写之前还会再过一遍遮蔽，双保险。
 *
 * 滚动规则：按天一个文件，单个文件到 5MB 就换下一个分片（`YYYY-MM-DD.2.jsonl`），
 * 只保留 7 天；一天写满 9 个分片就不再写，审计不该变成磁盘黑洞。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveLocalDataDir } from '@/lib/data-paths';

export const MCP_AUDIT_RETENTION_DAYS = 7;
export const MCP_AUDIT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MCP_AUDIT_MAX_SUMMARY_CHARS = 200;
export const MCP_AUDIT_RECENT_LIMIT = 50;
/** 一天最多几个分片：写满就不再写，避免故障时把磁盘写满。 */
const MCP_AUDIT_MAX_PARTS = 9;

/**
 * 判定来源：
 * - policy   工具注册表 / 写入权限把它拦下了；
 * - block    用户把这个工具设成了「以后直接拒绝」；
 * - guard    本机一侧的路径策略把它拦下了（路径不在授权目录、只读目录要写）；
 * - approval 用户点过「允许」后执行的（含续跑）；
 * - rejected 用户点了「拒绝」；
 * - call     判定通过后直接执行。
 */
export type McpAuditDecision = 'policy' | 'block' | 'guard' | 'approval' | 'rejected' | 'call';

export type McpCallAuditEntry = {
  /** 发生时间（毫秒时间戳）。 */
  at: number;
  serverId: string;
  serverName: string;
  tool: string;
  risk: string;
  /** 这一层放没放行。 */
  allowed: boolean;
  decision: McpAuditDecision;
  /** 真的执行了的话，服务端有没有报错。 */
  ok: boolean;
  durationMs: number;
  /** 结果摘要（前 200 字，已遮蔽凭据样式内容）。 */
  summary: string;
};

/**
 * 写入这一条时，`at` 由这里补、`summary` 由这里归一化（遮蔽 + 截断），
 * 所以调用方给什么形态的摘要都行，落盘的一定是短字符串。
 */
export type McpAuditRecord = Omit<McpCallAuditEntry, 'at' | 'summary'> & { at?: number; summary?: unknown };

export type McpAuditOptions = { dataDir?: string; now?: () => number };

export function resolveMcpCallsDir(options: McpAuditOptions = {}) {
  return path.join(options.dataDir || resolveLocalDataDir(), 'mcp', 'calls');
}

/** 本地日期，和用户看到的「今天」一致；用 UTC 会让晚上写的日志落到前一天。 */
function dayStamp(at: number) {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 凭据样式的内容一律遮蔽：审计日志不该成为第二份秘密存放处。 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /(bearer\s+)[\w.\-]{8,}/gi,
  /((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd)\s*[=:]\s*)[^\s,;"']{6,}/gi,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
];

/** 把一段文本压成可落盘的摘要：折叠空白 → 遮蔽凭据 → 截断。 */
export function summarizeMcpAuditText(value: unknown) {
  let text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match, prefix: string) => (prefix ? `${prefix}***` : '***'));
  }
  return text.slice(0, MCP_AUDIT_MAX_SUMMARY_CHARS);
}

/** 单个分片到上限就换下一个：这样每个文件都受 5MB 约束，读的时候也不会一次吞下整天的量。 */
function pickCallsFile(dir: string, stamp: string, incomingBytes: number) {
  for (let part = 1; part <= MCP_AUDIT_MAX_PARTS; part += 1) {
    const file = path.join(dir, part === 1 ? `${stamp}.jsonl` : `${stamp}.${part}.jsonl`);
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      size = 0;
    }
    if (size + incomingBytes <= MCP_AUDIT_MAX_FILE_BYTES) return file;
  }
  return null;
}

/** 删掉超过保留期的按天文件；文件名前缀就是日期，字符串比较即可。 */
function pruneMcpCalls(options: McpAuditOptions, now: number) {
  const dir = resolveMcpCallsDir(options);
  if (!existsSync(dir)) return;
  const cutoff = dayStamp(now - MCP_AUDIT_RETENTION_DAYS * 24 * 60 * 60_000);
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    return;
  }
  for (const file of files) {
    const stamp = file.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    if (!stamp || stamp >= cutoff) continue;
    try {
      rmSync(path.join(dir, file), { force: true });
    } catch {}
  }
}

/**
 * 记一笔调用。写日志失败绝不能影响这次调用本身，所以整段是 best-effort：
 * 磁盘满了、权限不对，都不该让工具报错。
 */
export function recordMcpCall(record: McpAuditRecord, options: McpAuditOptions = {}) {
  const at = record.at ?? (options.now ? options.now() : Date.now());
  const entry: McpCallAuditEntry = {
    at,
    serverId: String(record.serverId || ''),
    serverName: String(record.serverName || ''),
    tool: String(record.tool || ''),
    risk: String(record.risk || ''),
    allowed: record.allowed === true,
    decision: record.decision,
    ok: record.ok === true,
    durationMs: Math.max(0, Math.round(Number(record.durationMs) || 0)),
    summary: summarizeMcpAuditText(record.summary),
  };
  try {
    const dir = resolveMcpCallsDir(options);
    mkdirSync(dir, { recursive: true });
    const line = `${JSON.stringify(entry)}\n`;
    const file = pickCallsFile(dir, dayStamp(at), Buffer.byteLength(line));
    if (file) appendFileSync(file, line, { encoding: 'utf8', mode: 0o600 });
    pruneMcpCalls(options, at);
  } catch {}
  return entry;
}

/** 面板要显示「最近发生了什么」：按天倒着读，最新的一条在最前面。 */
export function recentMcpCalls(limit: number = MCP_AUDIT_RECENT_LIMIT, options: McpAuditOptions = {}): McpCallAuditEntry[] {
  const dir = resolveMcpCallsDir(options);
  if (!existsSync(dir)) return [];
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith('.jsonl')).sort().reverse();
  } catch {
    return [];
  }
  const wanted = Math.max(1, Math.min(500, Number(limit) || MCP_AUDIT_RECENT_LIMIT));
  const entries: McpCallAuditEntry[] = [];
  for (const file of files) {
    let lines: string[] = [];
    try {
      lines = readFileSync(path.join(dir, file), 'utf8').split('\n');
    } catch {
      continue;
    }
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].trim();
      if (!line) continue;
      try {
        entries.push(JSON.parse(line) as McpCallAuditEntry);
      } catch {}
      if (entries.length >= wanted) return entries;
    }
  }
  return entries;
}
