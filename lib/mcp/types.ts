/**
 * MCP（Model Context Protocol）接入的类型定义。
 *
 * v1 只支持远程 Streamable HTTP 服务：不拉起本地进程，用户机器上不需要装 Node/npx，
 * 也不会把「执行任意命令」这条攻击面引进来。字段对齐 MCP 规范 2025-06-18。
 */

export type McpServerConfig = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  /** 允许执行有副作用的工具；关闭时只有 annotations.readOnlyHint 为真的工具放行。 */
  allowWrite: boolean;
  /** 附加请求头（通常是 Authorization），属于密钥，对外只回传键名。 */
  headers?: Record<string, string>;
  /** 只放行这些工具名；空数组表示放行该服务公布的全部工具。 */
  enabledTools?: string[];
};

/** MCP 服务公布的单个工具，字段与规范一致。 */
export type McpRemoteTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

/** 注册进工具表时带上的溯源信息，执行时要靠它找回服务和原始工具名。 */
export type McpToolMeta = {
  serverId: string;
  serverName: string;
  toolName: string;
  readOnly: boolean;
  /** 有副作用、但服务没打开「允许写入」，调用前应直接拒绝。 */
  blocked: boolean;
};
