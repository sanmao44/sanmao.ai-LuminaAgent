import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const source = await readFile(new URL('../lib/skills.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const skills = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

async function tempStore() {
  const dir = await mkdtemp(path.join(tmpdir(), 'sanmao-skills-'));
  return { store: { dataDir: dir }, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('技能标识与路径安全', () => {
  assert.equal(skills.normalizeSkillId('My Skill!!'), 'my-skill');
  assert.equal(skills.normalizeSkillId('../../etc/passwd'), 'etc-passwd');
  assert.equal(skills.skillIdFromName('Color Grade'), 'color-grade');
  assert.match(skills.skillIdFromName('影视调色'), /^skill-[0-9a-f]{10}$/);
  assert.equal(skills.resolveSkillId('RAG 检索'), 'rag');
  assert.equal(skills.normalizeSkillFilePath('references/a.md'), 'references/a.md');
  assert.equal(skills.normalizeSkillFilePath('../a.md'), '');
  assert.equal(skills.normalizeSkillFilePath('a/../../b.md'), '');
  assert.equal(skills.normalizeSkillFilePath('C:/x.md'), '');
  assert.equal(skills.isReservedSkillPath('SKILL.md'), true);
  assert.equal(skills.isReservedSkillPath('references/meta.json'), true);
  assert.equal(skills.shouldSkipSkillPath('node_modules/x/y.md'), true);
  assert.equal(skills.shouldSkipSkillPath('.git/config'), true);
  assert.equal(skills.shouldSkipSkillPath('references/a.md'), false);
});

test('frontmatter 解析与生成保持兼容', () => {
  const parsed = skills.parseSkillDocument(['---', 'name: demo', 'description: >', '  第一行', '  第二行', 'version: 1.2', '---', '', '# 标题', '', '正文内容'].join('\n'));
  assert.equal(parsed.name, 'demo');
  assert.equal(parsed.description, '第一行 第二行');
  assert.equal(parsed.version, '1.2');
  assert.equal(parsed.body, '# 标题\n\n正文内容');
  const fallback = skills.parseSkillDocument('# 我的技能\n\n做事情的方法。');
  assert.equal(fallback.name, '我的技能');
  assert.equal(fallback.description, '做事情的方法。');
  const composed = skills.composeSkillDocument({ name: 'demo', description: 'a: b', version: '' }, '# 标题');
  assert.match(composed, /^---\nname: demo\ndescription: "a: b"\n---\n/);
  assert.equal(skills.parseSkillDocument(composed).description, 'a: b');
});

test('安装、读取、启用、确认与删除', async () => {
  const { store, cleanup } = await tempStore();
  try {
    const installed = skills.installSkill({
      name: 'RAG 检索',
      description: '检索增强流程',
      body: '# 步骤\n\n先切分再检索。',
      files: [{ path: 'references/a.md', text: '参考资料' }, { path: '../evil.md', text: '坏文件' }],
    }, store);
    assert.equal(installed.id, 'rag');
    assert.equal(installed.enabled, true);
    assert.equal(installed.pending, false);
    assert.ok(installed.warnings.some((warning) => warning.includes('../evil.md')));
    assert.equal(installed.files.length, 1);

    const onDisk = await readFile(path.join(store.dataDir, 'skills', 'rag', 'SKILL.md'), 'utf8');
    assert.match(onDisk, /^---\nname: RAG 检索\n/);
    assert.equal(skills.parseSkillDocument(onDisk).name, 'RAG 检索');
    assert.match(onDisk, /先切分再检索。/);

    assert.equal(skills.listSkills({ ...store, pending: false }).length, 1);
    assert.equal(skills.listSkills({ ...store, pending: true }).length, 0);
    assert.equal(skills.readSkillFile('rag', 'references/a.md', store).text, '参考资料');
    assert.equal(skills.readSkillFile('rag', '../evil.md', store), null);
    assert.equal(skills.readSkillFile('rag', 'SKILL.md', store), null);
    assert.equal(skills.readSkill('missing', store), null);
    assert.throws(() => skills.installSkill({ name: 'RAG 检索', body: 'x' }, store), /已存在/);

    assert.equal(skills.setSkillEnabled('rag', false, store).enabled, false);
    assert.equal(skills.readSkill('rag', store).enabled, false);
    assert.equal(skills.buildSkillIndexSection(skills.listSkills(store)), '');
    assert.equal(skills.setSkillEnabled('rag', true, store).enabled, true);

    const pending = skills.installSkill({ id: 'agent-made', name: 'Agent 自建', body: '自主沉淀的流程', pending: true, source: 'agent' }, store);
    assert.equal(pending.pending, true);
    assert.equal(pending.enabled, false);
    assert.equal(skills.listSkills({ ...store, pending: false }).length, 1);
    assert.equal(skills.listSkills({ ...store, pending: true }).length, 1);
    assert.equal(skills.readSkill('agent-made', { ...store, pending: false }), null);

    const approved = skills.approvePendingSkill('agent-made', store);
    assert.equal(approved.pending, false);
    assert.equal(approved.enabled, true);
    assert.equal(skills.listSkills({ ...store, pending: true }).length, 0);
    assert.equal(skills.listSkills({ ...store, pending: false }).length, 2);
    skills.installSkill({ id: 'throwaway', name: '丢弃技能', body: '待确认后丢弃', pending: true }, store);
    assert.equal(skills.listSkills({ ...store, pending: true }).length, 1);
    assert.equal(skills.discardPendingSkill('throwaway', store), 'throwaway');
    assert.equal(skills.listSkills({ ...store, pending: true }).length, 0);
    assert.equal(skills.listSkills({ ...store, pending: false }).length, 2);
    assert.equal(skills.deleteSkill('rag', store), 'rag');
    assert.equal(skills.listSkills({ ...store, pending: false }).length, 1);
  } finally {
    await cleanup();
  }
});

test('技能索引只列出已启用技能并受条数上限约束', () => {
  const records = [
    { id: 'a', name: 'A 技能', description: '做 A', enabled: true, pending: false, files: [], body: 'A 流程' },
    { id: 'b', name: 'B 技能', description: '做 B', enabled: false, pending: false, files: [], body: 'B 流程' },
    { id: 'c', name: 'C 技能', description: '做 C', enabled: true, pending: true, files: [], body: 'C 流程' },
  ];
  const section = skills.buildSkillIndexSection(records);
  assert.match(section, /## 可用技能（渐进披露）/);
  assert.ok(section.includes('- a：A 技能 —— 做 A'));
  assert.ok(!section.includes('B 技能'));
  assert.ok(!section.includes('C 技能'));
  assert.ok(section.includes(skills.SKILL_UNTRUSTED_RULES));

  const many = Array.from({ length: 30 }, (_, index) => ({ id: 'skill-' + index, name: 'S' + index, description: '', enabled: true, pending: false, files: [], body: '' }));
  const capped = skills.buildSkillIndexSection(many);
  assert.ok(capped.includes('另有 ' + (30 - skills.SKILL_INDEX_MAX) + ' 个技能未列出'));

  assert.equal(skills.searchSkills('A', records)[0].id, 'a');
  assert.equal(skills.searchSkills('B 流程', records)[0].id, 'b');
  assert.equal(skills.searchSkills('完全无关', records).length, 0);
});

test('Agent 技能上下文包含索引与工具说明', async () => {
  const { store, cleanup } = await tempStore();
  try {
    skills.installSkill({ id: 'demo', name: '演示技能', description: '演示用', body: '步骤' }, store);
    const context = skills.buildAgentSkillContext({ settings: { skillsEnabled: true }, dataDir: store.dataDir });
    assert.equal(context.settings.enabled, true);
    assert.equal(context.skills.length, 1);
    assert.match(context.indexSection, /演示技能/);
    assert.match(context.toolHint, /skill_read/);
    const disabled = skills.buildAgentSkillContext({ settings: { skillsEnabled: false }, dataDir: store.dataDir });
    assert.equal(disabled.indexSection, '');
    assert.equal(disabled.toolHint, '');
    assert.equal(disabled.skills.length, 0);
  } finally {
    await cleanup();
  }
});

test('导入地址与主机安全校验', () => {
  for (const blocked of ['127.0.0.1', '10.0.0.5', '192.168.1.10', '172.16.3.4', '169.254.169.254', '[::1]', 'localhost', 'skill.internal', 'foo.local']) {
    assert.equal(skills.isBlockedSkillHost(blocked), true, blocked + ' 应当被拦截');
  }
  for (const allowed of ['example.com', 'raw.githubusercontent.com', 'github.com', '8.8.8.8']) {
    assert.equal(skills.isBlockedSkillHost(allowed), false, allowed + ' 不应当被拦截');
  }
  assert.throws(() => skills.assertSkillImportUrl('http://example.com/a.md'), /https/);
  assert.throws(() => skills.assertSkillImportUrl('https://user:pass@example.com/a.md'), /账号密码/);
  assert.throws(() => skills.assertSkillImportUrl('https://localhost/a.md'), /内网/);
  assert.throws(() => skills.assertSkillImportUrl('https://example.com:8080/a.md'), /443/);
  assert.equal(skills.assertSkillImportUrl('https://example.com/a.md').hostname, 'example.com');
});

test('GitHub 目标解析与归档地址', () => {
test('解析 allowed-tools 并写入技能文档', async () => {
  assert.deepEqual(skills.normalizeSkillTools('image_generate, file_generate'), ['image_generate', 'file_generate']);
  assert.deepEqual(skills.normalizeSkillTools(['Read', 'Read', 'none']), ['Read']);
  assert.deepEqual(skills.normalizeSkillTools('非法 工具*名'), []);
  assert.deepEqual(skills.normalizeSkillTools(''), []);
  const parsed = skills.parseSkillDocument(['---', 'name: demo', 'allowed-tools: image_generate file_generate', '---', '', '正文'].join('\n'));
  assert.deepEqual(parsed.tools, ['image_generate', 'file_generate']);
  const composed = skills.composeSkillDocument({ name: 'demo', description: '', version: '', tools: parsed.tools }, '正文');
  assert.match(composed, /allowed-tools: image_generate, file_generate/);
  assert.deepEqual(skills.parseSkillDocument(composed).tools, ['image_generate', 'file_generate']);
  const { store, cleanup } = await tempStore();
  try {
    const installed = skills.installSkill({ id: 'demo', name: 'demo', body: '正文', tools: 'image_generate' }, store);
    assert.deepEqual(installed.tools, ['image_generate']);
    assert.match(skills.buildSkillToolContent(installed), /image_generate/);
    const reloaded = skills.readSkill('demo', store);
    assert.deepEqual(reloaded.tools, ['image_generate']);
  } finally {
    await cleanup();
  }
});

test('本机技能目录按标识去重', async () => {
  const first = await mkdtemp(path.join(tmpdir(), 'sanmao-local-a-'));
  const second = await mkdtemp(path.join(tmpdir(), 'sanmao-local-b-'));
  try {
    for (const [root, description] of [[first, '项目内'], [second, '用户目录']]) {
      await mkdir(path.join(root, 'demo-skill'), { recursive: true });
      await writeFile(path.join(root, 'demo-skill', 'SKILL.md'), ['---', 'name: 演示技能', 'description: ' + description, '---', '', '正文'].join('\n'));
    }
    const found = skills.listLocalAgentSkills({ dirs: [first, second] });
    assert.equal(found.length, 1);
    assert.equal(found[0].description, '项目内');
    await mkdir(path.join(second, 'other-skill'), { recursive: true });
    await writeFile(path.join(second, 'other-skill', 'SKILL.md'), '# 另一个\n\n正文');
    assert.equal(skills.listLocalAgentSkills({ dirs: [first, second] }).length, 2);
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});
  assert.deepEqual(skills.parseGithubSkillTarget('owner/repo'), { owner: 'owner', repo: 'repo', ref: '', dir: '' });
  assert.deepEqual(skills.parseGithubSkillTarget('https://github.com/owner/repo'), { owner: 'owner', repo: 'repo', ref: '', dir: '' });
  assert.deepEqual(skills.parseGithubSkillTarget('https://github.com/owner/repo/tree/main/skills/demo'), { owner: 'owner', repo: 'repo', ref: 'main', dir: 'skills/demo' });
  assert.equal(skills.parseGithubSkillTarget('https://example.com/x'), null);
  assert.equal(skills.parseGithubSkillTarget('owner'), null);
  const target = skills.parseGithubSkillTarget('owner/repo');
  assert.deepEqual(skills.githubArchiveUrls(target), [
    'https://codeload.github.com/owner/repo/zip/HEAD',
    'https://codeload.github.com/owner/repo/zip/main',
    'https://codeload.github.com/owner/repo/zip/master',
  ]);
});

test('Agent 路由接入技能工具与渐进披露', async () => {
  const route = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');
  assert.match(route, /import \{ buildAgentSkillContext,[^}]*\} from '@\/lib\/skills';/);
  assert.match(route, /import \{ fetchSkillFilesFromGithub \} from '@\/lib\/skill-archive';/);
  assert.match(route, /name: 'skill_search'/);
  assert.match(route, /name: 'skill_read'/);
  assert.match(route, /name: 'skill_install'/);
  assert.match(route, /if \(name === 'skill_search' \|\| name === 'skill_read' \|\| name === 'skill_install'\) return skillContext\.settings\.enabled;/);
  assert.match(route, /const skillContext = buildAgentSkillContext\(\{ settings: state\.settings, dataDir: resolveLocalDataDir\(\) \}\);/);
  assert.ok(route.match(/system \+= skillPromptSection;/g).length === 2);
  assert.match(route, /skillInstalls >= SKILL_INSTALL_MAX_PER_REQUEST/);
  assert.match(route, /skillToolCalls >= SKILL_TOOL_MAX_CALLS/);
});

test('技能接口覆盖列表、导入、待确认与设置', async () => {
  const list = await readFile(new URL('../app/api/skills/route.ts', import.meta.url), 'utf8');
  const detail = await readFile(new URL('../app/api/skills/[id]/route.ts', import.meta.url), 'utf8');
  const importRoute = await readFile(new URL('../app/api/skills/import/route.ts', import.meta.url), 'utf8');
  const pending = await readFile(new URL('../app/api/skills/pending/[id]/route.ts', import.meta.url), 'utf8');
  for (const route of [list, detail, importRoute, pending]) {
    assert.ok(route.includes('isAdminRequest(request)'));
    assert.ok(route.includes("export const runtime = 'nodejs';"));
  }
  assert.match(list, /patchSettings\(patch\)/);
  assert.match(detail, /setSkillEnabled\(decode\(id\), Boolean\(data\.enabled\)\)/);
  assert.match(importRoute, /skillFilesFromArchive\(buffer\)/);
  assert.match(importRoute, /fetchSkillFilesFromGithub\(target\)/);
  assert.match(importRoute, /listLocalAgentSkills\(\)\.find/);
  assert.match(pending, /approvePendingSkill\(key\)/);
  assert.match(pending, /discardPendingSkill\(key\)/);
});
