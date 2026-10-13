import { getPublicState } from '@/lib/store';
import { ensureImageStorageDirectory } from '@/lib/image-storage';
import { openLocalFolder } from '@/lib/mcp/open-folder';
import { isTrustedAppRequest } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const state = await getPublicState();
    const target = await ensureImageStorageDirectory(state.settings.imageStoragePath);
    await openLocalFolder(target);
    return Response.json({ ok: true, path: target, message: '已向服务器电脑发出打开目录请求。' });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '打开目录失败' }, { status: 400 });
  }
}
