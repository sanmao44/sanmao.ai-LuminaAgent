import { isAdminRequest } from '@/lib/auth';
import { fetchSkillFilesFromGithub, skillFilesFromArchive } from '@/lib/skill-archive';
import {
  fetchSkillText,
  installSkillFromDocument,
  listLocalAgentSkills,
  parseGithubSkillTarget,
  readLocalSkillDocument,
  skillFilesFromDirectory,
  skillSummary,
  skillsSnapshot,
} from '@/lib/skills';

export const runtime = 'nodejs';

const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;

function githubShorthand(value: string) {
  return /^(https?:\/\/)?(www\.)?github\.com\//i.test(value) || /^[\w.-]+\/[\w.-]+$/.test(value);
}

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const locals = listLocalAgentSkills().map((item) => ({ key: item.key, id: item.id, name: item.name, description: item.description, root: item.root }));
  return Response.json({ ok: true, locals });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return Response.json({ error: '请选择要导入的技能文件。' }, { status: 400 });
      if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: '文件超过 24MB 限制。' }, { status: 413 });
      const buffer = Buffer.from(await file.arrayBuffer());
      const overwrite = String(form.get('overwrite') || '') === 'true';
      const looksLikeZip = /\.zip$/i.test(file.name) || file.type.includes('zip') || (buffer[0] === 0x50 && buffer[1] === 0x4b);
      if (looksLikeZip) {
        const parsed = skillFilesFromArchive(buffer);
        const skill = installSkillFromDocument({
          text: parsed.document,
          files: parsed.files,
          source: 'zip',
          sourceUrl: file.name,
          installer: { kind: 'import', detail: 'ZIP：' + file.name },
          overwrite,
        });
        return Response.json({ ok: true, skill: skillSummary(skill), warnings: [...parsed.warnings, ...skill.warnings], ...skillsSnapshot() });
      }
      const skill = installSkillFromDocument({
        text: buffer.toString('utf8'),
        source: 'zip',
        sourceUrl: file.name,
        installer: { kind: 'import', detail: '文件：' + file.name },
        overwrite,
      });
      return Response.json({ ok: true, skill: skillSummary(skill), warnings: skill.warnings, ...skillsSnapshot() });
    }

    const data = await request.json();
    const overwrite = Boolean(data.overwrite);

    if (typeof data.localKey === 'string' && data.localKey) {
      const candidate = listLocalAgentSkills().find((item) => item.key === data.localKey);
      if (!candidate) return Response.json({ error: '本机技能列表已变化，请刷新后重试。' }, { status: 404 });
      const text = readLocalSkillDocument(candidate.dir);
      if (!text.trim()) return Response.json({ error: '这个目录里没有可读取的 SKILL.md。' }, { status: 400 });
      const skill = installSkillFromDocument({
        text,
        id: candidate.id,
        files: skillFilesFromDirectory(candidate.dir),
        source: 'local',
        installer: { kind: 'import', detail: '本机目录：' + candidate.root },
        overwrite,
      });
      return Response.json({ ok: true, skill: skillSummary(skill), warnings: skill.warnings, ...skillsSnapshot() });
    }

    if (typeof data.url === 'string' && data.url.trim()) {
      const raw = data.url.trim();
      const target = githubShorthand(raw) ? parseGithubSkillTarget(raw) : null;
      if (target) {
        const parsed = await fetchSkillFilesFromGithub(target);
        const skill = installSkillFromDocument({
          text: parsed.document,
          files: parsed.files,
          source: 'github',
          sourceUrl: raw,
          installer: { kind: 'import', detail: 'GitHub：' + target.owner + '/' + target.repo },
          overwrite,
        });
        return Response.json({ ok: true, skill: skillSummary(skill), warnings: [...parsed.warnings, ...skill.warnings], ...skillsSnapshot() });
      }
      const fetched = await fetchSkillText(raw);
      const skill = installSkillFromDocument({
        text: fetched.text,
        source: 'url',
        sourceUrl: fetched.url,
        installer: { kind: 'import', detail: '链接：' + fetched.url },
        overwrite,
      });
      return Response.json({ ok: true, skill: skillSummary(skill), warnings: skill.warnings, ...skillsSnapshot() });
    }

    if (typeof data.text === 'string' && data.text.trim()) {
      const skill = installSkillFromDocument({
        text: data.text,
        id: data.id,
        name: data.name,
        source: 'local',
        installer: { kind: 'user', name: '粘贴导入' },
        overwrite,
      });
      return Response.json({ ok: true, skill: skillSummary(skill), warnings: skill.warnings, ...skillsSnapshot() });
    }

    return Response.json({ error: '请提供 GitHub 仓库、SKILL.md 链接、上传文件或粘贴内容。' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '导入技能失败。' }, { status: 400 });
  }
}
