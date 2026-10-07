import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export type JimengCliResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

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

export function resolveJimengCliCommand(explicit?: string) {
  const list = candidates(explicit);
  return list.find((value) => path.isAbsolute(value) ? existsSync(value) : value === explicit || value === process.env.JIMENG_CLI_PATH || /^(?:dreamina)(?:\.exe|\.cmd)?$/i.test(value)) || list[0] || (process.platform === 'win32' ? 'dreamina.exe' : 'dreamina');
}

export function jimengCliShell(command: string) {
  return process.platform === 'win32' && command.toLowerCase().endsWith('.cmd');
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

export async function queryJimengAccount(commandOrPath: string | undefined, installed = true) {
  const accountCheckedAt = new Date().toISOString();
  if (!installed) return { authorized: false, account: null, accountCheckedAt, accountError: '未检测到即梦 CLI，暂时无法查询账户积分。' };
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
  const command = resolveJimengCliCommand(provider.jimengCliPath);
  try {
    const result = await runJimengCli(command, ['--version'], 12_000);
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (result.code !== 0 || !output) return { installed: false, version: '', command, loginHint: '未检测到即梦 CLI，请按官方安装说明安装后重试' };
    let version = output.split(/\r?\n/).find(Boolean) || '';
    try { version = String(JSON.parse(output).version || version); } catch {}
    return { installed: true, version, command, loginHint: '请完成一次即梦网页授权后即可生成图片和视频' };
  } catch {
    return { installed: false, version: '', command, loginHint: '未检测到即梦 CLI，请按官方安装说明安装后重试' };
  }
}
