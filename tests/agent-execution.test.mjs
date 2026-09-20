import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import ts from 'typescript';

async function compile(relative, names) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const selected = names ? tree.statements.filter((node) => names.some((name) => node.name?.text === name || node.declarationList?.declarations.some((item) => item.name?.text === name))).map((node) => node.getText(tree)).join('\n') : source;
  const compiled = ts.transpileModule(selected, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(`${compiled}\n${names ? `export { ${names.join(', ')} };` : ''}`).toString('base64')}`);
}
const outcome = await compile('../lib/agent/tool-outcome.ts');
const move = await compile('../lib/agent/filesystem-result.ts');
const strip = await compile('../lib/skills.ts', ['MODEL_TOOL_MARKUP_PATTERN', 'TRAILING_PARTIAL_MARKUP', 'dropPartialMarkupTail', 'INTERNAL_CONTEXT_MARKER', 'stripToolCallMarkup'].filter((name) => name !== 'stripToolCallMarkup'));
// Load the actual stream function with only its pure markup dependencies.
const route = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('route.ts', route, ts.ScriptTarget.Latest, true);
const streamNode = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'streamAgentResult');
const skillsSource = await readFile(new URL('../lib/skills.ts', import.meta.url), 'utf8');
const skillsTree = ts.createSourceFile('skills.ts', skillsSource, ts.ScriptTarget.Latest, true);
const stripNode = skillsTree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'stripToolCallMarkup');
const inline = await compile('../lib/agent/inline-tool-calls.ts');
const js = ts.transpileModule(`${stripNode.getText(skillsTree).replace('export ', '')}\n${streamNode.getText(tree)}\nreturn streamAgentResult;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const stream = new Function(...Object.keys(strip), 'hasInlineToolCallMarkup', js)(...Object.values(strip), inline.hasInlineToolCallMarkup);

test('chunked tool markup never becomes a visible delta or a false success', async () => {
  const encoder = new TextEncoder();
  const chunks = ['<tool_', 'call>{"name":"image_generate",', '"arguments":{"prompt":"test"}}</tool_call>'];
  const upstream = new Response(new ReadableStream({ start(controller) {
    for (const content of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
    controller.close();
  } }));
  let settled;
  const response = stream(upstream, { images: [], files: [], generations: [], model: 'test', deliverable: 'IMAGE' }, undefined, (value) => { settled = value; });
  const events = (await response.text()).trim().split('\n\n').map((frame) => JSON.parse(frame.slice(6)));
  assert.doesNotMatch(events.filter((event) => event.type === 'delta').map((event) => event.text).join(''), /tool_call|arguments|image_generate/);
  assert.match(events.at(-1).message, /未能完成/);
  assert.equal(settled.status, 'error');
});

test('successful image delivery survives a malformed caption', async () => {
  const response = stream(null, { fallback: '<tool_call>', images: [{ url: '/image.png' }], files: [], generations: [], model: 'test', deliverable: 'IMAGE' });
  const events = (await response.text()).trim().split('\n\n').map((frame) => JSON.parse(frame.slice(6)));
  assert.match(events.at(-1).message, /已完成 1 张图片/);
  assert.equal(events.at(-1).images[0].url, '/image.png');
});

test('failed tool evidence overrides model success and unrelated successes do not erase failures', () => {
  assert.match(outcome.toolOutcomeText('已经成功', [{ name: 'move', key: 'a', ok: false, error: 'denied' }, { name: 'move', key: 'b', ok: true }]), /denied/);
  assert.equal(outcome.toolOutcomeText('完成', [{ name: 'read', key: 'a', ok: false }, { name: 'read', key: 'a', ok: true }]), '完成');
});

test('rename success requires destination to exist and original to disappear', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'sanmao-move-'));
  try {
    const source = path.join(base, 'old.png');
    const destination = path.join(base, 'INTJ.png');
    await writeFile(source, 'image');
    assert.match(await move.verifyFilesystemMove({ source, destination }), /尚未确认/);
    await rename(source, destination);
    assert.equal(await move.verifyFilesystemMove({ source, destination }), '');
    await writeFile(source, 'leftover');
    assert.match(await move.verifyFilesystemMove({ source, destination }), /仍然存在/);
  } finally { await rm(base, { recursive: true, force: true }); }
});
