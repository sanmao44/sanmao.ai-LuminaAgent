import { findToolDefinition } from './index';
import type { ToolDefinition, ToolGatingContext, ToolPermissions, ToolSource } from './registry';

/**
 * 统一执行点：每次工具调用前唯一的一道权限判断，native 与 MCP 走同一条路。
 *
 * v1 的规则很窄，但每条都能说清来源：
 * - 名字不在注册表里 → 拒绝（模型不该调用没声明的工具）。
 * - 本轮门控没通过 → 拒绝（这个工具这轮根本没下发给模型），除非它声明了 acceptUnlisted。
 * - MCP 写入类工具而服务没打开「允许写入」→ 拒绝。
 */
export type ToolPolicyDecision = {
  allowed: boolean;
  reason: string;
  name: string;
  source: ToolSource | null;
  permissions: readonly ToolPermissions[];
  tool: ToolDefinition | null;
};

export function resolveToolPolicy(
  name: unknown,
  context: ToolGatingContext,
  extraTools: readonly ToolDefinition[] = [],
): ToolPolicyDecision {
  const toolName = String(name || '').trim();
  const tool = findToolDefinition(toolName, extraTools);
  if (!tool) {
    return {
      allowed: false,
      reason: `未知工具 ${toolName || '(空)'}：不要调用没有声明的工具，用已有信息回答或请用户确认。`,
      name: toolName,
      source: null,
      permissions: [],
      tool: null,
    };
  }
  const base = { name: toolName, source: tool.source, permissions: tool.permissions, tool };
  if (tool.mcp?.blocked) {
    return {
      ...base,
      allowed: false,
      // 目录条目（GitHub）会给出更具体的理由，例如要打开哪一项写权限；其余服务沿用这句话。
      reason: tool.mcp.blockedReason
        || `MCP 工具 ${tool.name} 会改动外部数据，需要先在 MCP 面板为「${tool.mcp.serverName}」打开「允许写入」才能调用。`,
    };
  }
  if (!tool.acceptUnlisted && !tool.gating(context)) {
    return {
      ...base,
      allowed: false,
      reason: `本轮没有下发工具 ${toolName}：用户这一轮没有这个需求。需要的话先说明用途，让用户确认后再执行。`,
    };
  }
  return { ...base, allowed: true, reason: '' };
}
