import { isTrustedAppRequest } from '@/lib/auth';
import { LocalUpdateBusyError, startLocalUpdate } from '@/lib/local-update';
import { getUpdateStatus } from '@/lib/update';

export const runtime = 'nodejs';

const noStoreHeaders = { 'Cache-Control': 'no-store' };

function unavailableMessage(reason: string | undefined) {
  if (reason === 'missing-checksum') return '发布包缺少 SHA-256 校验值，暂不能安全更新，请稍后重试';
  if (reason === 'missing-package') return '发布包地址缺失，暂不能安全更新，请稍后重试';
  if (reason === 'missing-updater') return '当前安装目录缺少本地更新程序，请重新下载完整安装包';
  if (reason === 'disabled') return '当前运行环境已关闭本地更新，请通过部署或安装包升级';
  return '此更新没有可验证的本地更新包，请前往 GitHub 下载';
}

function requestPort(request: Request) {
  try {
    const port = Number(new URL(request.url).port);
    return Number.isInteger(port) && port >= 1024 && port <= 65525 ? port : 0;
  } catch {
    return 0;
  }
}

function sameLocalOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const source = new URL(origin);
    const target = new URL(request.url);
    return source.protocol === target.protocol && source.host === target.host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request) || !sameLocalOrigin(request)) {
    return Response.json({ error: '更新请求未通过本地安全校验' }, { status: 403, headers: noStoreHeaders });
  }

  try {
    const status = await getUpdateStatus(true);
    if (!status.hasUpdate) return Response.json({ error: '当前已经是最新版本' }, { status: 409, headers: noStoreHeaders });
    if (!status.canApply) return Response.json({ error: unavailableMessage(status.applyUnavailableReason) }, { status: 409, headers: noStoreHeaders });
    const result = await startLocalUpdate(status, { port: requestPort(request) });
    return Response.json(result, { headers: noStoreHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '本地更新失败' }, { status: error instanceof LocalUpdateBusyError ? 409 : 500, headers: noStoreHeaders });
  }
}
