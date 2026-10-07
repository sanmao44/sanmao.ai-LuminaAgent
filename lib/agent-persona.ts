export const PERSONA_MAX_CHARS = 4000;
export const PERSONA_LABEL_MAX_CHARS = 24;

export function normalizeConversationPersona(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, PERSONA_MAX_CHARS);
}

export function personaBadgeLabel(value: unknown, maxChars: number = PERSONA_LABEL_MAX_CHARS) {
  const normalized = normalizeConversationPersona(value);
  if (!normalized) return '';
  const limit = Math.max(1, Math.floor(maxChars));
  const firstLine = normalized.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || normalized;
  return firstLine.length > limit ? `${firstLine.slice(0, limit)}…` : firstLine;
}

export function personaContextMessage(persona: unknown) {
  const normalized = normalizeConversationPersona(persona);
  if (!normalized) return [];
  return [{
    role: 'system' as const,
    content: `当前对话角色设定（必须在本轮及后续每一轮持续遵守；除非用户明确要求修改或取消，不得自行忽略、淡化或改写）：\n${normalized}`,
  }];
}

export function appendPersonaToSystem(system: string, persona: unknown) {
  const [context] = personaContextMessage(persona);
  return context ? `${system}\n\n${context.content}\n\n角色设定执行要求：以上角色设定优先于默认回复格式、追问、继续建议和语言规则；本轮只按角色设定完成用户请求。` : system;
}
