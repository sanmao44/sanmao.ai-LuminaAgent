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
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

export function extractJimengAuthChallenge(output: string) {
  const normalized = output
    .replace(/\\\//g, '/')
    .replace(/\r?\n/g, ' ');
  const pick = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) return match[1].trim().replace(/[),.;]+$/, '');
    }
    return '';
  };
  const userCode = pick([/user[_ -]?code\s*[:=]\s*["']?([A-Z0-9-]+)/i, /验证码\s*[:：]\s*([A-Z0-9-]+)/i]);
  let verificationUri = pick([
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
    deviceCode: pick([/device[_ -]?code\s*[:=]\s*["']?(\S+)/i]),
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
