import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import ts from 'typescript';
import { createTsRequire } from './ts-require.mjs';

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
const inline = await compile('../lib/agent/inline-tool-calls.ts');
const stream = createTsRequire(process.cwd())('./apps/api/agent-stream').streamAgentResult;

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

test('a successful same-file preview settles a write blocked by the preview policy only', () => {
  const diff = '--- a/file.txt\n+++ b/file.txt\n-initial line\n+corrected line';
  const blocked = { name: 'write_file', ok: false, error: '这轮要求先核对差异，本次没有写入。', filesystemEditRecovery: { kind: 'blocked-write', path: 'C:\\work\\file.txt' } };
  const preview = { name: 'edit_file', ok: true, filesystemEditRecovery: { kind: 'preview', path: 'C:\\work\\file.txt', diff } };
  const reply = outcome.filesystemEditPreviewRecoveryText([blocked, preview]);
  assert.match(reply, /原文件没有修改/);
  assert.match(reply, /直接写入调用已.*拦截/);
  assert.ok(reply.includes(diff), 'the authoritative preview includes the exact diff returned by the filesystem tool');
  assert.equal(outcome.toolOutcomeText('预览完成，文件仍未落盘。', [blocked, preview]), '预览完成，文件仍未落盘。');
  assert.match(outcome.toolOutcomeText('预览完成。', [blocked, { ...preview, filesystemEditRecovery: { kind: 'preview', path: 'C:\\work\\other.txt', diff } }]), /要求先核对差异/);
  assert.match(outcome.toolOutcomeText('预览完成。', [blocked, { ...preview, ok: false, filesystemEditRecovery: { kind: 'preview', path: blocked.filesystemEditRecovery.path, diff: '' } }]), /要求先核对差异/);
  assert.match(outcome.toolOutcomeText('修改完成。', [blocked, { name: 'edit_file', ok: true, filesystemEditRecovery: { kind: 'write', path: blocked.filesystemEditRecovery.path } }]), /要求先核对差异/);
});

test('a later content read from the same Filesystem can settle a lookup miss', () => {
  const missing = { name: 'read_text_file', key: 'read:missing', ok: false, error: 'ENOENT', filesystemTextRead: { serverId: 'local', kind: 'missing' } };
  const content = { name: 'read_text_file', key: 'read:source', ok: true, filesystemTextRead: { serverId: 'local', kind: 'content' } };
  assert.equal(outcome.toolOutcomeText('已完成定位。', [missing, content], 'answer'), '已完成定位。');
  assert.match(outcome.toolOutcomeText('已完成定位。', [missing], 'answer'), /ENOENT/);
  assert.match(outcome.toolOutcomeText('已完成定位。', [content, missing], 'answer'), /ENOENT/);
  assert.match(outcome.toolOutcomeText('已完成定位。', [missing, { ...content, filesystemTextRead: { serverId: 'other', kind: 'content' } }], 'answer'), /ENOENT/);
  assert.match(outcome.toolOutcomeText('', [missing, { name: 'write_file', ok: false, error: 'write denied' }, content], 'answer'), /write denied/);
});

test('file content repairs replace only the result for the same filename targets', () => {
  const key = (files) => outcome.toolOutcomeKey('file_generate', JSON.stringify({ files }));
  const failed = { filename: 'page.html', content: '' };
  const repaired = { filename: 'page.html', content: '<html>fixed</html>' };
  assert.equal(key([failed]), key([repaired]));
  assert.equal(outcome.toolOutcomeText('已完成 1 个文件。', [
    { name: 'file_generate', key: key([failed]), ok: false, error: '没有收到有效的文件内容' },
    { name: 'file_generate', key: key([repaired]), ok: true },
  ]), '已完成 1 个文件。');
  assert.match(outcome.toolOutcomeText('', [
    { name: 'file_generate', key: key([failed]), ok: false, error: 'page.html 仍未生成' },
    { name: 'file_generate', key: key([{ filename: 'other.html', content: 'ok' }]), ok: true },
  ]), /page\.html 仍未生成/);
  assert.equal(key([{ filename: 'a.html', content: '' }, { filename: 'b.html', content: '' }]), key([{ filename: 'b.html', content: 'b' }, { filename: 'a.html', content: 'a' }]));
  assert.notEqual(key([{ content: '' }]), key([repaired]), 'unknown targets cannot clear a previous failure');
  const batch = [{ filename: 'a.html', content: 'a' }, { filename: 'b.html', content: '' }];
  const partialKey = outcome.toolOutcomeKey('file_generate', JSON.stringify({ files: batch }), { ok: true, files: [{ name: 'a.html' }] });
  assert.notEqual(partialKey, key(batch), 'a partial batch does not resolve every requested target');
  assert.match(outcome.toolOutcomeText('', [
    { name: 'file_generate', key: key(batch), ok: false, error: 'batch failed' },
    { name: 'file_generate', key: partialKey, ok: true },
  ]), /batch failed/);
  assert.notEqual(outcome.toolOutcomeKey('move', '{"source":"a","destination":"b"}'), outcome.toolOutcomeKey('move', '{"source":"a","destination":"c"}'));
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
