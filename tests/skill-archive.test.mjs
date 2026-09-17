import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { zipSync } from 'fflate';
import ts from 'typescript';

const compilerOptions = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 };

function toDataUrl(source) {
  const compiled = ts.transpileModule(source, { compilerOptions }).outputText;
  return 'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64');
}

const skillsUrl = toDataUrl(await readFile(new URL('../lib/skills.ts', import.meta.url), 'utf8'));
const fflateUrl = new URL('../node_modules/fflate/esm/index.mjs', import.meta.url).href;
const archiveSource = (await readFile(new URL('../lib/skill-archive.ts', import.meta.url), 'utf8'))
  .replace("from 'fflate'", "from '" + fflateUrl + "'")
  .replace("from './skills'", "from '" + skillsUrl + "'");
const archive = await import(toDataUrl(archiveSource));

test('ZIP 导入能识别技能根目录下的 SKILL.md', () => {
  const zip = zipSync({
    'SKILL.md': Buffer.from('---\nname: zip-import\ndescription: 测试\n---\n\n# 正文\n'),
    'references/说明.md': Buffer.from('# 参考\n'),
    'meta.json': Buffer.from('{"id":"forged"}'),
    'node_modules/x.js': Buffer.from('x'),
  });
  const parsed = archive.skillFilesFromArchive(zip);
  assert.equal(parsed.root, '');
  assert.match(parsed.document, /name: zip-import/);
  assert.deepEqual(parsed.files.map((file) => file.path), ['references/说明.md']);
  assert.deepEqual(parsed.warnings, []);
});

test('ZIP 导入支持带子目录前缀的技能并保留中文附件', () => {
  const zip = zipSync({
    'repo-main/skills/demo/SKILL.md': Buffer.from('---\nname: demo\ndescription: 测试\n---\n\n# 正文\n'),
    'repo-main/skills/demo/doc.md': Buffer.from('x'),
    'repo-main/skills/demo/references/资料.md': Buffer.from('# 资料\n'),
    'repo-main/skills/other/SKILL.md': Buffer.from('---\nname: other\ndescription: 测试\n---\n\n# 正文\n'),
  });
  const parsed = archive.skillFilesFromArchive(zip, { dir: 'demo' });
  assert.equal(parsed.root, 'repo-main/skills/demo');
  assert.deepEqual(parsed.files.map((file) => file.path).sort(), ['doc.md', 'references/资料.md']);
  assert.equal(parsed.files.find((file) => file.path === 'references/资料.md').text, '# 资料\n');
});

test('ZIP 导入在没有 SKILL.md 时仍然报错', () => {
  const zip = zipSync({ 'readme.md': Buffer.from('no skill here') });
  assert.throws(() => archive.skillFilesFromArchive(zip), /没有找到 SKILL.md/);
});

test('根目录技能与子目录技能并存时候选里保留根目录', () => {
  const zip = zipSync({
    'SKILL.md': Buffer.from('---\nname: 根技能\ndescription: 顶层技能\n---\n\n# 正文\n'),
    'skills/deep/SKILL.md': Buffer.from('---\nname: 深层技能\ndescription: 子目录技能\n---\n\n# 正文\n'),
  });
  const parsed = archive.skillFilesFromArchive(zip);
  assert.deepEqual(parsed.roots, ['', 'skills/deep']);
  assert.deepEqual(parsed.candidates.map((item) => item.key), ['', 'deep']);
  assert.equal(parsed.candidates[0].name, '根技能');
  const picked = archive.skillFilesFromArchive(zip, { dir: 'deep' });
  assert.equal(picked.root, 'skills/deep');
  assert.equal(picked.candidates.length, 2);
});

test('ZIP 里有多个技能时返回候选列表并支持按目录导入', () => {
  const zip = zipSync({
    'repo-main/skills/brief/SKILL.md': Buffer.from('---\nname: 简报\ndescription: 写简报\n---\n\n# 正文\n'),
    'repo-main/skills/brief/template.md': Buffer.from('模板'),
    'repo-main/skills/translate/SKILL.md': Buffer.from('---\nname: 翻译\ndescription: 翻译文本\n---\n\n# 正文\n'),
    'repo-main/skills/nested/deep/SKILL.md': Buffer.from('# 深层技能\n\n步骤\n'),
  });
  const parsed = archive.skillFilesFromArchive(zip);
  assert.equal(parsed.roots.length, 3);
  assert.deepEqual(parsed.candidates.map((item) => item.key), ['brief', 'translate', 'deep']);
  assert.deepEqual(parsed.candidates.map((item) => item.name), ['简报', '翻译', '深层技能']);
  assert.equal(parsed.candidates[0].description, '写简报');
  assert.equal(parsed.candidates[0].root, 'repo-main/skills/brief');
  assert.match(parsed.warnings[0], /3 个技能/);

  const picked = archive.skillFilesFromArchive(zip, { dir: 'deep' });
  assert.equal(picked.root, 'repo-main/skills/nested/deep');
  assert.match(picked.document, /深层技能/);
  assert.deepEqual(picked.files, []);

  const brief = archive.skillFilesFromArchive(zip, { dir: 'brief' });
  assert.equal(brief.root, 'repo-main/skills/brief');
  assert.deepEqual(brief.files.map((file) => file.path), ['template.md']);

  assert.equal(archive.archiveRootMatches('repo-main/skills/brief', 'brief'), true);
  assert.equal(archive.archiveRootMatches('repo-main/skills/brief', 'translate'), false);
});
