/**
 * MCP（Model Context Protocol）接入的类型定义。
 *
 * 两种传输：
 * - http（默认）：远程 Streamable HTTP 服务，用户自己填地址和凭据。
 * - stdio：本机子进程，只允许来自代码里写死的 curated 目录（见 lib/mcp/catalog.ts），
 *   普通用户不能填命令，也就不会把「执行任意命令」这条攻击面引进来。
 * 字段对齐 MCP 规范 2025-06-18。
 */

export type McpServerTransport = 'http' | 'stdio';

export type McpServerConfig = {
  id: string;
  name: string;
  url: string;
  /** 默认 http；stdio 只由 curated 目录构造。 */
  transport?: McpServerTransport;
  enabled: boolean;
  /** 允许执行有副作用的工具；关闭时只有 annotations.readOnlyHint 为真的工具放行。 */
  allowWrite: boolean;
  /** 附加请求头（通常是 Authorization），属于密钥，对外只回传键名。 */
  headers?: Record<string, string>;
  /** 只放行这些工具名；空数组表示放行该服务公布的全部工具。 */
  enabledTools?: string[];
  /**
   * 按需下发：打开后只有这一轮提到这个服务（服务名或工具名）才把它的工具挂给模型。
   * 默认关闭——用户主动接进来的服务突然不给他用才是 bug。
   */
  lazy?: boolean;
  /** stdio 专用：可执行文件的绝对路径（禁止靠 PATH 解析）。 */
  command?: string;
  /** stdio 专用：启动参数，与 command 分开传，永远不拼接成一条命令串。 */
  args?: string[];
  /** stdio 专用：额外环境变量。 */
  env?: Record<string, string>;
  /** stdio 专用：子进程的工作目录。浏览器服务就靠它把可见范围限制在一个受控目录里。 */
  cwd?: string;
  /** stdio 专用：来自 curated 目录的条目 id，用于面板显示与配置校验。 */
  catalogId?: string;
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
  /** 拒绝时给用户看的理由（比默认那句话更具体，例如「需要先打开写权限里的创建 Issue」）。 */
  blockedReason?: string;
};
