export const PERSONA_MAX_CHARS = 4000;

export function normalizeConversationPersona(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, PERSONA_MAX_CHARS);
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
  return context ? `${system}\n\n${context.content}` : system;
}
