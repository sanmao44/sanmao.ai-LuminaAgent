import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * The stable Tabbit launcher is deliberately resolved outside the app bundle.
 * Tabbit owns the Playwright runtime; SANMAO only transports a bounded program
 * to that runtime and never starts a second browser or a Playwright extension.
 */
export function resolveTabbitCli(options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const candidate = platform === 'win32'
    ? path.win32.join(env.LOCALAPPDATA || path.win32.join(env.USERPROFILE || '', 'AppData', 'Local'), 'Tabbit', 'LocalAgent', 'bin', 'tabbit-cli.exe')
    : path.join(env.HOME || '', '.local', 'bin', 'tabbit-cli');
  return existsSync(candidate) ? candidate : null;
}

export function isTabbitCliAvailable(options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {}) {
  return Boolean(resolveTabbitCli(options));
}

type TabbitAction = 'diagnose' | 'tabs' | 'claim' | 'resume' | 'nodejs' | 'resource' | 'receipt' | 'finish';

export type TabbitBrowserArgs = {
  action?: unknown;
  task?: unknown;
  requestId?: unknown;
  code?: unknown;
  readOnly?: unknown;
  timeoutMs?: unknown;
  state?: unknown;
  limit?: unknown;
  tabId?: unknown;
  tabIds?: unknown;
  groupId?: unknown;
  resource?: unknown;
  offset?: unknown;
  maxBytes?: unknown;
  discard?: unknown;
};

export type TabbitCliResult = {
  ok: boolean;
  action: TabbitAction;
  status?: string;
  response?: unknown;
  error?: string;
  exitCode?: number | null;
};

const ACTIONS = new Set<TabbitAction>(['diagnose', 'tabs', 'claim', 'resume', 'nodejs', 'resource', 'receipt', 'finish']);
const SAFE_TOKEN = /^[A-Za-z0-9_-]{1,96}$/;
const GROUP_ID = /^[A-Fa-f0-9]{16,96}$/;
const MAX_CODE_CHARS = 240_000;
const MAX_OUTPUT_CHARS = 120_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 180_000;

function token(value: unknown, label: string, pattern = SAFE_TOKEN) {
  const result = String(value ?? '').trim();
  if (!pattern.test(result)) throw new Error(`${label} 格式无效`);
  return result;
}

function optionalToken(value: unknown, label: string, pattern = SAFE_TOKEN) {
  const result = String(value ?? '').trim();
  return result ? token(result, label, pattern) : '';
}

function integer(value: unknown, label: string, min: number, max: number, fallback: number) {
  if (value === undefined || value === null || value === '') return fallback;
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(`${label} 超出允许范围`);
  return result;
}

function boundedValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[Tabbit 结果嵌套过深]';
  if (typeof value === 'string') return value.length > MAX_OUTPUT_CHARS ? `${value.slice(0, MAX_OUTPUT_CHARS)}\n[结果已截断]` : value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => boundedValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 120)) output[key] = boundedValue(item, depth + 1);
    return output;
  }
  return value;
}

function cliArgs(input: TabbitBrowserArgs): { action: TabbitAction; args: string[]; stdin?: string; timeoutMs: number } {
  const action = String(input.action || '').trim() as TabbitAction;
  if (!ACTIONS.has(action)) throw new Error('Tabbit action 无效');
  const task = optionalToken(input.task, 'task');
  const requestId = optionalToken(input.requestId, 'requestId');
  const args: string[] = [action];
  if (task) args.push('--task', task);
  let stdin: string | undefined;
  let timeoutMs = integer(input.timeoutMs, 'timeoutMs', 1_000, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  if (action === 'diagnose') return { action, args, timeoutMs };
  if (action === 'tabs') {
    if (!task) throw new Error('tabs 需要 task');
    const state = optionalToken(input.state, 'state');
    if (state && !new Set(['available', 'owned', 'claimed']).has(state)) throw new Error('tabs state 无效');
    if (state) args.push('--state', state);
    args.push('--limit', String(integer(input.limit, 'limit', 1, 50, 50)));
    return { action, args, timeoutMs };
  }
  if (action === 'claim') {
    if (!task) throw new Error('claim 需要 task');
    const ids = Array.isArray(input.tabIds) ? input.tabIds : input.tabId === undefined ? [] : [input.tabId];
    if (!ids.length || ids.length > 20) throw new Error('claim 需要 1-20 个 tabId');
    for (const id of ids) args.push('--tab', String(integer(id, 'tabId', 1, 0x7fffffff, 0)));
    return { action, args, timeoutMs };
  }
  if (action === 'resume') {
    if (!task) throw new Error('resume 需要 task');
    args.push('--group', token(input.groupId, 'groupId', GROUP_ID));
    return { action, args, timeoutMs };
  }
  if (action === 'nodejs') {
    if (!task || !requestId) throw new Error('nodejs 需要 task 和 requestId');
    const code = String(input.code ?? '');
    if (!code.trim() || code.length > MAX_CODE_CHARS) throw new Error('nodejs code 为空或过长');
    args.push('--request-id', requestId);
    if (input.readOnly === true) args.push('--read-only');
    args.push('--timeout-ms', String(timeoutMs));
    stdin = code;
    return { action, args, stdin, timeoutMs: Math.min(MAX_TIMEOUT_MS + 10_000, timeoutMs + 10_000) };
  }
  if (action === 'resource') {
    if (!task) throw new Error('resource 需要 task');
    args.push('--resource', token(input.resource, 'resource'));
    args.push('--offset', String(integer(input.offset, 'offset', 0, Number.MAX_SAFE_INTEGER, 0)));
    args.push('--max-bytes', String(integer(input.maxBytes, 'maxBytes', 1, 65_536, 65_536)));
    return { action, args, timeoutMs };
  }
  if (action === 'receipt') {
    if (!task || !requestId) throw new Error('receipt 需要 task 和 requestId');
    args.push('--request-id', requestId);
    return { action, args, timeoutMs };
  }
  if (!task) throw new Error('finish 需要 task');
  if (input.discard === true) args.push('--discard');
  return { action, args, timeoutMs };
}

function parseResponse(stdout: string) {
  const text = stdout.trim();
  if (!text) return null;
  try { return boundedValue(JSON.parse(text)); } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return boundedValue(JSON.parse(text.slice(start, end + 1))); } catch {}
    }
    return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n[输出已截断]` : text;
  }
}

function runProcess(file: string, args: string[], stdin: string | undefined, timeoutMs: number, signal?: AbortSignal) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      callback();
    };
    const abort = () => {
      try { child.kill(); } catch {}
      finish(() => reject(signal?.reason || new Error('Tabbit 操作已取消')));
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(() => reject(new Error(`Tabbit 操作超时（${timeoutMs}ms）`)));
    }, timeoutMs);
    timer.unref?.();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout = (stdout + chunk).slice(-MAX_OUTPUT_CHARS * 2); });
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-8_000); });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('close', (code) => finish(() => resolve({ stdout, stderr, code })));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    if (stdin !== undefined) child.stdin.end(Buffer.from(stdin, 'utf8'));
    else child.stdin.end();
  });
}

export async function runTabbitBrowserAction(input: TabbitBrowserArgs, options: { signal?: AbortSignal } = {}): Promise<TabbitCliResult> {
  const prepared = cliArgs(input);
  const file = resolveTabbitCli();
  if (!file) return { ok: false, action: prepared.action, error: '未找到 Tabbit 原生 CLI，已保留 Playwright 兼容回退' };
  const result = await runProcess(file, prepared.args, prepared.stdin, prepared.timeoutMs, options.signal);
  const response = parseResponse(result.stdout);
  const responseStatus = response && typeof response === 'object' && !Array.isArray(response)
    ? String((response as Record<string, unknown>).status || '')
    : '';
  const ok = (result.code === 0 || ['queued', 'running'].includes(responseStatus))
    && (!responseStatus || ['succeeded', 'queued', 'running'].includes(responseStatus) || prepared.action !== 'nodejs');
  return {
    ok,
    action: prepared.action,
    ...(responseStatus ? { status: responseStatus } : {}),
    ...(response !== null ? { response } : {}),
    ...(ok ? {} : { error: String((response && typeof response === 'object' && !Array.isArray(response) && (response as Record<string, unknown>).error) || result.stderr || `Tabbit CLI 退出码 ${result.code ?? 'null'}`).slice(0, 2_000) }),
    exitCode: result.code,
  };
}
