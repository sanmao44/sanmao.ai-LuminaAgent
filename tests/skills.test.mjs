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

test('技能别名标签参与检索并写入文档', async () => {
  const parsed = skills.parseSkillDocument([
    '---', 'name: Bug Fixing', 'description: 定位并修复缺陷', 'tags: 报错, 修bug', 'aliases: 调试', '---', '', '正文',
  ].join('\n'));
  assert.deepEqual(parsed.tags, ['报错', '修bug', '调试']);
  const listed = skills.parseSkillDocument(['---', 'name: demo', 'tags:', '  - 剪辑', '  - 调色', '---', '', '正文'].join('\n'));
  assert.deepEqual(listed.tags, ['剪辑', '调色']);
  assert.deepEqual(skills.normalizeSkillTags('调色 剪辑'), ['调色', '剪辑']);
  assert.deepEqual(skills.normalizeSkillTags(['报错', '报错', '调试']), ['报错', '调试']);
  assert.deepEqual(skills.normalizeSkillTags('a, 报错'), ['报错']);

  const composed = skills.composeSkillDocument({ name: 'demo', description: '', version: '', tags: ['剪辑', '调色'] }, '正文');
  assert.match(composed, /tags: 剪辑, 调色/);
  assert.deepEqual(skills.parseSkillDocument(composed).tags, ['剪辑', '调色']);

  const { store, cleanup } = await tempStore();
  try {
    const installed = skills.installSkill({ id: 'bug-fixing', name: 'Bug Fixing', description: 'fix defects', tags: ['报错', '调试'], body: '正文' }, store);
    assert.deepEqual(installed.tags, ['报错', '调试']);
    const reloaded = skills.readSkill('bug-fixing', store);
    assert.deepEqual(reloaded.tags, ['报错', '调试']);
    assert.match(skills.buildSkillIndexSection([reloaded]), /（别名：报错、调试）/);
    const toolContent = JSON.parse(skills.buildSkillToolContent(reloaded));
    assert.deepEqual(toolContent.tags, ['报错', '调试']);
    assert.equal(skills.searchSkills('报错', [reloaded])[0].id, 'bug-fixing');
    assert.equal(skills.searchSkills('调试', [reloaded]).length, 1);
    assert.equal(skills.searchSkills('修一下这个报错', [reloaded])[0].id, 'bug-fixing');
  } finally {
    await cleanup();
  }
});

test('技能正文与附件支持按 offset 分段续读', async () => {
  const { store, cleanup } = await tempStore();
  try {
    const body = 'A'.repeat(12000) + 'B'.repeat(8000);
    const installed = skills.installSkill({ id: 'long', name: '长技能', body }, store);
    const first = JSON.parse(skills.buildSkillToolContent(installed));
    assert.equal(first.offset, 0);
    assert.equal(first.totalChars, 20000);
    assert.equal(first.truncated, true);
    assert.equal(first.content.length, skills.SKILL_TOOL_CONTENT_MAX_CHARS);
    assert.equal(first.nextOffset, skills.SKILL_TOOL_CONTENT_MAX_CHARS);
    assert.match(first.hint, /offset=/);

    const second = JSON.parse(skills.buildSkillToolContent(installed, null, first.nextOffset));
    assert.equal(second.truncated, false);
    assert.equal(second.nextOffset, null);
    assert.equal(second.offset, skills.SKILL_TOOL_CONTENT_MAX_CHARS);
    assert.equal(first.content + second.content, body);
    const beyond = JSON.parse(skills.buildSkillToolContent(installed, null, 99999));
    assert.equal(beyond.content, '');
    assert.equal(beyond.nextOffset, null);
    assert.match(beyond.hint, /已读完/);

    await writeFile(path.join(store.dataDir, 'skills', 'long', 'SKILL.md'), ['---', 'name: 超长技能', '---', '', 'D'.repeat(30000)].join('\n'));
    const clipped = skills.readSkill('long', store);
    assert.equal(clipped.bodyClipped, true);
    assert.equal(clipped.bodyChars, 30000);
    assert.equal(clipped.body.length, skills.SKILL_BODY_MAX_CHARS);
    const clippedHead = JSON.parse(skills.buildSkillToolContent(clipped));
    assert.equal(clippedHead.totalChars, 30000);
    assert.equal(clippedHead.truncated, true);
    const clippedTail = JSON.parse(skills.buildSkillToolContent(clipped, null, skills.SKILL_BODY_MAX_CHARS));
    assert.equal(clippedTail.truncated, false);
    assert.equal(clippedTail.content.length, 6000);

    const long = skills.installSkill({ id: 'long-save', name: '超长保存', body: 'E'.repeat(30000) }, store);
    assert.equal(long.bodyChars, 30000);
    assert.equal(long.bodyClipped, true);
    assert.equal(long.body.length, skills.SKILL_BODY_MAX_CHARS);
    const savedDoc = await readFile(path.join(store.dataDir, 'skills', 'long-save', 'SKILL.md'), 'utf8');
    assert.ok(savedDoc.trimEnd().endsWith('E'.repeat(500)), '磁盘上必须保留完整正文');
    const reread = skills.readSkill('long-save', store);
    const rereadHead = JSON.parse(skills.buildSkillToolContent(reread));
    assert.equal(rereadHead.totalChars, 30000);
    assert.equal(rereadHead.truncated, true);
    const rereadTail = JSON.parse(skills.buildSkillToolContent(reread, null, skills.SKILL_BODY_MAX_CHARS));
    assert.equal(rereadTail.content.length, 6000);
    assert.equal(rereadTail.truncated, false);
    const chunks = [rereadHead.content];
    let cursor = rereadHead.nextOffset;
    while (cursor !== null && chunks.length < 5) {
      const next = JSON.parse(skills.buildSkillToolContent(reread, null, cursor));
      chunks.push(next.content);
      cursor = next.nextOffset;
    }
    assert.ok(chunks.join('') === 'E'.repeat(30000), '分段读取必须能还原完整正文');

    const fromDoc = skills.installSkillFromDocument({
      id: 'doc-skill',
      text: ['---', 'name: 文档技能', 'tags: 剪辑', '---', '', 'F'.repeat(26000)].join('\n'),
    }, store);
    assert.equal(fromDoc.bodyChars, 26000);
    assert.equal(fromDoc.bodyClipped, true);
    assert.deepEqual(fromDoc.tags, ['剪辑']);
    assert.equal(JSON.parse(skills.buildSkillToolContent(fromDoc)).totalChars, 26000);

    await mkdir(path.join(store.dataDir, 'skills', 'long', 'references'), { recursive: true });
    await writeFile(path.join(store.dataDir, 'skills', 'long', 'references', 'big.md'), 'C'.repeat(20000));
    const head = skills.readSkillFile('long', 'references/big.md', store);
    assert.equal(head.chars, 20000);
    assert.equal(head.offset, 0);
    assert.equal(head.truncated, true);
    assert.equal(JSON.parse(skills.buildSkillToolContent(installed, head)).nextOffset, skills.SKILL_TOOL_CONTENT_MAX_CHARS);
    assert.equal(head.text.length, skills.SKILL_TOOL_CONTENT_MAX_CHARS);
    const tail = skills.readSkillFile('long', 'references/big.md', { ...store, offset: head.text.length });
    assert.equal(tail.offset, skills.SKILL_TOOL_CONTENT_MAX_CHARS);
    assert.equal(tail.truncated, false);
    assert.equal(tail.text.length, 8000);
    const toolResult = JSON.parse(skills.buildSkillToolContent(installed, tail));
    assert.equal(toolResult.truncated, false);
    assert.equal(toolResult.binary, undefined);
    assert.match(toolResult.content, /^C+$/);
  } finally {
    await cleanup();
  }
});


test('技能使用次数与编辑已安装技能', async () => {
  const { store, cleanup } = await tempStore();
  try {
    const installed = skills.installSkill({ id: 'demo', name: '演示技能', description: '旧简介', tags: ['旧别名'], body: '正文 A' }, store);
    assert.equal(installed.useCount, 0);
    assert.equal(installed.lastUsedAt, 0);

    const used = skills.recordSkillUsage('demo', store);
    assert.equal(used.useCount, 1);
    assert.ok(used.lastUsedAt > 0);
    assert.equal(skills.recordSkillUsage('missing', store), null);
    assert.equal(skills.readSkill('demo', store).useCount, 1);

    const edited = skills.updateSkill('demo', { name: '演示技能 v2', description: '新简介', tags: '报错, 调试', body: '# 新正文' }, store);
    assert.equal(edited.name, '演示技能 v2');
    assert.equal(edited.description, '新简介');
    assert.deepEqual(edited.tags, ['报错', '调试']);
    assert.equal(edited.body, '# 新正文');
    assert.equal(edited.useCount, 1);
    const onDisk = await readFile(path.join(store.dataDir, 'skills', 'demo', 'SKILL.md'), 'utf8');
    assert.match(onDisk, /# 新正文/);
    assert.match(onDisk, /tags: 报错, 调试/);
    assert.equal(skills.searchSkills('报错', [edited])[0].id, 'demo');

    skills.installSkill({ id: 'demo-long', name: '长技能', body: 'G'.repeat(30000) }, store);
    const tagged = skills.updateSkill('demo-long', { tags: ['长文'] }, store);
    assert.equal(tagged.bodyChars, 30000);
    assert.equal(tagged.bodyClipped, true);
    assert.deepEqual(tagged.tags, ['长文']);
    assert.equal(skills.updateSkill('demo-long', {}, store).body, tagged.body);

    assert.throws(() => skills.updateSkill('demo-long', { name: '   ' }, store), /名称不能为空/);
    assert.throws(() => skills.updateSkill('demo-long', { body: '   ' }, store), /内容不能为空/);
    assert.throws(() => skills.updateSkill('missing', {}, store), /不存在/);
  } finally {
    await cleanup();
  }
});

test('技能附件清单标注文本、二进制与脚本类型', async () => {
  const { store, cleanup } = await tempStore();
  try {
    const installed = skills.installSkill({
      id: 'kinds',
      name: '附件类型',
      body: '正文',
      files: [
        { path: 'references/guide.md', text: '参考资料' },
        { path: 'scripts/run.py', text: 'print(1)' },
        { path: 'scripts/check.bat', text: 'echo hi' },
        { path: 'assets/logo.png', base64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64') },
      ],
    }, store);
    const content = JSON.parse(skills.buildSkillToolContent(installed));
    const byPath = Object.fromEntries(content.files.map((file) => [file.path, file]));
    assert.equal(byPath['references/guide.md'].kind, 'text');
    assert.equal(byPath['assets/logo.png'].kind, 'binary');
    assert.equal(byPath['scripts/run.py'].kind, 'script');
    assert.equal(byPath['scripts/check.bat'].kind, 'script');
    assert.match(byPath['scripts/run.py'].note, /永不执行/);

    const scriptFile = skills.readSkillFile('kinds', 'scripts/run.py', store);
    assert.equal(scriptFile.binary, false);
    const scriptContent = JSON.parse(skills.buildSkillToolContent(installed, scriptFile));
    assert.equal(scriptContent.kind, 'script');
    assert.match(scriptContent.script, /永不执行/);

    const textFile = skills.readSkillFile('kinds', 'references/guide.md', store);
    const textContent = JSON.parse(skills.buildSkillToolContent(installed, textFile));
    assert.equal(textContent.kind, 'text');
    assert.equal(textContent.script, undefined);

    const binaryFile = skills.readSkillFile('kinds', 'assets/logo.png', store);
    assert.equal(binaryFile.binary, true);
    assert.equal(skills.skillFileKind('assets/logo.png'), 'binary');
    assert.equal(skills.skillFileKind('scripts/check.bat'), 'script');
  } finally {
    await cleanup();
  }
});

test('常用技能排在技能索引与检索前面', () => {
  const base = { enabled: true, pending: false, files: [], tools: [], tags: [], body: '正文', description: '', createdAt: 0, updatedAt: 0, lastUsedAt: 0 };
  const records = Array.from({ length: 30 }, (_, index) => ({ ...base, id: 'skill-' + index, name: 'S' + index, useCount: index === 29 ? 5 : 0 }));
  const section = skills.buildSkillIndexSection(records);
  const firstRow = section.split('\n').find((line) => line.startsWith('- '));
  assert.ok(firstRow.startsWith('- skill-29'), '常用技能必须排在索引最前面');
  assert.ok(section.includes('另有 ' + (30 - skills.SKILL_INDEX_MAX) + ' 个技能未列出'));

  const found = skills.searchSkills('流程', [
    { ...base, id: 'rare', name: 'Rare', body: '流程说明', useCount: 0 },
    { ...base, id: 'often', name: 'Often', body: '流程说明', useCount: 3 },
  ]);
  assert.equal(found[0].id, 'often');
});

test('Agent 路由接入技能工具与渐进披露', async () => {
  const route = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');
  const skillTools = await readFile(new URL('../lib/tools/skills.ts', import.meta.url), 'utf8');
  assert.match(route, /import \{ buildAgentSkillContext,[^}]*\} from '@\/lib\/skills';/);
  assert.match(route, /import \{ fetchSkillFilesFromGithub \} from '@\/lib\/skill-archive';/);
  assert.match(skillTools, /name: 'skill_search'/);
  assert.match(skillTools, /name: 'skill_read'/);
  assert.match(skillTools, /name: 'skill_install'/);
  assert.match(skillTools, /offset: \{ type: 'number'/);
  assert.match(skillTools, /tags: \{ type: 'string'/);
  assert.match(route, /readSkillFile\(skill\.id, filePath, \{ pending: false, offset \}\)/);
  assert.match(route, /buildSkillToolContent\(skill, file, offset\)/);
  assert.match(route, /tags: args\.tags/);
  assert.match(route, /recordSkillUsage\(skill\.id, \{ pending: false \}\)/);
  assert.match(route, /skillsEnabled: skillContext\.settings\.enabled,/);
  assert.match(route, /if \(kind === 'skill'\) \{/);
  assert.match(route, /const skillContext = buildAgentSkillContext\(\{ settings: state\.settings, dataDir: resolveLocalDataDir\(\) \}\);/);
  assert.ok(route.match(/system \+= skillPromptSection;/g).length === 2);
  assert.match(route, /skillInstalls >= SKILL_INSTALL_MAX_PER_REQUEST/);
  assert.match(route, /skillToolCalls >= SKILL_TOOL_MAX_CALLS/);
  assert.match(route, /parsed\.roots\.length > 1/);
  assert.match(route, /parsed\.candidates\.slice\(0, 8\)/);
});

test('技能接口覆盖列表、导入、待确认与设置', async () => {
  const list = await readFile(new URL('../app/api/skills/route.ts', import.meta.url), 'utf8');
  const detail = await readFile(new URL('../app/api/skills/[id]/route.ts', import.meta.url), 'utf8');
  const importRoute = await readFile(new URL('../app/api/skills/import/route.ts', import.meta.url), 'utf8');
  const pending = await readFile(new URL('../app/api/skills/pending/[id]/route.ts', import.meta.url), 'utf8');
  const updateRoute = await readFile(new URL('../app/api/skills/[id]/update-check/route.ts', import.meta.url), 'utf8');
  const exportRoute = await readFile(new URL('../app/api/skills/[id]/export/route.ts', import.meta.url), 'utf8');
  for (const route of [list, detail, importRoute, pending, updateRoute, exportRoute]) {
    assert.ok(route.includes('isAdminRequest(request)'));
    assert.ok(route.includes("export const runtime = 'nodejs';"));
  }
  assert.match(list, /patchSettings\(patch\)/);
  assert.match(detail, /setSkillEnabled\(decode\(id\), Boolean\(data\.enabled\)\)/);
  assert.match(detail, /updateSkill\(decode\(id\), patch\)/);
  assert.match(importRoute, /skillFilesFromArchive\(buffer\)/);
  assert.match(importRoute, /fetchSkillFilesFromGithub\(target\)/);
  assert.match(importRoute, /listLocalAgentSkills\(\)\.find/);
  assert.match(importRoute, /readSelectionDirs\(/);
  assert.match(importRoute, /parsed\.roots\.length > 1/);
  assert.match(importRoute, /choices: parsed\.candidates/);
  assert.match(importRoute, /installArchiveSelection/);
  assert.match(importRoute, /installGithubSelection/);
  assert.match(pending, /approvePendingSkill\(key\)/);
  assert.match(pending, /discardPendingSkill\(key\)/);
  assert.match(updateRoute, /planSkillUpdate\(skill, latest\.document\)/);
  assert.match(updateRoute, /markSkillSourceChecked\(skill\.id/);
  assert.match(updateRoute, /installSkillFromDocument\(\{/);
  assert.match(updateRoute, /fetchSkillFilesFromGithub\(target, sourceDir \? \{ dir: sourceDir \} : \{\}\)/);
  assert.match(updateRoute, /archiveRootMatches\(parsed\.root, sourceDir\)/);
  assert.match(exportRoute, /skillMarkdown\(skill\)/);
  assert.match(exportRoute, /content-disposition/i);
});

test('模型写出的工具调用标记会被截断', () => {
  assert.equal(skills.stripToolCallMarkup('已完成安装，等待你确认。\n\n|<DSML|> calls>\n<|DSML|> invoke name="skill_search">'), '已完成安装，等待你确认。');
  assert.equal(skills.stripToolCallMarkup('先查一下。｜｜DSML｜｜ invoke name="x"'), '先查一下。');
  assert.equal(skills.stripToolCallMarkup('正常的技能说明文本。'), '正常的技能说明文本。');
});

test('模型把工具调用写成 <tool_call> 文本时同样截断', () => {
  const markup = '<tool_call>\n<function=playwright_browsersnapshot>\n</function>\n</tool_call>';
  assert.equal(skills.stripToolCallMarkup('已经打开页面了。\n\n' + markup), '已经打开页面了。');
  assert.equal(skills.stripToolCallMarkup('页面已打开，接下来在搜索框里输入关键词。\n\n<'), '页面已打开，接下来在搜索框里输入关键词。');
  assert.equal(skills.stripToolCallMarkup('<function=browser_click>'), '', '标记在最前面时不该留下空壳');
  assert.equal(skills.stripToolCallMarkup('先看一眼 <tool_calls>再决定'), '先看一眼');
  assert.equal(skills.stripToolCallMarkup('这里提到 tool_call 但没写成标记。'), '这里提到 tool_call 但没写成标记。');
});

test('GitHub 技能抓取带目录候选与接口通道', async () => {
  assert.equal(skills.SKILL_ARCHIVE_TIMEOUT_MS, 45000);
  const archive = await readFile(new URL('../lib/skill-archive.ts', import.meta.url), 'utf8');
  assert.match(archive, /export function githubSkillDirCandidates/);
  assert.match(archive, /if \(last\) candidates\.push\('skills\/' \+ last, last\);/);
  assert.match(archive, /async function fetchSkillFilesFromGithubApi/);
  assert.match(archive, /const GITHUB_API_BASE = 'https:\/\/api\.github\.com';/);
  assert.match(archive, /const viaApi = await fetchSkillFilesFromGithubApi\(searchTarget, options\);/);
  assert.match(archive, /export function archiveRootMatches/);
});

test('多技能来源目录会被保存并用于精确回抓', async () => {
  const { store, cleanup } = await tempStore();
  try {
    const text = '---\nname: 翻译演示\ndescription: 演示\n---\n\n# 正文\n';
    const installed = skills.installSkillFromDocument({ text, source: 'github', sourceUrl: 'owner/repo', sourceDir: 'skills/translate' }, store);
    assert.equal(installed.sourceDir, 'skills/translate');
    assert.equal(skills.readSkill(installed.id, store).sourceDir, 'skills/translate');
    assert.equal(skills.skillSummary(installed).sourceDir, 'skills/translate');
    const legacy = skills.installSkill({ name: '旧技能演示', body: '# 正文' }, store);
    assert.equal(skills.readSkill(legacy.id, store).sourceDir, '');
  } finally {
    await cleanup();
  }
});

test('技能来源更新检测与导出分享', async () => {
  const { store, cleanup } = await tempStore();
  try {
    const document = (body) => skills.composeSkillDocument({ name: '更新演示', description: '看更新', version: '1.0' }, body);
    const installed = skills.installSkillFromDocument({ text: document('# 步骤\n\n第一步。'), source: 'url', sourceUrl: 'https://example.com/SKILL.md' }, store);
    assert.match(installed.sourceHash, /^[0-9a-f]{64}$/);
    assert.ok(installed.sourceCheckedAt > 0);

    const same = skills.planSkillUpdate(installed, document('# 步骤\n\n第一步。'));
    assert.equal(same.status, 'same');
    assert.equal(same.localEdited, false);
    assert.equal(same.remote.version, '1.0');

    const changed = skills.planSkillUpdate(installed, document('# 步骤\n\n第二步。'));
    assert.equal(changed.status, 'updated');
    assert.ok(changed.remote.chars > 0);

    skills.updateSkill(installed.id, { body: '# 步骤\n\n本地改过。' }, store);
    const edited = skills.planSkillUpdate(skills.readSkill(installed.id, store), document('# 步骤\n\n第一步。'));
    assert.equal(edited.status, 'same');
    assert.equal(edited.localEdited, true);

    const checked = skills.markSkillSourceChecked(installed.id, { sourceHash: changed.sourceHash }, store);
    assert.equal(checked.sourceHash, changed.sourceHash);
    assert.ok(checked.sourceCheckedAt > 0);

    const metaPath = path.join(store.dataDir, 'skills', installed.id, 'meta.json');
    const legacyMeta = JSON.parse(await readFile(metaPath, 'utf8'));
    delete legacyMeta.sourceHash;
    await writeFile(metaPath, JSON.stringify(legacyMeta), 'utf8');
    const legacy = skills.readSkill(installed.id, store);
    assert.equal(legacy.sourceHash, '');
    assert.equal(skills.planSkillUpdate(legacy, document('# 步骤\n\n本地改过。')).status, 'same');

    const long = skills.installSkill({ name: '长技能', body: 'x'.repeat(skills.SKILL_BODY_MAX_CHARS + 120) }, store);
    const markdown = skills.skillMarkdown(long);
    assert.ok(markdown.includes('name: 长技能'));
    assert.ok(markdown.includes('x'.repeat(skills.SKILL_BODY_MAX_CHARS + 120)));
  } finally {
    await cleanup();
  }
});
test('备份用技能目录枚举与路径解析', async () => {
  const { store, cleanup } = await tempStore();
  try {
    skills.installSkill({ name: '备份演示', description: '备份', body: '# 正文' }, store);
    const id = skills.resolveSkillId('备份演示');
    const skillDir = path.join(store.dataDir, 'skills', id);
    await mkdir(path.join(skillDir, 'references'), { recursive: true });
    await writeFile(path.join(skillDir, 'references', '说明.md'), '# 参考', 'utf8');
    await mkdir(path.join(skillDir, 'node_modules'), { recursive: true });
    await writeFile(path.join(skillDir, 'node_modules', 'x.js'), 'x', 'utf8');
    await writeFile(path.join(skillDir, '.hidden'), 'x', 'utf8');

    const root = skills.resolveSkillsDir(store);
    assert.deepEqual(skills.listInstalledSkillDirs(root).map((entry) => entry.id), [id]);

    const listed = skills.listSkillFilesForBackup(skillDir).map((entry) => entry.path).sort();
    assert.deepEqual(listed, ['SKILL.md', 'meta.json', 'references/说明.md']);

    assert.equal(skills.resolveSkillArchivePath(root, id + '/SKILL.md'), path.join(root, id, 'SKILL.md'));
    assert.equal(skills.resolveSkillArchivePath(root, id + '/references/说明.md'), path.join(root, id, 'references', '说明.md'));
    assert.equal(skills.resolveSkillArchivePath(root, '../outside.md'), '');
    assert.equal(skills.resolveSkillArchivePath(root, 'a/../../b.md'), '');
    assert.equal(skills.resolveSkillArchivePath(root, 'SKILL.md'), '');
    assert.equal(skills.resolveSkillArchivePath(root, 'C:/x.md'), '');
    assert.equal(skills.resolveSkillArchivePath(root, ''), '');
  } finally {
    await cleanup();
  }
});
test('来源接口状态码转成可读提示', () => {
  assert.equal(skills.skillHttpErrorMessage(403), '下载失败（HTTP 403）：来源接口限流，请过几分钟再试');
  assert.equal(skills.skillHttpErrorMessage(429, 'GitHub 目录接口失败'), 'GitHub 目录接口失败（HTTP 429）：来源接口限流，请过几分钟再试');
  assert.equal(skills.skillHttpErrorMessage(404), '下载失败：来源地址不存在（HTTP 404）');
  assert.equal(skills.skillHttpErrorMessage(500), '下载失败（HTTP 500）');
  assert.equal(skills.skillHttpErrorMessage(500, 'GitHub 目录接口失败'), 'GitHub 目录接口失败（HTTP 500）');
});
