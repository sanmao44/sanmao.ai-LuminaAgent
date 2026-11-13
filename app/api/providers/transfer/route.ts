import { isAdminRequest } from '@/lib/auth';
import { exportProviderTransfer, importProviderTransfer, MAX_PROVIDER_TRANSFER_BYTES } from '@/apps/api/provider-transfer-application';

export const runtime = 'nodejs';

async function readLimitedRequestBody(request: Request) {
  if (!request.body) throw new Error('服务商迁移文件为空');
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > MAX_PROVIDER_TRANSFER_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error('服务商迁移文件超过 20 MB');
    }
    chunks.push(Buffer.from(next.value));
  }
  return Buffer.concat(chunks, bytes);
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const body = await request.json();
    const file = await exportProviderTransfer(String(body?.password || ''));
    return new Response(new Uint8Array(file), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="SANMAO-providers.sanmao-providers"',
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '导出服务商失败' }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_PROVIDER_TRANSFER_BYTES) throw new Error('服务商迁移文件超过 20 MB');
    const file = await readLimitedRequestBody(request);
    const encodedPassword = request.headers.get('x-sanmao-provider-transfer-password') || '';
    let password = '';
    try { password = decodeURIComponent(encodedPassword); } catch { throw new Error('迁移密码格式无效'); }
    const result = await importProviderTransfer(file, password);
    return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '导入服务商失败' }, { status: 400 });
  }
}
