import assert from 'node:assert/strict';
import test from 'node:test';
import { buildToolsModule } from './tools-build.mjs';

const tools = await buildToolsModule();
const NONE = { fileGeneration: false, deliveryRequest: false, skillsEnabled: false, imageAllowed: false };
const namesFor = (context) => tools.toolSchemasFor(context).map((tool) => tool.function.name);

test('注册表登记全部内置工具，且每个工具都声明了 schema / 权限 / 下发条件', () => {
  assert.deepEqual(tools.TOOL_REGISTRY.map((tool) => tool.name), [
    'document_generate', 'spreadsheet_generate', 'presentation_generate', 'image_generate', 'image_edit',
    'file_generate', 'archive_generate', 'web_search', 'skill_search', 'skill_read', 'skill_install',
    'mcp_manage', 'canvas_patch', 'video_download',
  ]);
  assert.equal(new Set(tools.TOOL_REGISTRY.map((tool) => tool.name)).size, tools.TOOL_REGISTRY.length);
  for (const tool of tools.TOOL_REGISTRY) {
    assert.ok(tool.description.trim().length > 8);
    assert.equal(tool.schema.type, 'object');
    assert.equal(typeof tool.gating, 'function');
    assert.ok(tool.permissions.length);
    assert.ok(tool.tags.length);
    assert.equal(tool.source, 'native');
    assert.ok(tool.id.startsWith('native:'));
    assert.ok(tool.id.endsWith(tool.name));
    assert.ok(tool.risk);
  }
});

test('门控由注册表统一决定：普通对话不下发任何工具', () => {
  assert.deepEqual(namesFor(NONE), []);
  assert.deepEqual(namesFor({ ...NONE, imageAllowed: true }), ['image_generate', 'image_edit']);
  assert.deepEqual(namesFor({ ...NONE, skillsEnabled: true }), ['skill_search', 'skill_read', 'skill_install']);
  assert.deepEqual(namesFor({ ...NONE, fileGeneration: true }), ['file_generate']);
  assert.deepEqual(namesFor({ ...NONE, deliveryRequest: true }), ['document_generate', 'spreadsheet_generate', 'presentation_generate', 'file_generate', 'archive_generate']);
  assert.deepEqual(namesFor({ ...NONE, mcpAdmin: true }), ['mcp_manage']);
  assert.deepEqual(namesFor({ ...NONE, canvas: true }), ['canvas_patch']);
  assert.deepEqual(namesFor({ ...NONE, videoDownload: true }), ['video_download']);
  assert.ok(!namesFor({ ...NONE, fileGeneration: true, deliveryRequest: true, skillsEnabled: true, imageAllowed: true }).includes('web_search'));
});

test('工具 schema 原样透传成 OpenAI function 结构', () => {
  const definition = tools.getToolDefinition('document_generate');
  const schema = tools.toModelToolSchema(definition);
  assert.equal(schema.type, 'function');
  assert.equal(schema.function.name, definition.name);
  assert.equal(schema.function.parameters, definition.schema);
  assert.equal(tools.getToolDefinition('not_a_tool'), null);
});

test('能力标签支撑执行类别和调用判断', () => {
  assert.equal(tools.toolExecutionKind('web_search'), 'web');
  assert.equal(tools.toolExecutionKind('file_generate'), 'file');
  assert.equal(tools.toolExecutionKind('document_generate'), 'artifact');
  assert.equal(tools.toolExecutionKind('archive_generate'), 'artifact');
  assert.equal(tools.toolExecutionKind('image_edit'), 'image');
  assert.equal(tools.toolExecutionKind('skill_read'), 'skill');
  assert.equal(tools.toolExecutionKind('canvas_patch'), 'canvas');
  assert.equal(tools.toolExecutionKind('video_download'), 'video-download');
  assert.equal(tools.toolExecutionKind('unknown_tool'), null);
  assert.ok(tools.isArtifactToolCall({ function: { name: 'archive_generate' } }));
  assert.ok(tools.isImageToolCall({ function: { name: 'image_edit' } }));
  assert.ok(tools.isSkillToolCall({ function: { name: 'skill_install' } }));
  assert.deepEqual(tools.toolPermissions('document_generate'), ['artifact:write']);
  assert.equal(tools.toolSource('image_generate'), 'native');
});

test('每个注册表标签都能推导出稳定执行类别', () => {
  const mapping = { artifact: 'artifact', archive: 'artifact', image: 'image', skill: 'skill', file: 'file', video: 'video-download', web: 'web', 'mcp-admin': 'mcp-manage', canvas: 'canvas' };
  for (const tag of new Set(tools.TOOL_REGISTRY.flatMap((tool) => [...tool.tags]))) {
    assert.ok(mapping[tag], `${tag} 需要类别映射`);
    const owner = tools.TOOL_REGISTRY.find((tool) => tool.tags.includes(tag));
    assert.equal(tools.toolExecutionKind(owner.name), mapping[tag], owner.name);
  }
});

test('模型参数缺失或损坏时归一化为空对象', () => {
  assert.deepEqual(tools.parseToolArguments(undefined), {});
  assert.deepEqual(tools.parseToolArguments(''), {});
  assert.deepEqual(tools.parseToolArguments('{bad json'), {});
  assert.deepEqual(tools.parseToolArguments('{"query":"hello"}'), { query: 'hello' });
});
