import { getPublicState } from '@/lib/store';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return Response.json(await getPublicState());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '读取服务端配置失败' }, { status: 500 });
  }
}
