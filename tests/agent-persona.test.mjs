import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/agent-persona.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const persona = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('conversation persona is normalized, bounded, and injected as a separate system context', () => {
  assert.equal(persona.normalizeConversationPersona(null), '');
  assert.equal(persona.normalizeConversationPersona('  你是顾问  '), '你是顾问');
  assert.equal(persona.normalizeConversationPersona('x'.repeat(persona.PERSONA_MAX_CHARS + 20)).length, persona.PERSONA_MAX_CHARS);
  assert.deepEqual(persona.personaContextMessage(''), []);
  assert.deepEqual(persona.personaContextMessage('你是顾问')[0], {
    role: 'system',
    content: '当前对话角色设定（仅作为行为与语气约束，优先服从用户当前明确请求）：\n你是顾问',
  });
});
