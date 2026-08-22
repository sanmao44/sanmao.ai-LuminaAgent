import { isAdminRequest } from '@/lib/auth';
import { extractJimengAuthChallenge, inspectJimengCli, resolveJimengCliCommand, runJimengCli, parseJimengJsonLines } from '@/lib/jimeng-cli';
import { addProvider, getProviderWithKey, getPublicState } from '@/lib/store';

export const runtime = 'nodejs';

const OFFICIAL_GUIDE_URL = 'https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg';
const INSTALL_COMMAND = 'curl -fsSL https://jimeng.jianying.com/cli | bash';

async function ensureProvider() {
  const state = await getPublicState();
  const existing = state.providers.find((provider) => provider.platform === 'jimeng-cli' || provider.videoTransport === 'jimeng-cli');
  if (existing) return existing;
  const id = await addProvider({
    name: '即梦 CLI',
    type: 'openai-compatible',
    platform: 'jimeng-cli',
    baseUrl: '',
    apiKey: '',
    videoTransport: 'jimeng-cli',
    modelLibraryEnabled: true,
  });
  return (await getPublicState()).providers.find((provider) => provider.id === id)!;
}

function statusFrom(output: string, parsed: any[]) {
  const text = output.toLowerCase();
  const data = parsed.find((item) => item && typeof item === 'object' && (item.status || item.state || item.gen_status));
  const value = String(data?.status || data?.state || data?.gen_status || '').toLowerCase();
  if (/(success|succeed|authorized|logged.?in|complete|done)/.test(`${value} ${text}`)) return 'authorized' as const;
  if (/(fail|error|invalid|denied|expired)/.test(`${value} ${text}`)) return 'failed' as const;
  return 'pending' as const;
}

async function accountAuthorized(command: string, installed: boolean) {
  if (!installed) return false;
  try {
    // Keep provider-page detection responsive. A logged-out CLI can wait on
    // network/session initialization; a short probe is enough to distinguish
    // an installed binary from a confirmed account.
    const result = await runJimengCli(command, ['user_credit'], 5_000);
    const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
    return result.code === 0 && !result.timedOut && !/(login required|not logged|unauthorized|未登录|登录后)/.test(output);
  } catch { return false; }
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || 'ensure').trim();
    if (action === 'install') return Response.json({ ok: true, officialUrl: OFFICIAL_GUIDE_URL, command: INSTALL_COMMAND });
    const state = await getPublicState();
    const existing = state.providers.find((item) => item.platform === 'jimeng-cli' || item.videoTransport === 'jimeng-cli');
    if (action === 'detect' && !existing) {
      const inspected = await inspectJimengCli({});
      const authorized = await accountAuthorized(inspected.command, inspected.installed);
      if (authorized) {
        const provider = await ensureProvider();
        const synced = await fetch(new URL(`/api/providers/${provider.id}/sync`, request.url), { method: 'POST', headers: request.headers });
        const syncedData = await synced.json().catch(() => ({}));
        return Response.json({ ok: true, providerId: provider.id, installed: inspected.installed, authorized: true, version: inspected.version, command: inspected.command, officialUrl: OFFICIAL_GUIDE_URL, state: syncedData.state || await getPublicState(), error: synced.ok ? '' : syncedData.error || '即梦模型同步失败' });
      }
      return Response.json({ ok: inspected.installed, providerId: '', installed: inspected.installed, authorized, version: inspected.version, command: inspected.command, officialUrl: OFFICIAL_GUIDE_URL, error: inspected.installed ? '' : `${inspected.loginHint}。安装命令：${INSTALL_COMMAND}` });
    }
    const provider = existing || await ensureProvider();
    if (action === 'ensure') return Response.json({ ok: true, provider, state: await getPublicState() });
    const saved = await getProviderWithKey(provider.id);
    if (!saved) throw new Error('即梦 CLI 服务配置不存在');
    const command = resolveJimengCliCommand(saved.jimengCliPath);
    if (action === 'detect') {
      const inspected = await inspectJimengCli(saved);
      return Response.json({ ok: inspected.installed, providerId: provider.id, installed: inspected.installed, authorized: await accountAuthorized(inspected.command, inspected.installed), version: inspected.version, command: inspected.command, officialUrl: OFFICIAL_GUIDE_URL, error: inspected.installed ? '' : `${inspected.loginHint}。安装命令：${INSTALL_COMMAND}` });
    }
    if (action === 'authorize' || action === 'switch-account') {
      const result = await runJimengCli(command, [action === 'switch-account' ? 'relogin' : 'login', '--headless'], 25_000);
      const output = `${result.stdout}\n${result.stderr}`.trim();
      const challenge = extractJimengAuthChallenge(output);
      if (result.code !== 0 && !challenge.deviceCode) throw new Error(output || '即梦授权初始化失败');
      if (!challenge.deviceCode) throw new Error('即梦 CLI 没有返回 device_code，请更新 CLI 后重试');
      return Response.json({ ok: true, status: 'pending', providerId: provider.id, ...challenge, officialUrl: OFFICIAL_GUIDE_URL, message: action === 'switch-account' ? '授权页面已自动打开，请完成账号切换。' : '授权页面已自动打开，请完成即梦授权。' });
    }
    if (action === 'poll') {
      const deviceCode = String(body.deviceCode || '').trim();
      if (!deviceCode) return Response.json({ error: '缺少 device_code。' }, { status: 400 });
      const result = await runJimengCli(command, ['login', 'checklogin', `--device_code=${deviceCode}`, '--poll=30'], 45_000);
      const output = `${result.stdout}\n${result.stderr}`.trim();
      const status = statusFrom(output, parseJimengJsonLines(output));
      if (result.code !== 0 && status !== 'authorized') return Response.json({ ok: false, status: 'failed', providerId: provider.id, error: output || '即梦授权检查失败' });
      return Response.json({ ok: status === 'authorized', status, providerId: provider.id, message: status === 'authorized' ? '即梦已连接，图片和视频模型正在同步。' : '暂未完成授权，请继续完成网页授权。' });
    }
    return Response.json({ error: '不支持的即梦操作。' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '即梦 CLI 操作失败。' }, { status: 500 });
  }
}
