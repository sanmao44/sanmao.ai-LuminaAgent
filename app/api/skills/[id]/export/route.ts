import { isAdminRequest } from '@/lib/auth';
import { readSkill, skillMarkdown } from '@/lib/skills';

export const runtime = 'nodejs';

function decode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const skill = readSkill(decode(id));
  if (!skill) return Response.json({ error: '技能不存在。' }, { status: 404 });
  return new Response(skillMarkdown(skill), {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': 'attachment; filename="' + skill.id + '.md"',
    },
  });
}
