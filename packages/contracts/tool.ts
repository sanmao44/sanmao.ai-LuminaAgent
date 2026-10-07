import type { McpToolMeta } from './mcp';

export type ToolPermissions = 'network' | 'artifact:read' | 'artifact:write' | 'fs:read' | 'fs:write' | 'external:write' | 'process';
export type ToolSource = 'native' | 'mcp' | 'plugin';
export type ToolTag = 'artifact' | 'archive' | 'image' | 'file' | 'web' | 'skill' | 'tabbit' | 'mcp' | 'mcp-admin' | 'canvas';
export type ToolRisk = 'read' | 'write' | 'external_side_effect' | 'dangerous';

export type ToolGatingContext = {
  fileGeneration: boolean;
  deliveryRequest: boolean;
  skillsEnabled: boolean;
  imageAllowed: boolean;
  mcpAdmin: boolean;
  canvas: boolean;
};

export type ToolDefinition = {
  id: string;
  name: string;
  description: string;
  schema: Record<string, unknown>;
  permissions: readonly ToolPermissions[];
  tags: readonly ToolTag[];
  source: ToolSource;
  risk: ToolRisk;
  gating: (context: ToolGatingContext) => boolean;
  enabled?: boolean;
  acceptUnlisted?: boolean;
  mcp?: McpToolMeta;
};

export type ToolPolicyDecision = {
  allowed: boolean;
  reason: string;
  name: string;
  source: ToolSource | null;
  permissions: readonly ToolPermissions[];
  tool: ToolDefinition | null;
};

export type ToolPolicyResolver = (name: unknown, context: ToolGatingContext, extraTools?: readonly ToolDefinition[]) => ToolPolicyDecision;

/** Safe fallback resolver used by isolated runtime tests; production injects the full registry resolver. */
export const resolveExtraToolPolicy: ToolPolicyResolver = (name, context, extraTools = []) => {
  const toolName = String(name || '').trim();
  const tool = extraTools.find((candidate) => candidate.name === toolName) || null;
  if (!tool) return { allowed: false, reason: `未知工具 ${toolName || '(空)'}`, name: toolName, source: null, permissions: [], tool: null };
  if (tool.mcp?.blocked) return { allowed: false, reason: tool.mcp.blockedReason || `MCP 工具 ${tool.name} 当前被阻止`, name: toolName, source: tool.source, permissions: tool.permissions, tool };
  if (!tool.acceptUnlisted && !tool.gating(context)) return { allowed: false, reason: `本轮没有下发工具 ${toolName}`, name: toolName, source: tool.source, permissions: tool.permissions, tool };
  return { allowed: true, reason: '', name: toolName, source: tool.source, permissions: tool.permissions, tool };
};

export function parseToolArguments(value: unknown): unknown {
  try { return JSON.parse(String(value || '{}')); } catch { return {}; }
}
