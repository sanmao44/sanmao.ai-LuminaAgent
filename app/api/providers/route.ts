import { isAdminRequest } from '@/lib/auth';
import { getProviderPreset, resolveProviderConfiguration } from '@/lib/provider-presets';
import { addProvider, getPublicState } from '@/lib/store';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const state = await getPublicState();
  return Response.json({ providers: state.providers });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const body = await request.json();
    const apiKey = String(body.apiKey || '').trim();
    const configuration = resolveProviderConfiguration(body);
    const name = String(body.name || '').trim() || getProviderPreset(configuration.platform).short;
    if (!apiKey) return Response.json({ error: '访问密钥不能为空。' }, { status: 400 });
    if (!configuration.baseUrl) return Response.json({ error: '请填写服务商提供的 API 地址。' }, { status: 400 });
    const id = await addProvider({ name, apiKey, ...configuration });
    return Response.json({ ok: true, id, state: await getPublicState() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '添加服务商失败。' }, { status: 500 });
  }
}
