export type SkillPickerEntry = {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
};

/** 输入框内容整体是一个 /指令 时返回指令词（可能为空串），否则返回 null。 */
export function skillSlashQuery(value: string): string | null {
  const match = /^\/([^\s/]*)$/.exec(String(value || ''));
  return match ? match[1] : null;
}

export function filterSkills<T extends SkillPickerEntry>(skills: readonly T[] | null | undefined, query: string): T[] {
  const list = (skills || []).filter((skill): skill is T => Boolean(skill) && skill.enabled !== false);
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return list;
  return list.filter((skill) => `${skill.name} ${skill.id} ${skill.description || ''}`.toLowerCase().includes(normalized));
}

export function skillTriggerText(name: string) {
  return `用「${String(name || '').trim()}」技能：`;
}

/** 选中技能后写回输入框：吃掉用户刚敲的 /指令，再补上指定技能的前缀。 */
export function skillMessageValue(current: string, name: string) {
  const rest = String(current || '').replace(/^\/[^\s/]*\s*/, '');
  return skillTriggerText(name) + rest;
}
