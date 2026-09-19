/**
 * Agent 工具注册表：把「工具是谁」从 app/api/agent/route.ts 里抽出来，
 * Agent 只负责编排，工具只负责声明自己的 schema、权限和下发条件。
 *
 * 字段刻意对齐 MCP 的 Tool（name / description / inputSchema）和 Vercel AI SDK 的 Tool
 * （description / inputSchema / execute / contextSchema），以后接 MCP 或插件工具时不用再转一层结构。
 */

import type { McpToolMeta } from '@/lib/mcp/types';

/** 工具会碰到的外部资源；v1 只做声明与审计，真正的拦截放在统一执行点。 */
export type ToolPermissions =
  | 'network'
  | 'artifact:read'
  | 'artifact:write'
  | 'fs:read'
  | 'fs:write'
  /** 会改动本机以外的数据（MCP 远程工具、以后的插件）。 */
  | 'external:write'
  | 'process';

/** 工具来源：native 内置、mcp 远程服务、plugin 插件清单。 */
export type ToolSource = 'native' | 'mcp' | 'plugin';

/** 能力标签：供 Agent 侧做行为分支，不参与下发判断。 */
export type ToolTag = 'artifact' | 'archive' | 'image' | 'file' | 'web' | 'skill' | 'mcp' | 'mcp-admin';

/**
 * 工具风险等级，口径按任务书 §9：
 * - read：只读，没有任何副作用。
 * - write：只在本机产生数据（写产物、写配置），不碰外部系统。
 * - external_side_effect：会改变本机以外的东西（提交表单、发消息、调用付费生成接口）。
 * - dangerous：可能造成不可逆损失（执行命令、删除数据、发布、付款）。
 *
 * v1 只做声明与审计，真正的「危险操作要用户确认」由 Milestone E 的审批链路落地。
 */
export type ToolRisk = 'read' | 'write' | 'external_side_effect' | 'dangerous';

export const TOOL_RISK_ORDER: readonly ToolRisk[] = ['read', 'write', 'external_side_effect', 'dangerous'];

/** 需要用户确认才执行的风险等级。 */
export function isRiskyTool(risk: ToolRisk) {
  return risk === 'external_side_effect' || risk === 'dangerous';
}

/** 本轮上下文：决定哪些工具能下发给模型。 */
export type ToolGatingContext = {
  /** 用户本轮要求生成文件（file_generate）。 */
  fileGeneration: boolean;
  /** 用户本轮要求交付 Word / Excel / PPT / ZIP。 */
  deliveryRequest: boolean;
  /** 技能功能已启用。 */
  skillsEnabled: boolean;
  /** 本轮允许调用图片工具。 */
  imageAllowed: boolean;
  /** 本轮用户明确在说 MCP 服务的接入、查看或开关。 */
  mcpAdmin: boolean;
};

export type ToolDefinition = {
  /**
   * 运行时唯一 id，与「模型看到的名字」解耦：
   * native 工具是 native:<name>，MCP 工具是 mcp:<serverId>:<toolName>。
   * 名字以后可能会为了防冲突而改写，id 不会变，审计和日志都认它。
   */
  id: string;
  /** 下发给模型的 function name，必须唯一且只含 [A-Za-z0-9_-]。 */
  name: string;
  description: string;
  /** JSON Schema，与 MCP 的 inputSchema 同形；下发时直接当 function.parameters。 */
  schema: Record<string, unknown>;
  permissions: readonly ToolPermissions[];
  tags: readonly ToolTag[];
  source: ToolSource;
  /** 风险等级；决定以后要不要走用户确认。 */
  risk: ToolRisk;
  /** 本轮是否下发；默认拒绝，每个工具都必须显式声明。 */
  gating: (context: ToolGatingContext) => boolean;
  /** 默认 true；置 false 表示运行时禁用：不下发，也拒绝执行。 */
  enabled?: boolean;
  /**
   * 模型看不到这个工具（gating 为假），但执行层仍然接受调用。
   * 只有「调用时机由本地先决策」的工具才该打开，目前是 web_search：
   * 联网与否在请求模型之前就判断完了，工具分支只是模型跑偏时的兜底。
   */
  acceptUnlisted?: boolean;
  /** 远程 MCP 工具的溯源信息；native 工具没有这一项。 */
  mcp?: McpToolMeta;
};

export const TOOL_GATE = {
  /** 永远不下发：联网由本地先判断，模型不参与。 */
  never: () => false,
  /** 生成文件时下发；交付物请求也算文件生成。 */
  file: (context: ToolGatingContext) => context.fileGeneration || context.deliveryRequest,
  /** 只有本轮要交付 Word / Excel / PPT / ZIP 时下发。 */
  delivery: (context: ToolGatingContext) => context.deliveryRequest,
  /** 只有本轮明确允许图片操作时下发。 */
  image: (context: ToolGatingContext) => context.imageAllowed,
  /** 只有技能功能启用时下发。 */
  skills: (context: ToolGatingContext) => context.skillsEnabled,
  /** 只有本轮在谈 MCP 服务管理时下发。 */
  mcpAdmin: (context: ToolGatingContext) => context.mcpAdmin,
} satisfies Record<string, (context: ToolGatingContext) => boolean>;

export function defineTool<const T extends ToolDefinition>(definition: T) {
  return definition;
}

/** native 工具 id 的统一写法，避免手写字符串各写各的。 */
export function nativeToolId(name: string) {
  return `native:${name}`;
}

/** 模型调用工具时可能带上非 ASCII 字符或超长名字，这里统一挡掉。 */
export function isValidToolName(name: string) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(name);
}

/** OpenAI 兼容的 function 工具结构，服务商侧只认这个形状。 */
export type ModelToolSchema = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export function toModelToolSchema(definition: ToolDefinition): ModelToolSchema {
  return {
    type: 'function',
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.schema,
    },
  };
}
