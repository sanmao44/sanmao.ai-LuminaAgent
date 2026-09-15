import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/agent-persona.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const persona = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('conversation persona is normalized, bounded, and appended to the primary system prompt', async () => {
  assert.equal(persona.normalizeConversationPersona(null), '');
  assert.equal(persona.normalizeConversationPersona('  你是顾问  '), '你是顾问');
  assert.equal(persona.normalizeConversationPersona('x'.repeat(persona.PERSONA_MAX_CHARS + 20)).length, persona.PERSONA_MAX_CHARS);
  assert.deepEqual(persona.personaContextMessage(''), []);
  assert.deepEqual(persona.personaContextMessage('你是顾问')[0], {
    role: 'system',
    content: '当前对话角色设定（必须在本轮及后续每一轮持续遵守；除非用户明确要求修改或取消，不得自行忽略、淡化或改写）：\n你是顾问',
  });
  assert.match(persona.appendPersonaToSystem('基础系统提示词', '你是顾问'), /基础系统提示词[\s\S]*你是顾问/);
});

test('rebuilt Agent system prompts retain the conversation persona', async () => {
  const route = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');
  assert.match(route, /import \{ appendPersonaToSystem \} from '@\/lib\/agent-persona';/);
  assert.doesNotMatch(route, /personaContextMessage/);
  assert.match(route, /let system = appendPersonaToSystem\(buildSystem\(initialWebInstructions, ''\), body\.persona\);/);
  assert.match(route, /system = appendPersonaToSystem\(buildSystem\(`\$\{webSearchInstructions\}\$\{nativeAnswerInstructions\}`, webContext, webFailureContext\), body\.persona\);/);
});

test('saving persona updates the active conversation request immediately', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes("const agentPersonaRef = useRef('');"));
  assert.match(page, /agentPersonaRef\.current = normalized;[\s\S]*setAgentPersonaDraft\(normalized\)/);
  assert.match(page, /persona: sessionId === activeChatIdRef\.current \? agentPersonaRef\.current/);
});
