import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { isAdminRequest } from '@/lib/auth';
import { listSkillFilesForBackup, readSkill, skillMarkdown } from '@/lib/skills';

export const runtime = 'nodejs';

function decode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const skill = readSkill(decode(id));
  if (!skill) return Response.json({ error: '技能不存在。' }, { status: 404 });
  const markdown = skillMarkdown(skill);
  if (new URL(request.url).searchParams.get('format') !== 'zip') {
    return new Response(markdown, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': 'attachment; filename="' + skill.id + '.md"',
      },
    });
  }
  /* 打包成 zip：SKILL.md 放在根目录，附件保持原有相对路径，可直接再导入。 */
  const entries: Record<string, Uint8Array> = { 'SKILL.md': Buffer.from(markdown, 'utf8') };
  for (const file of listSkillFilesForBackup(skill.dir)) {
    const name = file.path.toLowerCase();
    if (name === 'skill.md' || name === 'meta.json') continue;
    entries[file.path] = await readFile(file.file);
  }
  return new Response(zipSync(entries, { level: 6 }), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': 'attachment; filename="' + skill.id + '.zip"',
    },
  });
}
