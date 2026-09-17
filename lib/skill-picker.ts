export type SkillPickerEntry = {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  enabled?: boolean;
  useCount?: number;
  lastUsedAt?: number;
};

/** 输入框内容整体是一个 /指令 时返回指令词（可能为空串），否则返回 null。 */
export function skillSlashQuery(value: string): string | null {
  const match = /^\/([^\s/]*)$/.exec(String(value || ''));
  return match ? match[1] : null;
}

export function filterSkills<T extends SkillPickerEntry>(skills: readonly T[] | null | undefined, query: string): T[] {
  const list = (skills || []).filter((skill): skill is T => Boolean(skill) && skill.enabled !== false);
  const matched = list.filter((skill) => skillMatchesTerms(skill, skillQueryTerms(query)));
  /* 常用与最近用过的排在前面；都没有记录时保持传入顺序。 */
  return matched
    .map((skill, index) => ({ skill, index }))
    .sort((a, b) =>
      (Number(b.skill.lastUsedAt) || 0) - (Number(a.skill.lastUsedAt) || 0)
      || (Number(b.skill.useCount) || 0) - (Number(a.skill.useCount) || 0)
      || a.index - b.index)
    .map((row) => row.skill);
}

/** 技能搜索词：按空格拆词，最多 6 个；技能菜单和技能面板共用同一套规则。 */
export function skillQueryTerms(query: unknown): string[] {
  return String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
}

/** 名称、标识、简介、别名任一命中一个词即算命中；多个词必须全部命中。 */
export function skillMatchesTerms(skill: SkillPickerEntry, terms: readonly string[]): boolean {
  const needles = (terms || []).map((term) => String(term || '').trim().toLowerCase()).filter(Boolean);
  if (!needles.length) return true;
  const haystack = `${skill.name} ${skill.id} ${skill.description || ''} ${(skill.tags || []).join(' ')}`.toLowerCase();
  return needles.every((term) => haystack.includes(term));
}

export function skillTriggerText(name: string) {
  return `用「${String(name || '').trim()}」技能：`;
}

/** 选中技能后写回输入框：吃掉用户刚敲的 /指令，再补上指定技能的前缀。 */
export function skillMessageValue(current: string, name: string) {
  const rest = String(current || '').replace(/^\/[^\s/]*\s*/, '');
  return skillTriggerText(name) + rest;
}
