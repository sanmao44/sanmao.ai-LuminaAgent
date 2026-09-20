import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/agent-persona.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const persona = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('persona badge label summarises the conversation persona for history badges', () => {
  assert.equal(persona.personaBadgeLabel(''), '');
  assert.equal(persona.personaBadgeLabel(null), '');
  assert.equal(persona.personaBadgeLabel('  你是宇智波斑' + String.fromCharCode(10) + '傲慢、蔑视一切  '), '你是宇智波斑');
  assert.equal(persona.personaBadgeLabel(String.fromCharCode(10) + '第 1 行' + String.fromCharCode(10) + '第 2 行'), '第 1 行');
  assert.equal(persona.personaBadgeLabel('x'.repeat(40), 10), 'xxxxxxxxxx…');
  assert.equal(persona.personaBadgeLabel('x'.repeat(40), 40), 'x'.repeat(40));
});

test('history sidebar filters and searches conversations that carry a persona', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes("const [chatPersonaOnly, setChatPersonaOnly] = useState(false);"));
  assert.match(page, /const personaChatCount = useMemo\(\(\)=>chatSessions\.filter\(\(session\)=>normalizeConversationPersona\(session\.persona\)\)\.length/);
  assert.match(page, /if \(chatPersonaOnly && !persona\) return false;/);
  assert.match(page, /return `\$\{session\.title\} \$\{persona\} \$\{session\.messages\.map/);
  assert.match(page, /chatHistorySearch,[\s\S]{0,40}chatPersonaOnly/);
  assert.ok(page.includes("className: `chat-history-persona-filter ${chatPersonaOnly ? 'active' : ''}`"));
  assert.ok(page.includes('const personaLabel = personaBadgeLabel(session.persona);'));
  assert.ok(page.includes('className: "chat-history-persona-tag",'));
  assert.ok(page.includes('没有找到带角色设定的对话'));
});
