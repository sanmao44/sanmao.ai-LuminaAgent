import { isAdminRequest } from '@/lib/auth';
import { getPublicState, patchSettings } from '@/lib/store';
import { SKILL_INDEX_MAX, installSkill, skillsSnapshot, skillSummary } from '@/lib/skills';

export const runtime = 'nodejs';

function skillSettings(settings: { skillsEnabled?: boolean; skillsAutoApprove?: boolean }) {
  return { enabled: settings.skillsEnabled !== false, autoApprove: Boolean(settings.skillsAutoApprove) };
}

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const state = await getPublicState();
  return Response.json({ ok: true, ...skillsSnapshot(), indexLimit: SKILL_INDEX_MAX, settings: skillSettings(state.settings) });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const data = await request.json();
    const skill = installSkill({
      id: data.id,
      name: data.name,
      description: data.description,
      body: data.body,
      tags: data.tags,
      overwrite: Boolean(data.overwrite),
      source: 'local',
      installer: { kind: 'user', name: '本界面创建' },
    });
    return Response.json({ ok: true, skill: skillSummary(skill), ...skillsSnapshot() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '创建技能失败。' }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  if (!isAdminRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const data = await request.json();
    const patch: { skillsEnabled?: boolean; skillsAutoApprove?: boolean } = {};
    if (typeof data.enabled === 'boolean') patch.skillsEnabled = data.enabled;
    if (typeof data.autoApprove === 'boolean') patch.skillsAutoApprove = data.autoApprove;
    const settings = await patchSettings(patch);
    return Response.json({ ok: true, settings: skillSettings(settings), ...skillsSnapshot() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '保存技能设置失败。' }, { status: 400 });
  }
}
