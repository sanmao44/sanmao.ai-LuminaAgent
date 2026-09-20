import { isLoopbackRequest, isTrustedAppRequest } from '@/lib/auth';
import { pickFolder } from '@/lib/mcp/pick-folder';

export const runtime = 'nodejs';

/**
 * 叫出系统原生的「选择文件夹」框，把用户选中的绝对路径回给面板。
 *
 * 选择框弹在**跑服务的那台机器**上：局域网里另一台设备点这个按钮，弹窗会开在主机上，
 * 点的人只会觉得「什么都没发生」。所以这里要求请求确实来自本机，远端一律拒绝，
 * 面板收到错误后提示手填路径。是否本机是「请求 URL 的主机名 + 没被跨站标记」两条一起看。
 */
export async function POST(request: Request) {
  if (!isTrustedAppRequest(request) || !isLoopbackRequest(request)) {
    return Response.json({ error: '系统选择框只能在本机打开；远程访问请直接填绝对路径。' }, { status: 401 });
  }
  try {
    return Response.json(await pickFolder());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '打不开系统选择框' }, { status: 400 });
  }
}
