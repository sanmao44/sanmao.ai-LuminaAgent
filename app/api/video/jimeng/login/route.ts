import { isAdminRequest } from '@/lib/auth';
import { getProviderWithKey } from '@/lib/store';
import { extractJimengAuthChallenge, inspectJimengCli, isJimengAuthenticatedOutput, isJimengAuthorizationPendingOutput, parseJimengJsonLines, queryJimengAccount, resolveJimengCliCommand, runJimengCli } from '@/lib/jimeng-cli';
import { beginRuntimeRequest, RuntimeDrainingError } from '@/lib/runtime-operation';

export const runtime = 'nodejs';

const OFFICIAL_CLI_URL = 'https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg';
const INSTALL_COMMAND = process.platform === 'win32'
  ? 'powershell -NoProfile -ExecutionPolicy Bypass -File ".\\scripts\\install-jimeng.ps1"'
  : 'bash "./scripts/install-jimeng.sh"';

function commandFor(provider: { jimengCliPath?: string }) {
  return resolveJimengCliCommand(provider.jimengCliPath);
}

function statusFrom(output: string, parsed: any[]) {
  const text = output.toLowerCase();
  const data = parsed.find((item) => item && typeof item === 'object' && (item.status || item.state || item.gen_status));
  const value = String(data?.status || data?.state || data?.gen_status || '').toLowerCase();
  if (/(success|succeed|authorized|logged.?in|complete|done)/.test(`${value} ${text}`)) return 'authorized' as const;
  if (/(fail|error|invalid|denied|expired)/.test(`${value} ${text}`)) return 'failed' as const;
  return 'pending' as const;
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
  let releaseRuntimeRequest = async () => {};
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('jimeng-login');
    const body = await request.json();
    const action = String(body.action || 'start').trim();
    if (action === 'install') {
      return Response.json({ ok: true, officialUrl: OFFICIAL_CLI_URL, command: INSTALL_COMMAND });
    }
    const provider = await providerFromRequest(body);
    const command = commandFor(provider);

    if (action === 'account' || action === 'refresh-account') {
      const inspected = await inspectJimengCli(provider);
      return Response.json({ ok: inspected.installed, installed: inspected.installed, version: inspected.version, officialUrl: OFFICIAL_CLI_URL, ...await queryJimengAccount(inspected.command, inspected.installed) });
    }

    if (action === 'inspect') {
      try {
        const result = await runJimengCli(command, ['--version'], 12_000);
        const output = `${result.stdout}\n${result.stderr}`.trim();
        if (result.code !== 0 || !output) return Response.json({ ok: false, installed: false, error: '未检测到即梦 CLI，请先按官方说明安装。', officialUrl: OFFICIAL_CLI_URL }, { status: 200 });
        return Response.json({ ok: true, installed: true, version: output.split(/\r?\n/).find(Boolean) || output, officialUrl: OFFICIAL_CLI_URL });
      } catch { return Response.json({ ok: false, installed: false, error: '未检测到即梦 CLI，请先按官方说明安装。', officialUrl: OFFICIAL_CLI_URL }, { status: 200 }); }
    }

    if (action === 'start') {
      const result = await runJimengCli(command, ['login', '--headless'], 25_000);
      const output = `${result.stdout}\n${result.stderr}`.trim();
      const challenge = extractJimengAuthChallenge(output);
      if (result.code === 0 && isJimengAuthenticatedOutput(output)) {
        return Response.json({ ok: true, status: 'authorized', officialUrl: OFFICIAL_CLI_URL, message: '即梦已有有效登录，可以直接生成视频。', ...await queryJimengAccount(command) });
      }
      if (result.code !== 0 && !challenge.deviceCode) throw new Error(output || '即梦 CLI 登录初始化失败');
      if (!challenge.deviceCode) throw new Error('即梦 CLI 没有返回 device_code，请确认 CLI 版本并重试');
      return Response.json({ ok: true, status: 'pending', ...challenge, officialUrl: challenge.verificationUri || OFFICIAL_CLI_URL, message: '请打开登录链接，输入授权码完成即梦登录。' });
    }

    if (action === 'check') {
      const deviceCode = String(body.deviceCode || '').trim();
      if (!deviceCode) return Response.json({ error: '缺少 device_code。' }, { status: 400 });
      const result = await runJimengCli(command, ['login', 'checklogin', `--device_code=${deviceCode}`, '--poll=30'], 45_000);
      const output = `${result.stdout}\n${result.stderr}`.trim();
      const parsed = parseJimengJsonLines(output);
      const status: string = isJimengAuthenticatedOutput(output, parsed) ? 'authorized' : statusFrom(output, parsed);
      const pending = isJimengAuthorizationPendingOutput(output);
      if (status === 'authorized') return Response.json({ ok: true, status: 'authorized', message: '即梦 CLI 已登录，可以生成视频。', ...await queryJimengAccount(command) });
      if (result.code !== 0 && !pending) return Response.json({ ok: false, status: 'failed', error: output || '即梦授权检查失败' }, { status: 200 });
      return Response.json({ ok: false, status: 'pending', message: '尚未检测到授权，完成网页登录后会继续检查。' });
    }
    return Response.json({ error: '不支持的登录操作。' }, { status: 400 });
  } catch (error) {
    if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message, retryable: true }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : '即梦 CLI 操作失败。' }, { status: 500 });
  } finally {
    await releaseRuntimeRequest();
  }
}
