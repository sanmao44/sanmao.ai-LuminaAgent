import { spawn } from 'node:child_process';
import { getPublicState } from '@/lib/store';
import { getDefaultStoragePath } from '@/lib/image-storage';
import { isTrustedAppRequest } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const state = await getPublicState();
    const target = state.settings.imageStoragePath?.trim() || getDefaultStoragePath();
    if (process.platform === 'win32') spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
    return Response.json({ ok: true, path: target });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '打开目录失败' }, { status: 400 });
  }
}
