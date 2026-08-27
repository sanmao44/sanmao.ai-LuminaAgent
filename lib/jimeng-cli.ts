import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export type JimengCliResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

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

function cleanAuthValue(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, '').replace(/[),.;]+$/, '');
}

/** Returns true when Dreamina has confirmed an existing OAuth session. */
export function isJimengAuthenticatedOutput(output: string, parsed = parseJimengJsonLines(output)) {
  const lower = output.toLowerCase();
  if (/login\s+required|not\s+(?:logged[ -]?in|authenticated)|unauthorized|session\s+(?:expired|invalid)|未登录|登录后/.test(lower)) return false;
  if (/already\s+(?:logged[ -]?in|authenticated)|logged[ -]?in|oauth\s+session|登录成功|登录完成|授权成功|已登录|登录态有效|\u5df2\u590d\u7528\u5f53\u524d\u672c\u5730\s*oauth\s*\u767b\u5f55\u6001/.test(lower)) return true;
  return Boolean(
    findJsonField(parsed, ['user_id', 'userId']) &&
    (findJsonField(parsed, ['total_credit', 'totalCredit', 'vip_level', 'vipLevel', 'credit']) || findJsonField(parsed, ['account', 'email'])),
  );
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
