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
