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
    content: `当前对话角色设定（仅作为行为与语气约束，优先服从用户当前明确请求）：\n${normalized}`,
  }];
}
