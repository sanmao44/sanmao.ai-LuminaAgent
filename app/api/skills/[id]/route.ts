import { isAdminRequest } from '@/lib/auth';
import { deleteSkill, discardPendingSkill, readSkill, setSkillEnabled, skillSummary, skillsSnapshot } from '@/lib/skills';

export const runtime = 'nodejs';

function decode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const skill = readSkill(decode(id));
  if (!skill) return Response.json({ error: '技能不存在。' }, { status: 404 });
  return Response.json({ ok: true, skill });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const { id } = await context.params;
    const data = await request.json();
    const skill = setSkillEnabled(decode(id), Boolean(data.enabled));
    return Response.json({ ok: true, skill: skillSummary(skill), ...skillsSnapshot() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '更新技能失败。' }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const { id } = await context.params;
    const key = decode(id);
    if (readSkill(key, { pending: false })) deleteSkill(key);
    else if (readSkill(key, { pending: true })) discardPendingSkill(key);
    else return Response.json({ error: '技能不存在。' }, { status: 404 });
    return Response.json({ ok: true, ...skillsSnapshot() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '删除技能失败。' }, { status: 400 });
  }
}
