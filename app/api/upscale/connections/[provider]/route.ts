import { isAdminRequest } from '@/lib/auth';
import { getPublicState, removeUpscaleConnection } from '@/lib/store';
import type { UpscaleProviderId } from '@/lib/types';

export const runtime = 'nodejs';

function validProvider(value: string): value is UpscaleProviderId { return value === 'tencent-ci' || value === 'aliyun-viapi'; }

export async function DELETE(request: Request, context: { params: Promise<{ provider: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const provider = (await context.params).provider;
  if (!validProvider(provider)) return Response.json({ error: '不支持的高清服务商。' }, { status: 400 });
  await removeUpscaleConnection(provider);
  return Response.json({ ok: true, state: await getPublicState() }, { headers: { 'Cache-Control': 'no-store' } });
}
