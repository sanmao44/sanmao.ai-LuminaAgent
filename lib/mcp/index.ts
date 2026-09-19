/**
 * MCP 模块出口：store（配置）、client（协议）、tools（注册表翻译）。
 * 应用代码按需从具体文件导入，这里主要给测试和后续插件层一个稳定入口。
 */

export {
  MCP_PROTOCOL_VERSION,
  MCP_TOOL_MAX_CALLS_PER_TURN,
  MCP_TURN_TIME_BUDGET_MS,
  McpError,
  callMcpTool,
  listMcpServerTools,
  probeMcpServer,
  resetMcpSessions,
} from './client';
export {
  MCP_MAX_SERVERS,
  listMcpServers,
  normalizeMcpServerId,
  normalizeMcpServerInput,
  normalizeMcpServerUrl,
  patchMcpServer,
  redactMcpServer,
  removeMcpServer,
  resolveMcpStoreFile,
  saveMcpServers,
  upsertMcpServer,
} from './store';
export {
  MCP_TOOL_CACHE_TTL_MS,
  MCP_TOOL_SEPARATOR,
  clearMcpToolCache,
  isMcpReadOnlyTool,
  isMcpToolSchemaTooLarge,
  loadMcpToolDefinitions,
  loadMcpToolRuntime,
  mcpToolDefinitions,
  mcpToolId,
} from './tools';
export type { McpRemoteTool, McpServerConfig, McpToolMeta } from './types';
