/**
 * Agent 工具注册表：把「工具是谁」从 app/api/agent/route.ts 里抽出来，
 * Agent 只负责编排，工具只负责声明自己的 schema、权限和下发条件。
 *
 * 字段刻意对齐 MCP 的 Tool（name / description / inputSchema）和 Vercel AI SDK 的 Tool
 * （description / inputSchema / execute / contextSchema），以后接 MCP 或插件工具时不用再转一层结构。
 */

/** 工具会碰到的外部资源；v1 只做声明与审计，真正的拦截放在统一执行点。 */
export type ToolPermissions =
  | 'network'
  | 'artifact:read'
  | 'artifact:write'
  | 'fs:read'
  | 'fs:write'
  | 'process';

/** 工具来源：native 内置、mcp 远程服务、plugin 插件清单。 */
export type ToolSource = 'native' | 'mcp' | 'plugin';

/** 能力标签：供 Agent 侧做行为分支，不参与下发判断。 */
export type ToolTag = 'artifact' | 'archive' | 'image' | 'file' | 'web' | 'skill';

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
};

export type ToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema，与 MCP 的 inputSchema 同形；下发时直接当 function.parameters。 */
  schema: Record<string, unknown>;
  permissions: readonly ToolPermissions[];
  tags: readonly ToolTag[];
  source: ToolSource;
  /** 本轮是否下发；默认拒绝，每个工具都必须显式声明。 */
  gating: (context: ToolGatingContext) => boolean;
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
} satisfies Record<string, (context: ToolGatingContext) => boolean>;

export function defineTool<const T extends ToolDefinition>(definition: T) {
  return definition;
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
