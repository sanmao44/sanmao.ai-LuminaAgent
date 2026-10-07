import { isAdminRequest } from '@/lib/auth';
import { approvePendingSkill, discardPendingSkill, readSkill, skillSummary, skillsSnapshot } from '@/lib/skills';

export const runtime = 'nodejs';

function decode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const { id } = await context.params;
    const key = decode(id);
    const data = await request.json().catch(() => ({} as Record<string, unknown>));
    if (String(data.action || 'approve') === 'discard') {
      discardPendingSkill(key);
      return Response.json({ ok: true, ...skillsSnapshot() });
    }
    if (readSkill(key, { pending: false }) && !data.overwrite) {
      return Response.json({ error: '已存在同名技能，确认覆盖后才能替换。', conflict: true }, { status: 409 });
    }
    const skill = approvePendingSkill(key);
    return Response.json({ ok: true, skill: skillSummary(skill), ...skillsSnapshot() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '处理待确认技能失败。' }, { status: 400 });
  }
}
