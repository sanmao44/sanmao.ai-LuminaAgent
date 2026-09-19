import { archiveGenerateTool, documentGenerateTool, presentationGenerateTool, spreadsheetGenerateTool } from './artifacts';
import { fileGenerateTool } from './file';
import { imageEditTool, imageGenerateTool } from './image';
import { skillInstallTool, skillReadTool, skillSearchTool } from './skills';
import { mcpManageTool } from './mcp-admin';
import { toModelToolSchema, type ModelToolSchema, type ToolDefinition, type ToolGatingContext, type ToolPermissions, type ToolSource, type ToolTag } from './registry';
import { webSearchTool } from './web';
import { kindForTool, type ToolExecutionKind } from './executor';

export * from './registry';
export * from './executor';

/** 顺序即下发顺序，与原 route.ts 里的工具数组保持一致。 */
export const TOOL_REGISTRY: readonly ToolDefinition[] = [
  documentGenerateTool,
  spreadsheetGenerateTool,
  presentationGenerateTool,
  imageGenerateTool,
  imageEditTool,
  fileGenerateTool,
  archiveGenerateTool,
  webSearchTool,
  skillSearchTool,
  skillReadTool,
  skillInstallTool,
  mcpManageTool,
];

const TOOL_BY_NAME = new Map(TOOL_REGISTRY.map((tool) => [tool.name, tool]));

export function getToolDefinition(name: unknown): ToolDefinition | null {
  return TOOL_BY_NAME.get(String(name || '')) || null;
}

/** 工具的执行类别（由注册表标签推导）；未登记或没有类别时返回 null。 */
export function toolExecutionKind(name: unknown, extraTools: readonly ToolDefinition[] = []): ToolExecutionKind | null {
  const definition = findToolDefinition(name, extraTools);
  return definition ? kindForTool(definition) : null;
}

export function toolSource(name: unknown): ToolSource | null {
  return getToolDefinition(name)?.source || null;
}

export function toolPermissions(name: unknown): readonly ToolPermissions[] {
  return getToolDefinition(name)?.permissions || [];
}

export function toolTags(name: unknown): readonly ToolTag[] {
  return getToolDefinition(name)?.tags || [];
}

/**
 * 本轮要下发给模型的工具。门控全部来自注册表：没登录的工具不会因为新增代码而
 * 意外暴露给模型，这是之前 route.ts 里那段 if 链最容易出错的地方。
 */
export function toolSchemasFor(context: ToolGatingContext, extraTools: readonly ToolDefinition[] = []): ModelToolSchema[] {
  return [...TOOL_REGISTRY, ...extraTools].filter((tool) => tool.gating(context)).map(toModelToolSchema);
}

function callToolName(call: any) {
  return String(call?.function?.name || '');
}

/** 内置工具之外还有 MCP 这类运行时工具，查找要带上本轮附加上来的定义。 */
export function findToolDefinition(name: unknown, extraTools: readonly ToolDefinition[] = []): ToolDefinition | null {
  const toolName = String(name || '');
  return getToolDefinition(toolName) || extraTools.find((tool) => tool.name === toolName) || null;
}

function hasTag(name: unknown, tag: ToolTag, extraTools: readonly ToolDefinition[] = []) {
  return (findToolDefinition(name, extraTools)?.tags || []).includes(tag);
}

export function isArtifactToolCall(call: any) {
  return hasTag(callToolName(call), 'artifact');
}

export function isArchiveToolCall(call: any) {
  return hasTag(callToolName(call), 'archive');
}

export function isImageToolCall(call: any) {
  return hasTag(callToolName(call), 'image');
}

export function isSkillToolCall(call: any) {
  return hasTag(callToolName(call), 'skill');
}

export function isMcpToolCall(call: any, extraTools: readonly ToolDefinition[] = []) {
  return findToolDefinition(callToolName(call), extraTools)?.source === 'mcp';
}
