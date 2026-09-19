import { archiveGenerateTool, documentGenerateTool, presentationGenerateTool, spreadsheetGenerateTool } from './artifacts';
import { fileGenerateTool } from './file';
import { imageEditTool, imageGenerateTool } from './image';
import { skillInstallTool, skillReadTool, skillSearchTool } from './skills';
import { toModelToolSchema, type ModelToolSchema, type ToolDefinition, type ToolGatingContext, type ToolPermissions, type ToolSource, type ToolTag } from './registry';
import { webSearchTool } from './web';

export * from './registry';

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
];

const TOOL_BY_NAME = new Map(TOOL_REGISTRY.map((tool) => [tool.name, tool]));

export function getToolDefinition(name: unknown): ToolDefinition | null {
  return TOOL_BY_NAME.get(String(name || '')) || null;
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
export function toolSchemasFor(context: ToolGatingContext): ModelToolSchema[] {
  return TOOL_REGISTRY.filter((tool) => tool.gating(context)).map(toModelToolSchema);
}

function callToolName(call: any) {
  return String(call?.function?.name || '');
}

function hasTag(name: unknown, tag: ToolTag) {
  return toolTags(name).includes(tag);
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
