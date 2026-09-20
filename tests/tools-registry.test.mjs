import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildToolsModule } from './tools-build.mjs';

const tools = await buildToolsModule();
const route = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');
const registrySource = await readFile(new URL('../lib/tools/registry.ts', import.meta.url), 'utf8');

const NONE = { fileGeneration: false, deliveryRequest: false, skillsEnabled: false, imageAllowed: false };
const ALL = { fileGeneration: true, deliveryRequest: true, skillsEnabled: true, imageAllowed: true };
const namesFor = (context) => tools.toolSchemasFor(context).map((tool) => tool.function.name);

test('注册表登记全部内置工具，且每个工具都声明了 schema / 权限 / 下发条件', () => {
  assert.deepEqual(tools.TOOL_REGISTRY.map((tool) => tool.name), [
    'document_generate',
    'spreadsheet_generate',
    'presentation_generate',
    'image_generate',
    'image_edit',
    'file_generate',
    'archive_generate',
    'web_search',
    'skill_search',
    'skill_read',
    'skill_install',
    'mcp_manage',
    'canvas_patch',
  ], '工具顺序即下发顺序，不能随意调整');
  assert.equal(new Set(tools.TOOL_REGISTRY.map((tool) => tool.name)).size, tools.TOOL_REGISTRY.length, '工具名不能重复');
  for (const tool of tools.TOOL_REGISTRY) {
    assert.ok(tool.description.trim().length > 8, `${tool.name} 需要有给模型看的描述`);
    assert.equal(tool.schema.type, 'object', `${tool.name} 的参数 schema 必须是 object`);
    assert.equal(typeof tool.gating, 'function', `${tool.name} 必须声明下发条件`);
    assert.ok(tool.permissions.length, `${tool.name} 必须声明权限`);
    assert.ok(tool.tags.length, `${tool.name} 必须声明能力标签`);
    assert.equal(tool.source, 'native');
    assert.ok(tool.id.startsWith('native:'), `${tool.name} 的运行时 id 要用 native: 前缀`);
    assert.ok(tool.id.endsWith(tool.name), `${tool.name} 的 id 要和名字对应`);
    assert.ok(tool.risk, `${tool.name} 必须声明风险等级`);
  }
});

test('门控由注册表统一决定：普通对话不下发任何工具', () => {
  assert.deepEqual(namesFor(NONE), []);
  assert.deepEqual(namesFor({ ...NONE, imageAllowed: true }), ['image_generate', 'image_edit']);
  assert.deepEqual(namesFor({ ...NONE, skillsEnabled: true }), ['skill_search', 'skill_read', 'skill_install']);
  assert.deepEqual(namesFor({ ...NONE, fileGeneration: true }), ['file_generate']);
  assert.deepEqual(namesFor({ ...NONE, deliveryRequest: true }), ['document_generate', 'spreadsheet_generate', 'presentation_generate', 'file_generate', 'archive_generate'], '交付物请求会连文本文件工具一起下发');
  assert.deepEqual(namesFor({ ...NONE, fileGeneration: true, deliveryRequest: true }), ['document_generate', 'spreadsheet_generate', 'presentation_generate', 'file_generate', 'archive_generate']);
  assert.deepEqual(namesFor({ ...NONE, mcpAdmin: true }), ['mcp_manage'], '只有本轮在谈 MCP 服务时才下发管理工具');
  assert.deepEqual(namesFor({ ...NONE, canvas: true }), ['canvas_patch']);
  assert.ok(!namesFor({ ...NONE, canvas: false }).includes('canvas_patch'));
  assert.ok(!namesFor(ALL).includes('web_search'), '联网由本地先判断，永远不下发给模型');
});

test('工具 schema 原样透传成 OpenAI function 结构', () => {
  const document = tools.getToolDefinition('document_generate');
  const schema = tools.toModelToolSchema(document);
  assert.equal(schema.type, 'function');
  assert.equal(schema.function.name, 'document_generate');
  assert.equal(schema.function.description, document.description);
  assert.equal(schema.function.parameters, document.schema, '参数 schema 要原样透传，不能复制改写');
  assert.equal(tools.getToolDefinition('not_a_tool'), null);
});

test('能力标签支撑 route.ts 的分支判断', () => {
  assert.ok(tools.isArtifactToolCall({ function: { name: 'archive_generate' } }));
  assert.ok(tools.isArchiveToolCall({ function: { name: 'archive_generate' } }));
  assert.ok(!tools.isArchiveToolCall({ function: { name: 'document_generate' } }));
  assert.ok(tools.isImageToolCall({ function: { name: 'image_edit' } }));
  assert.ok(tools.isSkillToolCall({ function: { name: 'skill_install' } }));
  assert.equal(tools.isImageToolCall({ function: { name: 'unknown_tool' } }), false);
  assert.equal(tools.isArtifactToolCall({}), false);
  assert.deepEqual(tools.toolPermissions('document_generate'), ['artifact:write']);
  assert.deepEqual(tools.toolPermissions('not_a_tool'), []);
  assert.equal(tools.toolSource('image_generate'), 'native');
});

test('route.ts 只做编排：工具定义与门控链都搬到 lib/tools', () => {
  assert.match(route, /import \{ isArchiveToolCall, isArtifactToolCall, isImageToolCall, isSkillToolCall, toolExecutionKind, toolSchemasFor \} from '@\/lib\/tools';/);
  assert.match(route, /const callableTools = toolSchemasFor\(gatingContext, mcpTools, toolSelectionText, lazyGroupKeywords\);/);
  assert.match(route, /deliveryRequest: artifactGenerationRequest,/);
  assert.doesNotMatch(route, /const tools = \[/, '工具定义不能留在 route.ts');
  assert.doesNotMatch(route, /name: 'document_generate'/, '工具 schema 不能留在 route.ts');
  assert.doesNotMatch(route, /ARTIFACT_TOOL_NAMES/);
  assert.match(registrySource, /delivery: \(context: ToolGatingContext\) => context\.deliveryRequest,/);
});

test('每个能力标签都有执行入口，且入口由注册表标签推导', async () => {
  const executorSource = await readFile(new URL('../lib/tools/executor.ts', import.meta.url), 'utf8');
  // archive_generate 带 artifact + archive 两个标签，归入 artifact 分支；archive 不单独出现。
  const KIND_ENTRY = { artifact: 'artifact', archive: 'artifact', image: 'image', skill: 'skill', file: 'file', web: 'web', 'mcp-admin': 'mcp-manage', canvas: 'canvas' };
  const MAPPED_TAGS = new Set(['artifact', 'image', 'skill', 'file', 'web', 'mcp-admin', 'canvas']);
  const tags = new Set(tools.TOOL_REGISTRY.flatMap((tool) => [...tool.tags]));
  for (const tag of tags) {
    const kind = KIND_ENTRY[tag];
    assert.ok(kind, `${tag} 需要补一条类别映射`);
    if (MAPPED_TAGS.has(tag)) {
      assert.match(executorSource, new RegExp(`\\['${tag}', '${kind}'\\]`), `${tag} 在 executor 里没有类别映射`);
    }
    assert.ok(route.includes(`if (kind === '${kind}')`) || route.includes(`if (kind !== '${kind}') return { results };`), `${tag} 对应的 ${kind} 分支不在 route 里`);
    const owner = tools.TOOL_REGISTRY.find((tool) => tool.tags.includes(tag));
    assert.equal(tools.toolExecutionKind(owner.name), kind, `${owner.name} 的执行类别推导错了`);
  }
  assert.equal(tools.toolExecutionKind('not_a_tool'), null);
});

test('执行分派不再按工具名判断', () => {
  // 联网/文本文件/交付物/技能/MCP 以前各有一条按工具名或零散标签判断的分派，现在统一由注册表标签推导。
  assert.match(route, /const kind = toolExecutionKind\(call\?\.function\?\.name, mcpTools\);/);
  assert.doesNotMatch(route, /call\?\.function\?\.name === 'web_search'/);
  assert.doesNotMatch(route, /call\?\.function\?\.name === 'file_generate'/);
  assert.doesNotMatch(route, /if \(isArtifactToolCall\(call\)\) \{/, '类别判断不该再写在执行段里');
  assert.doesNotMatch(route, /if \(isSkillToolCall\(call\)\) \{/, '类别判断不该再写在执行段里');
  assert.doesNotMatch(route, /if \(isMcpToolCall\(call/, 'MCP 由来源推导，不再单独按名字判断');
});
