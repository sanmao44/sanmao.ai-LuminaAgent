import { isAdminRequest } from '@/lib/auth';
import { archiveRootMatches, fetchSkillFilesFromGithub, skillFilesFromArchive } from '@/lib/skill-archive';
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
import type { GithubSkillTarget } from '@/lib/skills';

export const runtime = 'nodejs';

const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
const MAX_SELECTION_DIRS = 20;

function githubShorthand(value: string) {
  return /^(https?:\/\/)?(www\.)?github\.com\//i.test(value) || /^[\w.-]+\/[\w.-]+$/.test(value);
}

function readSelectionDirs(value: unknown) {
  let raw: unknown = value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [] as string[];
    try { raw = JSON.parse(text); } catch { raw = text.split(','); }
  }
  if (!Array.isArray(raw)) return [] as string[];
  /* 空字符串是合法的“根目录技能”选择，不能和“没有选择”一起过滤掉。 */
  const dirs = raw.filter((item): item is string => typeof item === 'string').map((item) => item.trim());
  return [...new Set(dirs)].slice(0, MAX_SELECTION_DIRS);
}

type InstallFailure = { dir: string; error: string };

async function installFailures(dirs: string[], run: (dir: string) => Promise<Record<string, unknown>> | Record<string, unknown>) {
  const installed: Array<Record<string, unknown>> = [];
  const failed: InstallFailure[] = [];
  for (const dir of dirs) {
    try {
      installed.push(await run(dir));
    } catch (error) {
      failed.push({ dir, error: error instanceof Error ? error.message : '安装失败' });
    }
  }
  return { installed, failed };
}

function selectionResponse(result: { installed: Array<Record<string, unknown>>; failed: InstallFailure[] }) {
  return Response.json({ ok: result.installed.length > 0, ...result, ...skillsSnapshot() });
}

/** 多技能归档：按用户勾选的目录逐个安装，单个失败不影响其余。 */
async function installArchiveSelection(buffer: Buffer, dirs: string[], meta: { sourceUrl: string; detail: string; overwrite: boolean }) {
  return installFailures(dirs, (dir) => {
    const selected = skillFilesFromArchive(buffer, { dir });
    if (!archiveRootMatches(selected.root, dir)) throw new Error('压缩包里没有目录“' + dir + '”对应的技能');
    const skill = installSkillFromDocument({
      text: selected.document,
      files: selected.files,
      source: 'zip',
      sourceUrl: meta.sourceUrl,
      installer: { kind: 'import', detail: meta.detail },
      overwrite: meta.overwrite,
    });
    return { skill: skillSummary(skill), warnings: selected.warnings };
  });
}

/** GitHub 仓库多技能：按勾选目录逐个抓取安装。 */
async function installGithubSelection(target: GithubSkillTarget, sourceUrl: string, dirs: string[], overwrite: boolean) {
  return installFailures(dirs, async (dir) => {
    const parsed = await fetchSkillFilesFromGithub(target, { dir });
    if (!archiveRootMatches(parsed.root, dir)) throw new Error('仓库里没有目录“' + dir + '”对应的技能，可能已被移动或删除');
    const skill = installSkillFromDocument({
      text: parsed.document,
      files: parsed.files,
      source: 'github',
      sourceUrl,
      sourceDir: dir,
      installer: { kind: 'import', detail: 'GitHub：' + target.owner + '/' + target.repo },
      overwrite,
    });
    return { skill: skillSummary(skill), warnings: parsed.warnings };
  });
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
      const dirs = readSelectionDirs(form.get('dirs'));
      const looksLikeZip = /\.zip$/i.test(file.name) || file.type.includes('zip') || (buffer[0] === 0x50 && buffer[1] === 0x4b);
      if (looksLikeZip) {
        if (dirs.length) return selectionResponse(await installArchiveSelection(buffer, dirs, { sourceUrl: file.name, detail: 'ZIP：' + file.name, overwrite }));
        const parsed = skillFilesFromArchive(buffer);
        if (parsed.roots.length > 1) return Response.json({ ok: true, choices: parsed.candidates, ...skillsSnapshot() });
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
        const dirs = readSelectionDirs(data.dirs);
        if (dirs.length) return selectionResponse(await installGithubSelection(target, raw, dirs, overwrite));
        const parsed = await fetchSkillFilesFromGithub(target);
        if (parsed.roots.length > 1) return Response.json({ ok: true, choices: parsed.candidates, ...skillsSnapshot() });
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
