import { isAdminRequest } from '@/lib/auth';
import { archiveRootMatches, fetchSkillFilesFromGithub } from '@/lib/skill-archive';
import {
  fetchSkillText,
  installSkillFromDocument,
  markSkillSourceChecked,
  parseGithubSkillTarget,
  planSkillUpdate,
  readSkill,
  skillSummary,
  skillsSnapshot,
} from '@/lib/skills';

export const runtime = 'nodejs';

function decode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** 按技能记录里的来源地址取回最新的 SKILL.md（GitHub 仓库或直链）；多技能仓库按 sourceDir 精确回抓同一个技能。 */
async function fetchLatestDocument(skill: { sourceUrl: string; sourceDir?: string }) {
  const sourceUrl = String(skill.sourceUrl || '').trim();
  if (!sourceUrl) return null;
  const target = parseGithubSkillTarget(sourceUrl);
  if (target) {
    const sourceDir = String(skill.sourceDir || '').trim();
    const parsed = await fetchSkillFilesFromGithub(target, sourceDir ? { dir: sourceDir } : {});
    if (sourceDir && !archiveRootMatches(parsed.root, sourceDir)) throw new Error('来源仓库里找不到目录“' + sourceDir + '”对应的技能，可能已被移动或删除，先在技能面板里重新导入。');
    return { document: parsed.document, files: parsed.files };
  }
  if (!/^https?:\/\//i.test(sourceUrl)) return null;
  const fetched = await fetchSkillText(sourceUrl);
  return { document: fetched.text, files: [] };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const { id } = await context.params;
    const key = decode(id);
    const skill = readSkill(key, { pending: false });
    if (!skill) return Response.json({ error: '技能不存在，或还在等待确认。' }, { status: 404 });
    const latest = await fetchLatestDocument(skill);
    if (!latest) return Response.json({ error: '这个技能没有可检查的在线来源，只有 GitHub 和直链安装的技能支持检查更新。' }, { status: 400 });
    const data = await request.json().catch(() => ({} as Record<string, unknown>));
    const plan = planSkillUpdate(skill, latest.document);
    if (data.apply) {
      const updated = installSkillFromDocument({
        text: latest.document,
        files: latest.files,
        id: skill.id,
        tags: skill.tags,
        enabled: skill.enabled,
        source: skill.source,
        sourceUrl: skill.sourceUrl,
        installer: { kind: 'import', name: '更新重装', detail: skill.installer?.detail },
        overwrite: true,
      });
      return Response.json({ ok: true, applied: true, result: plan, skill: skillSummary(updated), ...skillsSnapshot() });
    }
    const checked = markSkillSourceChecked(skill.id, { sourceHash: plan.status === 'same' ? plan.sourceHash : undefined }, { pending: false });
    return Response.json({ ok: true, applied: false, result: plan, skill: checked ? skillSummary(checked) : skillSummary(skill) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '检查技能更新失败。' }, { status: 400 });
  }
}
