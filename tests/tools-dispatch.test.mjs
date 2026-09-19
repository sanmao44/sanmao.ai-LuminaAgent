import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildToolsModule } from './tools-build.mjs';

const tools = await buildToolsModule();
const route = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');

const MCP_TOOL = { name: 'gh__search', tags: ['mcp'], source: 'mcp' };

test('执行类别由注册表标签推导，MCP 按来源归类', () => {
  assert.equal(tools.toolExecutionKind('web_search'), 'web');
  assert.equal(tools.toolExecutionKind('file_generate'), 'file');
  assert.equal(tools.toolExecutionKind('document_generate'), 'artifact');
  assert.equal(tools.toolExecutionKind('archive_generate'), 'artifact', 'archive_generate 复用交付物分支');
  assert.equal(tools.toolExecutionKind('image_edit'), 'image');
  assert.equal(tools.toolExecutionKind('skill_search'), 'skill');
  assert.equal(tools.toolExecutionKind('gh__search', [MCP_TOOL]), 'mcp');
  assert.equal(tools.toolExecutionKind('gh__search'), null, 'MCP 工具不在本轮列表里就查不到');
  assert.equal(tools.toolExecutionKind('not_a_tool'), null);
  assert.equal(tools.toolExecutionKind(''), null);
  assert.equal(tools.toolExecutionKind(undefined), null);
  assert.equal(tools.kindForTool({ tags: ['artifact', 'mcp'], source: 'mcp' }), 'mcp', '来源优先于标签');
  assert.equal(tools.kindForTool({ tags: [], source: 'native' }), null, '没有标签的工具没有执行类别');
});

test('route.ts 每个类别都有分支，且分派不看工具名', () => {
  for (const kind of ['web', 'file', 'artifact', 'skill', 'mcp']) {
    assert.ok(route.includes(`if (kind === '${kind}') {`), `${kind} 缺少执行分支`);
  }
  assert.ok(route.includes(`if (kind !== 'image') continue;`), 'image 分支也由类别决定');
  assert.ok(route.includes('const kind = toolExecutionKind(call?.function?.name, mcpTools);'), '类别要从注册表推导');
  assert.ok(route.indexOf('const policy = resolveToolPolicy(') < route.indexOf('const kind = toolExecutionKind('), '先过权限再分派');
});
