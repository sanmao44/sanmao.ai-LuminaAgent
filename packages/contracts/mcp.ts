export type McpServerTransport = 'http' | 'stdio';

export type McpServerConfig = {
  id: string;
  name: string;
  url: string;
  transport?: McpServerTransport;
  enabled: boolean;
  allowWrite: boolean;
  headers?: Record<string, string>;
  enabledTools?: string[];
  lazy?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  catalogId?: string;
  managedRepo?: { owner: string; repo: string; ref: string; url: string };
};

export type McpToolMeta = {
  serverId: string;
  serverName: string;
  toolName: string;
  readOnly: boolean;
  blocked: boolean;
  blockedReason?: string;
};

export type McpCallResult = {
  isError: boolean;
  text: string;
  errorCode?: 'FILESYSTEM_INVALID_TEXT_RANGE';
  fileTextEvidence?: false;
};

/** Internal record for one reviewed edit to an authorized local file. */
export type FilesystemEditApproval = {
  target: string;
  baseSha256: string;
  resultSha256: string;
  diff: string;
};

/** Server-only reverse changes for one committed edit. Offsets use the original JS string units. */
export type FilesystemEditUndo = Omit<FilesystemEditApproval, 'diff'> & {
  changes: Array<{ offset: number; removed: string; insertedLength: number }>;
};
