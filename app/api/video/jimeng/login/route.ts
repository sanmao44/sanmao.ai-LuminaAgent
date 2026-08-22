import { spawn } from 'node:child_process';
import { isAdminRequest } from '@/lib/auth';
import { getProviderWithKey } from '@/lib/store';
import { resolveJimengCliCommand } from '@/lib/jimeng-cli';

export const runtime = 'nodejs';

const OFFICIAL_CLI_URL = 'https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg';

function commandFor(provider: { jimengCliPath?: string }) {
  return resolveJimengCliCommand(provider.jimengCliPath);
}

function extractLoginChallenge(output: string) {
  const pick = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match?.[1]) return match[1].trim().replace(/[),.;]+$/, '');
    }
    return '';
  };
  const verificationUri = pick([
    /verification[_ -]?uri\s*[:=]\s*["']?([^\s"'<>}]+)/i,
    /verification\s+(?:url|link)\s*[:=]\s*["']?([^\s"'<>}]+)/i,
    /(https?:\/\/[^\s"'<>]+(?:login|authorize|verification)[^\s"'<>]*)/i,
  ]);
  const userCode = pick([/user[_ -]?code\s*[:=]\s*["']?([A-Z0-9-]+)/i, /验证码\s*[:：]\s*([A-Z0-9-]+)/i]);
  const deviceCode = pick([/device[_ -]?code\s*[:=]\s*["']?([^\s"'<>}]+)/i]);
  return { verificationUri, userCode, deviceCode };
}

function parseJsonLines(output: string) {
  const values: any[] = [];
  for (const line of output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    try { values.push(JSON.parse(line)); } catch { /* CLI often mixes human-readable lines with JSON. */ }
  }
  return values;
}

function statusFrom(output: string, parsed: any[]) {
  const text = output.toLowerCase();
  const data = parsed.find((item) => item && typeof item === 'object' && (item.status || item.state || item.gen_status));
  const value = String(data?.status || data?.state || data?.gen_status || '').toLowerCase();
  if (/(success|succeed|authorized|logged.?in|complete|done)/.test(`${value} ${text}`)) return 'authorized' as const;
  if (/(fail|error|invalid|denied|expired)/.test(`${value} ${text}`)) return 'failed' as const;
  return 'pending' as const;
}

async function runCli(command: string, args: string[], timeoutMs = 30_000) {
  return new Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: command.toLowerCase().endsWith('.cmd') });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: { code: number; stdout: string; stderr: string; timedOut: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      try { child.kill(); } catch { /* best effort */ }
      finish({ code: 0, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr, timedOut: false }));
  });
}

async function providerFromRequest(body: any) {
  const providerId = String(body.providerId || '').trim();
  if (!providerId) throw new Error('请先保存即梦 CLI 服务配置');
  const provider = await getProviderWithKey(providerId);
  if (!provider) throw new Error('即梦 CLI 服务配置不存在');
  if (provider.videoTransport !== 'jimeng-cli' && provider.platform !== 'jimeng-cli') throw new Error('当前服务商没有启用即梦 CLI');
  return provider;
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const body = await request.json();
    const action = String(body.action || 'start').trim();
    if (action === 'install') {
      return Response.json({ ok: true, officialUrl: OFFICIAL_CLI_URL, command: 'curl -fsSL https://jimeng.jianying.com/cli | bash' });
    }
    const provider = await providerFromRequest(body);
    const command = commandFor(provider);

    if (action === 'inspect') {
      try {
        const result = await runCli(command, ['--version'], 12_000);
        const output = `${result.stdout}\n${result.stderr}`.trim();
        if (result.code !== 0 || !output) return Response.json({ ok: false, installed: false, error: '未检测到即梦 CLI，请先按官方说明安装。', officialUrl: OFFICIAL_CLI_URL }, { status: 200 });
        return Response.json({ ok: true, installed: true, version: output.split(/\r?\n/).find(Boolean) || output, officialUrl: OFFICIAL_CLI_URL });
      } catch { return Response.json({ ok: false, installed: false, error: '未检测到即梦 CLI，请先按官方说明安装。', officialUrl: OFFICIAL_CLI_URL }, { status: 200 }); }
    }

    if (action === 'start') {
      const result = await runCli(command, ['login', '--headless'], 25_000);
      const output = `${result.stdout}\n${result.stderr}`.trim();
      const challenge = extractLoginChallenge(output);
      if (result.code !== 0 && !challenge.deviceCode) throw new Error(output || '即梦 CLI 登录初始化失败');
      if (!challenge.deviceCode) throw new Error('即梦 CLI 没有返回 device_code，请确认 CLI 版本并重试');
      return Response.json({ ok: true, status: 'pending', ...challenge, officialUrl: challenge.verificationUri || OFFICIAL_CLI_URL, message: '请打开登录链接，输入授权码完成即梦登录。' });
    }

    if (action === 'check') {
      const deviceCode = String(body.deviceCode || '').trim();
      if (!deviceCode) return Response.json({ error: '缺少 device_code。' }, { status: 400 });
      const result = await runCli(command, ['login', 'checklogin', `--device_code=${deviceCode}`, '--poll=30'], 45_000);
      const output = `${result.stdout}\n${result.stderr}`.trim();
      const parsed = parseJsonLines(output);
      const status = statusFrom(output, parsed);
      if (result.code !== 0 && status !== 'authorized') return Response.json({ ok: false, status: 'failed', error: output || '即梦授权检查失败' }, { status: 200 });
      return Response.json({ ok: status === 'authorized', status, message: status === 'authorized' ? '即梦 CLI 已登录，可以生成视频。' : '暂未完成授权，请完成网页登录后再次检查。' });
    }
    return Response.json({ error: '不支持的登录操作。' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '即梦 CLI 操作失败。' }, { status: 500 });
  }
}
