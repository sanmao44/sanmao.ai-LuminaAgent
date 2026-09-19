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
  catalogEntryAccount,
  catalogEntryAllowWrite,
  catalogEntryAuthRequired,
  catalogEntryBinPath,
  catalogEntryEnabled,
  catalogEntryError,
  catalogEntryReady,
  catalogEntryToolsets,
  catalogEntryWriteGates,
  catalogServerConfig,
  catalogWritePolicy,
  catalogWriteToolProblem,
  clearCatalogEntryWriteGates,
  detectSystemBrowser,
  findCatalogEntry,
  isCatalogInstalled,
  isRemoteCatalogEntry,
  isStdioCatalogEntry,
  listCatalogServers,
  readCatalogState,
  recordCatalogEntryError,
  remoteCatalogEntries,
  requireStdioCatalogEntry,
  resolveCatalogInstallRoot,
  resolveCatalogStateFile,
  resolveCatalogWorkspace,
  setCatalogEntryAccount,
  setCatalogEntryAllowWrite,
  setCatalogEntryAuthRequired,
  setCatalogEntryEnabled,
  setCatalogEntryToolset,
  setCatalogEntryWriteGate,
  stdioCatalogEntries,
} from './catalog';
export type {
  McpCatalogAuth,
  McpCatalogBrowser,
  McpCatalogEntry,
  McpCatalogToolset,
  McpCatalogWriteGate,
  McpCatalogWritePolicy,
  McpCatalogInstallMode,
  McpCatalogState,
  McpCatalogStateEntry,
  McpCatalogTransport,
  McpCatalogTrust,
  McpRemoteCatalogEntry,
  McpStdioCatalogEntry,
} from './catalog';
export {
  catalogEntryState,
  configureRemoteCatalogEntry,
  connectRemoteCatalogEntry,
  disconnectRemoteCatalogEntry,
  findRemoteCatalogServer,
  isCatalogEntryConnecting,
  remoteCatalogConnectionState,
  remoteCatalogDefaultHeaders,
  setRemoteCatalogToolset,
} from './catalog-remote';
export type { McpCatalogConnectionState, McpCatalogRemoteOptions } from './catalog-remote';
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
  MCP_LAZY_KEYWORD_LIMIT,
  MCP_MAX_SCHEMA_CHARS_PER_TURN,
  MCP_MAX_TOOL_DEFINITIONS_PER_TURN,
  MCP_TOOL_CACHE_TTL_MS,
  MCP_TOOL_SEPARATOR,
  boundMcpToolPayload,
  clearMcpToolCache,
  isMcpReadOnlyTool,
  isMcpToolSchemaTooLarge,
  lazyMcpGroupKeywords,
  loadMcpToolDefinitions,
  loadMcpToolRuntime,
  mcpToolDefinitions,
  mcpToolId,
} from './tools';
export {
  MCP_MAX_FILESYSTEM_ROOTS,
  addFilesystemRoot,
  filesystemRootsDataDir,
  isPathInside,
  listFilesystemRoots,
  normalizeFilesystemRoot,
  removeFilesystemRoot,
  resolveFilesystemRootsFile,
  suggestFilesystemRoots,
  samePath,
} from './filesystem-roots';
export {
  MCP_FILESYSTEM_PATH_KEYS,
  filesystemApprovalReason,
  filesystemPathProblem,
  guardFilesystemCall,
  guardMcpServerCall,
  guardUploadCall,
  uploadSourceDirs,
} from './filesystem-policy';
export {
  BROWSER_DOWNLOAD_MAX_BYTES,
  importBrowserArtifacts,
  resetBrowserArtifactImports,
  resolveBrowserDownloadDir,
} from './browser-downloads';
export type { BrowserArtifactFile, ImportBrowserArtifactsOptions } from './browser-downloads';
export { MCP_ADMIN_ACTIONS, runMcpManageAction } from './admin';
export { MCP_RUNTIME_ACTIONS, isMcpRuntimeAction, runMcpRuntimeAction } from './runtime-admin';
export type { McpRuntimeAction, McpRuntimeOutcome } from './runtime-admin';
export type { McpAdminAction, McpManageOptions, McpManageOutcome } from './admin';
export type { McpRemoteTool, McpServerConfig, McpToolMeta } from './types';
