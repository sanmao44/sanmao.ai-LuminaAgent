import { isCrossSiteBrowserRequest } from '@/lib/auth';
import { hasSeenWelcome, markWelcomeSeen } from '@/lib/onboarding';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return Response.json({ seen: await hasSeenWelcome() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '读取开屏标记失败。' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (isCrossSiteBrowserRequest(request)) return Response.json({ error: '非法请求来源。' }, { status: 403 });
  try {
    await markWelcomeSeen();
    return Response.json({ seen: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '记录开屏标记失败。' }, { status: 500 });
  }
}
