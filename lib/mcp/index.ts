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
  MCP_STDIO_IDLE_TIMEOUT_MS,
  MCP_STDIO_MAX_STDERR_CHARS,
  closeStdioServer,
  stdioCommandProblem,
  stdioServerStatus,
} from './stdio';
export type { McpStdioStatus } from './stdio';
export {
  MCP_CATALOG_ENTRIES,
  catalogEntryBinPath,
  catalogEntryEnabled,
  catalogServerConfig,
  detectSystemBrowser,
  findCatalogEntry,
  isCatalogInstalled,
  listCatalogServers,
  readCatalogState,
  resolveCatalogInstallRoot,
  resolveCatalogStateFile,
  resolveCatalogWorkspace,
  setCatalogEntryEnabled,
} from './catalog';
export type { McpCatalogBrowser, McpCatalogEntry } from './catalog';
export {
  MCP_CATALOG_INSTALL_TIMEOUT_MS,
  cancelCatalogInstall,
  catalogRuntimeStatus,
  installCatalogServer,
  resolveCatalogInstallLogFile,
  resolveNpmCliPath,
  startCatalogServer,
  stopCatalogServer,
} from './catalog-runtime';
export type { McpCatalogRuntimeState, McpCatalogRuntimeStatus } from './catalog-runtime';
export {
  MCP_MAX_SCHEMA_CHARS_PER_TURN,
  MCP_MAX_TOOL_DEFINITIONS_PER_TURN,
  MCP_TOOL_CACHE_TTL_MS,
  MCP_TOOL_SEPARATOR,
  boundMcpToolPayload,
  clearMcpToolCache,
  isMcpReadOnlyTool,
  isMcpToolSchemaTooLarge,
  loadMcpToolDefinitions,
  loadMcpToolRuntime,
  mcpToolDefinitions,
  mcpToolId,
} from './tools';
export { MCP_ADMIN_ACTIONS, runMcpManageAction } from './admin';
export type { McpAdminAction, McpManageOptions, McpManageOutcome } from './admin';
export type { McpRemoteTool, McpServerConfig, McpToolMeta } from './types';
