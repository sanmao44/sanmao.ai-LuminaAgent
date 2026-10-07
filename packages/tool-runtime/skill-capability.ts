import type { ChatMessage } from '../contracts/chat';
import type { SkillCapabilityPorts, SkillContext, SkillRecord } from '../contracts/skill';
import type { ToolCall, ToolRuntimeState } from './capability-state';

export type SkillCapabilityInput = {
  state: ToolRuntimeState & { skillToolCalls: number; skillInstalls: number; usedSkills: Array<{ id: string; name: string }> };
  call: ToolCall;
  args: Record<string, unknown>;
  skillContext: SkillContext;
  skillPorts?: SkillCapabilityPorts;
  signal: AbortSignal;
  installer: { kind: 'agent'; name: string; detail: string };
  parseToolArguments: (raw?: string) => unknown;
};

const fail = (call: ToolCall, error: string): ChatMessage => ({
  role: 'tool',
  tool_call_id: call.id,
  content: JSON.stringify({ ok: false, error }),
});

export async function executeSkillCapability(input: SkillCapabilityInput): Promise<ChatMessage> {
  const { state, call, skillContext, signal, installer, skillPorts } = input;
  if (!skillPorts) return fail(call, '技能运行时未配置。');
  const args = input.args;
  const name = String(call.function?.name || '');
  if (!skillContext.settings.enabled) return fail(call, '技能功能已关闭。');
  if (state.skillToolCalls >= skillPorts.maxCalls) return fail(call, '本轮技能工具调用次数已达上限，请直接用现有信息继续。');
  state.skillToolCalls += 1;
  try {
    if (name === 'skill_search') {
      const found = skillPorts.searchSkills(args.query, skillContext.skills, 8);
      return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({
        ok: true,
        query: String(args.query || ''),
        resultCount: found.length,
        skills: found.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description, tags: skill.tags })),
        hint: found.length ? '用 skill_read 读取需要的技能后再执行。' : '没有匹配的技能；如果用户要求安装某个技能，改用 skill_install。',
      }) };
    }
    if (name === 'skill_read') {
      const skill = skillPorts.readSkill(args.id, { pending: false });
      if (!skill) {
        const waiting = skillPorts.readSkill(args.id, { pending: true });
        return fail(call, waiting ? `技能“${waiting.name}”还在等待用户确认，确认后才能使用。` : '技能不存在或尚未启用。');
      }
      if (!skill.enabled) return fail(call, `技能“${skill.name}”当前未启用。`);
      const filePath = typeof args.file === 'string' ? args.file.trim() : '';
      const offsetValue = Math.trunc(Number(args.offset));
      const offset = Number.isFinite(offsetValue) && offsetValue > 0 ? offsetValue : 0;
      const file = filePath ? skillPorts.readSkillFile(skill.id, filePath, { pending: false, offset }) : null;
      if (filePath && !file) return fail(call, `技能里没有这个附件：${filePath.slice(0, 120)}`);
      if (!state.usedSkills.some((item) => item.id === skill.id)) state.usedSkills.push({ id: skill.id, name: skill.name });
      try { skillPorts.recordSkillUsage(skill.id, { pending: false }); } catch { /* usage telemetry is best effort */ }
      return { role: 'tool', tool_call_id: call.id, content: skillPorts.buildSkillToolContent(skill, file, offset) };
    }
    if (state.skillInstalls >= skillPorts.maxInstalls) return fail(call, '本轮安装次数已达上限，请先让用户确认已安装的技能。');
    const autoApprove = skillContext.settings.autoApprove;
    const urlArg = String(args.url || '').trim();
    const nameArg = String(args.name || '').trim();
    const bodyArg = typeof args.body === 'string' ? args.body : '';
    const shorthand = !urlArg && !bodyArg.trim() && /^[\w.-]+\/[\w.-]+(\/[\w.\-/]*)?$/.test(nameArg) ? nameArg : '';
    const sourceRef = urlArg || shorthand;
    let installed: SkillRecord | null = null;
    if (sourceRef) {
      const githubTarget = /github\.com\//i.test(sourceRef) || !/^[a-z]+:\/\//i.test(sourceRef) ? skillPorts.parseGithubSkillTarget(sourceRef) : null;
      if (githubTarget) {
        const parsed = await skillPorts.fetchSkillFilesFromGithub(githubTarget, { signal });
        if (parsed.roots.length > 1) {
          const list = parsed.candidates.slice(0, 8).map((item) => item.key + (item.name ? `（${item.name}）` : '')).join('、');
          return fail(call, `这个仓库里有 ${parsed.roots.length} 个技能：${list}。先和用户确认安装哪一个，再用 owner/repo/目录 或 /tree/分支/目录 形式的链接重新安装。`);
        }
        installed = skillPorts.installSkillFromDocument({ text: parsed.document, files: parsed.files, id: args.id, tags: args.tags, source: 'github', sourceUrl: sourceRef, sourceDir: githubTarget.dir, installer, pending: !autoApprove });
      } else {
        const fetched = await skillPorts.fetchSkillText(sourceRef, { signal });
        installed = skillPorts.installSkillFromDocument({ text: fetched.text, id: args.id, tags: args.tags, source: 'url', sourceUrl: fetched.url, installer, pending: !autoApprove });
      }
    } else {
      installed = skillPorts.installSkill({ id: args.id, name: args.name, description: args.description, body: args.body, tags: args.tags, source: 'agent', installer, pending: !autoApprove });
    }
    state.skillInstalls += 1;
    if (!installed) return fail(call, '技能安装失败。');
    return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({
      ok: true,
      id: installed.id,
      name: installed.name,
      tags: installed.tags,
      status: installed.pending ? 'pending-confirmation' : 'enabled',
      files: (installed.files || []).map((item) => item.path),
      instruction: installed.pending ? '已保存到待确认区，需要用户在“技能”面板确认后才会生效。请如实告知用户，不要说已经可以直接使用。' : '技能已启用，可以用 skill_read 读取并立即使用。',
    }) };
  } catch (error) {
    if (signal.aborted) throw signal.reason || error;
    return fail(call, error instanceof Error ? error.message : '技能操作失败。');
  }
}
