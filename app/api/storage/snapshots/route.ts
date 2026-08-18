import { isAdminRequest } from '@/lib/auth';
import { createLocalSnapshot, ensureLocalSnapshot, listLocalSnapshots, restoreLocalSnapshot } from '@/lib/local-snapshots';
import { getPublicState } from '@/lib/store';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    await ensureLocalSnapshot();
    return Response.json({ snapshots: await listLocalSnapshots() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '读取自动快照失败' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const snapshot = await createLocalSnapshot('manual');
    return Response.json({ ok: true, snapshot, snapshots: await listLocalSnapshots() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '创建自动快照失败' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const body = await request.json();
    const name = String(body?.name || '');
    const snapshot = (await listLocalSnapshots()).find((item) => item.name === name);
    if (!snapshot) throw new Error('指定快照不存在');
    const state = await getPublicState();
    await createLocalSnapshot('before-snapshot-restore');
    const result = await restoreLocalSnapshot(snapshot.path, state.settings.imageStoragePath || '');
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '恢复自动快照失败' }, { status: 400 });
  }
}

