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
