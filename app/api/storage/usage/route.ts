import { isTrustedAppRequest } from '@/lib/auth';
import { purgeExpiredImageTrash } from '@/lib/generation-log';
import { getPublicState } from '@/lib/store';
import { getStorageUsage } from '@/lib/storage-maintenance';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    await purgeExpiredImageTrash();
    const state = await getPublicState();
    return Response.json({ usage: await getStorageUsage(state.settings.imageStoragePath || '') }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '读取存储统计失败' }, { status: 500 });
  }
}
