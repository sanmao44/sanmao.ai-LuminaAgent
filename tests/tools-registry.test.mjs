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
  ], '工具顺序即下发顺序，不能随意调整');
  assert.equal(new Set(tools.TOOL_REGISTRY.map((tool) => tool.name)).size, tools.TOOL_REGISTRY.length, '工具名不能重复');
  for (const tool of tools.TOOL_REGISTRY) {
    assert.ok(tool.description.trim().length > 8, `${tool.name} 需要有给模型看的描述`);
    assert.equal(tool.schema.type, 'object', `${tool.name} 的参数 schema 必须是 object`);
    assert.equal(typeof tool.gating, 'function', `${tool.name} 必须声明下发条件`);
    assert.ok(tool.permissions.length, `${tool.name} 必须声明权限`);
    assert.ok(tool.tags.length, `${tool.name} 必须声明能力标签`);
    assert.equal(tool.source, 'native');
  }
});

test('门控由注册表统一决定：普通对话不下发任何工具', () => {
  assert.deepEqual(namesFor(NONE), []);
  assert.deepEqual(namesFor({ ...NONE, imageAllowed: true }), ['image_generate', 'image_edit']);
  assert.deepEqual(namesFor({ ...NONE, skillsEnabled: true }), ['skill_search', 'skill_read', 'skill_install']);
  assert.deepEqual(namesFor({ ...NONE, fileGeneration: true }), ['file_generate']);
  assert.deepEqual(namesFor({ ...NONE, deliveryRequest: true }), ['document_generate', 'spreadsheet_generate', 'presentation_generate', 'file_generate', 'archive_generate'], '交付物请求会连文本文件工具一起下发');
  assert.deepEqual(namesFor({ ...NONE, fileGeneration: true, deliveryRequest: true }), ['document_generate', 'spreadsheet_generate', 'presentation_generate', 'file_generate', 'archive_generate']);
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
  assert.match(route, /import \{ isArchiveToolCall, isArtifactToolCall, isImageToolCall, isMcpToolCall, isSkillToolCall, toolSchemasFor \} from '@\/lib\/tools';/);
  assert.match(route, /const callableTools = toolSchemasFor\(gatingContext, mcpTools\);/);
  assert.match(route, /deliveryRequest: artifactGenerationRequest,/);
  assert.doesNotMatch(route, /const tools = \[/, '工具定义不能留在 route.ts');
  assert.doesNotMatch(route, /name: 'document_generate'/, '工具 schema 不能留在 route.ts');
  assert.doesNotMatch(route, /ARTIFACT_TOOL_NAMES/);
  assert.match(registrySource, /delivery: \(context: ToolGatingContext\) => context\.deliveryRequest,/);
});

test('每个能力标签在 route.ts 里都有执行入口', () => {
  const dispatch = {
    artifact: /isArtifactToolCall\(/,
    archive: /isArchiveToolCall\(/,
    image: /isImageToolCall\(/,
    skill: /isSkillToolCall\(/,
    file: /'file_generate'/,
    web: /'web_search'/,
  };
  const tags = new Set(tools.TOOL_REGISTRY.flatMap((tool) => [...tool.tags]));
  for (const tag of tags) {
    assert.ok(dispatch[tag], `${tag} 需要补一条执行入口检查`);
    assert.match(route, dispatch[tag], `${tag} 在执行层没有对应分支`);
  }
});
