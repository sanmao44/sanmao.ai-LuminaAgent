import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import type { ModelCapability } from './types';

export type JimengCliResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

export type JimengCanvasModelMode = {
  name: string;
  scenario?: string;
  schema?: Record<string, unknown>;
};

export type JimengCanvasModel = {
  id: string;
  model: string;
  name: string;
  aliases: string[];
  modes: JimengCanvasModelMode[];
  capabilities: ModelCapability[];
  /** The CLI schema is intentionally retained for callers that need exact limits. */
  schema: Record<string, unknown>;
};

export type JimengAccount = {
  totalCredit: number | null;
  userId: string;
  userName: string;
  vipLevel: string;
};

function candidates(explicit?: string) {
  const values = [explicit, process.env.JIMENG_CLI_PATH];
  if (process.platform === 'win32') {
    const profile = process.env.USERPROFILE || os.homedir();
    values.push(
      path.join(profile, 'bin', 'dreamina.exe'),
      path.join(profile, 'bin', 'dreamina.cmd'),
      path.join(profile, '.local', 'bin', 'dreamina.exe'),
      path.join(profile, '.local', 'bin', 'dreamina.cmd'),
      'dreamina.exe',
      'dreamina.cmd',
      'dreamina',
    );
  } else {
    values.push(path.join(os.homedir(), '.local', 'bin', 'dreamina'), 'dreamina');
  }
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function canvasCandidates(explicit?: string) {
  const values: string[] = [];
  const add = (value: string | undefined) => {
    const normalized = String(value || '').trim();
    if (normalized && !values.includes(normalized)) values.push(normalized);
  };
  const configured = String(explicit || process.env.JIMENG_CANVAS_CLI_PATH || '').trim();
  if (configured) {
    if (/dreamina(?:\.exe|\.cmd)?$/i.test(configured)) {
      add(path.join(path.dirname(configured), process.platform === 'win32' ? 'dreamina-canvas.exe' : 'dreamina-canvas'));
    }
    add(configured);
  }
  if (process.platform === 'win32') {
    const profile = process.env.USERPROFILE || os.homedir();
    add(path.join(profile, 'bin', 'dreamina-canvas.exe'));
    add(path.join(profile, 'bin', 'dreamina-canvas.cmd'));
    add(path.join(profile, '.local', 'bin', 'dreamina-canvas.exe'));
    add(path.join(profile, '.local', 'bin', 'dreamina-canvas.cmd'));
    add('dreamina-canvas.exe');
    add('dreamina-canvas.cmd');
    add('dreamina-canvas');
  } else {
    add(path.join(os.homedir(), '.local', 'bin', 'dreamina-canvas'));
    add(path.join(os.homedir(), 'bin', 'dreamina-canvas'));
    add('dreamina-canvas');
  }
  return values;
}

export function resolveJimengCliCommand(explicit?: string) {
  const list = candidates(explicit);
  return list.find((value) => path.isAbsolute(value) ? existsSync(value) : value === explicit || value === process.env.JIMENG_CLI_PATH || /^(?:dreamina)(?:\.exe|\.cmd)?$/i.test(value)) || list[0] || (process.platform === 'win32' ? 'dreamina.exe' : 'dreamina');
}

/** Resolve the separate official canvas CLI without replacing old dreamina discovery. */
export function resolveJimengCanvasCliCommand(explicit?: string) {
  const list = canvasCandidates(explicit);
  return list.find((value) => path.isAbsolute(value)
    ? existsSync(value)
    : value === explicit
      || value === process.env.JIMENG_CANVAS_CLI_PATH
      || /^(?:dreamina-canvas)(?:\.exe|\.cmd)?$/i.test(value))
    || list[0]
    || (process.platform === 'win32' ? 'dreamina-canvas.exe' : 'dreamina-canvas');
}

export function jimengCliShell(command: string) {
  return process.platform === 'win32' && command.toLowerCase().endsWith('.cmd');
}

export function isJimengCanvasCommand(command: string | undefined) {
  return /(?:^|[\\/])dreamina-canvas(?:\.exe|\.cmd)?$/i.test(String(command || ''))
    || /^dreamina-canvas(?:\.exe|\.cmd)?$/i.test(String(command || ''));
}

export async function runJimengCli(commandOrPath: string | undefined, args: string[], timeoutMs = 30_000, signal?: AbortSignal): Promise<JimengCliResult> {
  const command = resolveJimengCliCommand(commandOrPath);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: jimengCliShell(command) });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: JimengCliResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => {
      try { child.kill(); } catch {}
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        reject(new Error('即梦 CLI 操作已取消'));
      }
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ code: 0, stdout, stderr, timedOut: true });
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr, timedOut: false }));
  });
}

/** Execute the official canvas CLI using its own command name and search paths. */
export async function runJimengCanvasCli(commandOrPath: string | undefined, args: string[], timeoutMs = 30_000, signal?: AbortSignal): Promise<JimengCliResult> {
  const command = resolveJimengCanvasCliCommand(commandOrPath);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: jimengCliShell(command) });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: JimengCliResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => {
      try { child.kill(); } catch {}
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        reject(new Error('即梦画布 CLI 操作已取消'));
      }
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ code: 0, stdout, stderr, timedOut: true });
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr, timedOut: false }));
  });
}

export function parseJimengJsonLines(output: string) {
  const trimmed = output.trim();
  if (trimmed) {
    try { return [JSON.parse(trimmed)]; } catch {}
  }
  const values = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(output.slice(start, end + 1));
      if (!values.includes(parsed)) values.push(parsed);
    } catch {}
  }
  return values;
}

export type JimengCanvasModelType = 'image' | 'video' | 'audio';
type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function firstText(record: JsonRecord, names: string[]) {
  for (const name of names) {
    const value = record[name];
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return '';
}

function modelText(value: unknown, depth = 0): string {
  if (depth > 8 || value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => modelText(item, depth + 1)).join(' ');
  const record = asRecord(value);
  return record ? Object.entries(record).map(([key, item]) => `${key} ${modelText(item, depth + 1)}`).join(' ') : '';
}

function canvasModelAliases(record: JsonRecord, id: string) {
  const values = [record.alias, record.aliases, record.model_aliases, record.modelAliases];
  return values.flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => String(value ?? '').trim())
    .filter((value) => value && value !== id);
}

function canvasModelModes(record: JsonRecord): JimengCanvasModelMode[] {
  const source = record.modes ?? record.supported_modes ?? record.supportedModes ?? record.mode;
  const modes: JimengCanvasModelMode[] = [];
  const add = (name: unknown, schema?: Record<string, unknown>, scenario?: unknown) => {
    const normalized = String(name ?? '').trim();
    if (!normalized || modes.some((item) => item.name === normalized)) return;
    modes.push({ name: normalized, ...(scenario ? { scenario: String(scenario) } : {}), ...(schema ? { schema } : {}) });
  };
  if (Array.isArray(source)) {
    source.forEach((value) => {
      const item = asRecord(value);
      if (item) add(firstText(item, ['name', 'mode', 'scenario', 'id', 'type']), item, item.scenario);
      else add(value);
    });
  } else if (asRecord(source)) {
    Object.entries(source as JsonRecord).forEach(([name, value]) => add(name, asRecord(value), asRecord(value)?.scenario));
  } else if (source !== undefined) add(source);
  return modes;
}

function collectCanvasModelRecords(value: unknown, output: JsonRecord[], seen: Set<JsonRecord>, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectCanvasModelRecords(item, output, seen, depth + 1));
    return;
  }
  const record = asRecord(value);
  if (!record || seen.has(record)) return;
  seen.add(record);
  const id = firstText(record, ['model', 'model_id', 'modelId', 'model_key', 'modelKey', 'slug', 'id']);
  if (id && !/^(image|video|audio|model|models|list|data|result)$/i.test(id)) output.push(record);
  Object.values(record).forEach((item) => collectCanvasModelRecords(item, output, seen, depth + 1));
}

function canvasModelCapabilities(record: JsonRecord, type: JimengCanvasModelType): ModelCapability[] {
  const text = modelText(record).toLowerCase();
  if (type === 'video') {
    const capabilities = ['video-generate'];
    if (/first[_ -]?last[_ -]?frame|firstlastframe|keyframe/.test(text)) capabilities.push('video-first-frame');
    if (/\bm2v\b|multimodal|reference|ref2video/.test(text)) capabilities.push('video-reference');
    if (/audio|soundtrack|music/.test(text)) capabilities.push('video-audio');
    return capabilities as ModelCapability[];
  }
  if (type === 'image') {
    const capabilities = ['generate'];
    if (/\bi2i\b|image2image|edit|reference|ref/.test(text)) capabilities.push('edit', 'reference');
    if (/upscale|super.?resolution/.test(text)) capabilities.push('upscale');
    return capabilities as ModelCapability[];
  }
  return /tts|speech|voice|audio/.test(text) ? ['speech'] : ['generate'];
}

/**
 * Normalize the official `dreamina-canvas model list --format json` response.
 * The schema intentionally stays on each model so callers can use exact
 * duration, ratio and resolution values instead of guessing from the name.
 */
export function parseJimengCanvasModelList(output: string, type: JimengCanvasModelType): JimengCanvasModel[] {
  const records: JsonRecord[] = [];
  const seen = new Set<JsonRecord>();
  parseJimengJsonLines(output).forEach((value) => collectCanvasModelRecords(value, records, seen));
  const normalized = records.map((record) => {
    const id = firstText(record, ['model', 'model_id', 'modelId', 'model_key', 'modelKey', 'slug', 'id']);
    const name = firstText(record, ['display_name', 'displayName', 'name', 'title', 'model_name', 'modelName']) || id;
    return id ? {
      id,
      model: id,
      name,
      aliases: canvasModelAliases(record, id),
      modes: canvasModelModes(record),
      capabilities: canvasModelCapabilities(record, type),
      schema: record,
    } : null;
  }).filter((item): item is JimengCanvasModel => Boolean(item));
  return [...new Map(normalized.map((item) => [item.id, item])).values()];
}

export async function discoverJimengCanvasModels(commandOrPath: string | undefined, typeOrSignal: JimengCanvasModelType | AbortSignal = 'video', maybeSignal?: AbortSignal) {
  const type = typeof typeOrSignal === 'string' ? typeOrSignal : 'video';
  const signal = typeof typeOrSignal === 'string' ? maybeSignal : typeOrSignal;
  const result = await runJimengCanvasCli(commandOrPath, ['model', 'list', '--type', type, '--format', 'json', '--non-interactive'], 30_000, signal);
  const output = `${result.stdout}\n${result.stderr}`;
  const models = parseJimengCanvasModelList(output, type);
  if (result.timedOut) throw new Error('即梦画布 CLI 模型列表查询超时');
  if (result.code !== 0) throw new Error(jimengErrorMessage(output, '即梦画布 CLI 模型列表查询失败'));
  if (!models.length) throw new Error(`即梦画布 CLI 返回的 ${type} 模型列表为空`);
  return models;
}

function normalizedFieldName(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function findJsonField(values: any[], names: string[]) {
  const wanted = new Set(names.map(normalizedFieldName));
  const visit = (value: any): string => {
    if (!value || typeof value !== 'object') return '';
    for (const [key, item] of Object.entries(value)) {
      if (wanted.has(normalizedFieldName(key)) && item !== undefined && item !== null) {
        const text = String(item).trim();
        if (text) return text;
      }
      const nested = visit(item);
      if (nested) return nested;
    }
    return '';
  };
  for (const value of values) {
    const found = visit(value);
    if (found) return found;
  }
  return '';
}

function findJsonValue(values: any[], names: string[]) {
  const wanted = new Set(names.map(normalizedFieldName));
  const visit = (value: any): unknown => {
    if (!value || typeof value !== 'object') return undefined;
    for (const [key, item] of Object.entries(value)) {
      if (wanted.has(normalizedFieldName(key)) && item !== undefined && item !== null) return item;
      const nested = visit(item);
      if (nested !== undefined) return nested;
    }
    return undefined;
  };
  for (const value of values) {
    const found = visit(value);
    if (found !== undefined) return found;
  }
  return undefined;
}

function accountNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse the documented `dreamina user_credit` response, including nested JSON. */
export function parseJimengAccountOutput(output: string): JimengAccount | null {
  const parsed = parseJimengJsonLines(output);
  const creditValue = findJsonValue(parsed, ['total_credit', 'totalCredit', 'credit', 'credits']);
  const userIdValue = findJsonValue(parsed, ['user_id', 'userId']);
  const userNameValue = findJsonValue(parsed, ['user_name', 'userName', 'name']);
  const vipValue = findJsonValue(parsed, ['vip_level', 'vipLevel', 'vip']);
  const totalCredit = accountNumber(creditValue);
  const userId = String(userIdValue ?? '').trim();
  const userName = String(userNameValue ?? '').trim();
  const vipLevel = String(vipValue ?? '').trim();
  // A zero balance is valid. Do not use truthiness for the credit check.
  if (totalCredit === null && !userId && !userName && !vipLevel) return null;
  return { totalCredit, userId, userName, vipLevel };
}

export function jimengErrorCode(value: unknown) {
  const text = String(value ?? '');
  if (/AigcComplianceConfirmationRequired/i.test(text)) return 'JIMENG_FIRST_USE_REQUIRED';
  if (/(insufficient|not enough|credit|积分|点数).*(balance|credit|enough|不足)|余额不足|积分不足/i.test(text)) return 'JIMENG_CREDIT_INSUFFICIENT';
  if (/(login required|not logged[ -]?in|unauthorized|session expired|未登录|登录失效|授权失效)/i.test(text)) return 'JIMENG_AUTH_REQUIRED';
  if (/timed? out|timeout|超时/i.test(text)) return 'JIMENG_TIMEOUT';
  return undefined;
}

export function jimengErrorMessage(value: unknown, fallback: string) {
  const text = String(value ?? '').trim();
  if (/AigcComplianceConfirmationRequired/i.test(text)) return '即梦要求先在即梦网页端使用该模型完成一次生成，请先完成首次生成后再回来重试。';
  if (jimengErrorCode(text) === 'JIMENG_CREDIT_INSUFFICIENT') return '即梦账户积分不足，请到即梦账户充值或更换账户后重试。';
  if (jimengErrorCode(text) === 'JIMENG_AUTH_REQUIRED') return '即梦登录已失效，请到设置中重新授权即梦 CLI。';
  if (jimengErrorCode(text) === 'JIMENG_TIMEOUT') return '即梦任务查询超时，任务可能仍在生成，请稍后刷新任务状态。';
  return text.slice(0, 900) || fallback;
}

async function queryJimengCanvasAccount(commandOrPath: string | undefined, accountCheckedAt: string) {
  try {
    const result = await runJimengCanvasCli(commandOrPath, ['auth', 'account', '--format', 'json', '--non-interactive'], 8_000);
    const output = `${result.stdout}\n${result.stderr}`;
    const account = result.code === 0 ? parseJimengAccountOutput(output) : null;
    const requiresAuth = /loggedIn\s*[:=]\s*false|authentication\s+is\s+required|login\s+required/i.test(output);
    if (result.code === 0 && !requiresAuth) return { authorized: true, account, accountCheckedAt, accountError: '' };
    return { authorized: false, account: null, accountCheckedAt, accountError: requiresAuth ? 'Dreamina Canvas CLI is not logged in.' : jimengErrorMessage(output, 'Unable to read Dreamina Canvas account.') };
  } catch (error) {
    return { authorized: false, account: null, accountCheckedAt, accountError: error instanceof Error ? error.message : 'Unable to read Dreamina Canvas account.' };
  }
}

export async function queryJimengAccount(commandOrPath: string | undefined, installed = true) {
  const accountCheckedAt = new Date().toISOString();
  if (!installed) return { authorized: false, account: null, accountCheckedAt, accountError: '未检测到即梦 CLI，暂时无法查询账户积分。' };
  if (isJimengCanvasCommand(commandOrPath)) return queryJimengCanvasAccount(commandOrPath, accountCheckedAt);
  try {
    const result = await runJimengCli(commandOrPath, ['user_credit'], 5_000);
    const output = `${result.stdout}\n${result.stderr}`;
    const account = result.code === 0 ? parseJimengAccountOutput(output) : null;
    if (account && isJimengAuthenticatedOutput(output, parseJimengJsonLines(output))) return { authorized: true, account, accountCheckedAt, accountError: '' };
    const accountError = result.timedOut
      ? '查询即梦账户积分超时，请稍后点击刷新重试。'
      : /login\s+required|not\s+(?:logged[ -]?in|authenticated)|unauthorized|未登录|登录失效|授权失效/i.test(output)
        ? '即梦账号尚未授权或登录已失效，请重新授权。'
        : jimengErrorMessage(output, '暂时无法读取即梦账户信息，请稍后刷新重试。');
    return { authorized: false, account: null, accountCheckedAt, accountError };
  } catch (error) {
    return { authorized: false, account: null, accountCheckedAt, accountError: error instanceof Error ? error.message : '读取即梦账户信息失败，请稍后重试。' };
  }
}

function cleanAuthValue(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, '').replace(/[),.;]+$/, '');
}

/** Returns true when Dreamina has confirmed an existing OAuth session. */
export function isJimengAuthenticatedOutput(output: string, parsed = parseJimengJsonLines(output)) {
  const lower = output.toLowerCase();
  const loggedIn = findJsonValue(parsed, ['loggedIn', 'isLoggedIn', 'authenticated', 'authorized']);
  if (loggedIn === true || String(loggedIn).toLowerCase() === 'true') return true;
  if (loggedIn === false || String(loggedIn).toLowerCase() === 'false') return false;
  if (/login\s+required|not\s+(?:logged[ -]?in|authenticated)|unauthorized|session\s+(?:expired|invalid)|未登录|登录后/.test(lower)) return false;
  if (/already\s+(?:logged[ -]?in|authenticated)|logged[ -]?in|oauth\s+session|登录成功|登录完成|授权成功|已登录|登录态有效|\u5df2\u590d\u7528\u5f53\u524d\u672c\u5730\s*oauth\s*\u767b\u5f55\u6001/.test(lower)) return true;
  const account = parseJimengAccountOutput(output);
  return Boolean(account?.userId && (account.totalCredit !== null || account.vipLevel || findJsonField(parsed, ['account', 'email'])));
}

/** checklogin uses a non-zero exit code when its polling window ends without
 * authorization. That is still a recoverable pending state, not a failure. */
export function isJimengAuthorizationPendingOutput(output: string) {
  const lower = output.toLowerCase();
  return /等待登录超时|登录尚未完成|请稍后重试|authorization\s+(?:is\s+)?pending|login\s+(?:is\s+)?pending|timed?\s*out\s*while\s*waiting\s*for\s*(?:login|authorization)/.test(lower);
}

export function extractJimengAuthChallenge(output: string) {
  const parsed = parseJimengJsonLines(output);
  const jsonUserCode = cleanAuthValue(findJsonField(parsed, ['user_code', 'userCode']));
  const jsonVerificationUri = cleanAuthValue(findJsonField(parsed, ['verification_uri', 'verificationUri', 'verification_url', 'verificationUrl']));
  const jsonDeviceCode = cleanAuthValue(findJsonField(parsed, ['device_code', 'deviceCode']));
  const normalized = output
    .replace(/\\\//g, '/')
    .replace(/\r?\n/g, ' ');
  const pick = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) return cleanAuthValue(match[1]);
    }
    return '';
  };
  const userCode = jsonUserCode || pick([/user[_ -]?code\s*[:=]\s*["']?([^\s"',}]+)/i, /验证码\s*[:：]\s*([A-Z0-9-]+)/i]);
  let verificationUri = jsonVerificationUri || pick([
    /verification[_ -]?uri\s*[:=]\s*["']?(https?:\/\/[^\s"'<>}]+)/i,
    /verification\s+(?:url|link)\s*[:=]\s*["']?(https?:\/\/[^\s"'<>}]+)/i,
    /(https?:\/\/[^\s"'<>]+(?:login|authorize|verification|cli-auth)[^\s"'<>]*)/i,
  ]);
  // Never use the installer page as an OAuth destination. Older CLI builds
  // occasionally print only user_code; the official device-flow URL can be
  // reconstructed safely from that code.
  if (/^https?:\/\/jimeng\.jianying\.com\/cli\/?$/i.test(verificationUri)) verificationUri = '';
  if (!verificationUri && userCode) {
    const scanUrl = `https://jimeng.jianying.com/passport/open/scan_user_code/?user_code=${encodeURIComponent(userCode)}`;
    verificationUri = `https://jimeng.jianying.com/ai-tool/cli-auth?verification_uri=${encodeURIComponent(scanUrl)}`;
  }
  return {
    verificationUri,
    userCode,
    deviceCode: jsonDeviceCode || pick([/device[_ -]?code\s*[:=]\s*["']?([^\s"',}]+)/i]),
  };
}

export async function inspectJimengCli(provider: { jimengCliPath?: string }) {
  const canvasCommand = resolveJimengCanvasCliCommand(provider.jimengCliPath);
  try {
    const result = await runJimengCanvasCli(canvasCommand, ['version', '--format', 'json', '--non-interactive'], 12_000);
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (result.code === 0 && output) {
      let version = output.split(/\r?\n/).find(Boolean) || '';
      try { version = String(findJsonValue(parseJimengJsonLines(output), ['version']) || version); } catch {}
      return { installed: true, version, command: canvasCommand, canvas: true, loginHint: '请完成一次即梦网页授权后即可使用图片和视频' };
    }
  } catch {}
  const command = resolveJimengCliCommand(provider.jimengCliPath);
  try {
    const result = await runJimengCli(command, ['--version'], 12_000);
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (result.code !== 0 || !output) return { installed: false, version: '', command, canvas: false, loginHint: '未检测到即梦 CLI，请按官方安装说明安装后重试' };
    let version = output.split(/\r?\n/).find(Boolean) || '';
    try { version = String(JSON.parse(output).version || version); } catch {}
    return { installed: true, version, command, canvas: false, loginHint: '请完成一次即梦网页授权后即可生成图片和视频' };
  } catch {
    return { installed: false, version: '', command, canvas: false, loginHint: '未检测到即梦 CLI，请按官方安装说明安装后重试' };
  }
}
