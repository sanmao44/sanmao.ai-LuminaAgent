import { loadMcpToolRuntime } from './tools';
import type { McpServerConfig } from './types';

export type McpCapability = {
  id: string;
  name: string;
  tools: Array<{ name: string; description: string; readOnly: boolean; blocked: boolean }>;
};

const MCP_DISCOVERY_SERVER_TIMEOUT_MS = 4_000;
const MCP_DISCOVERY_SELECT_TIMEOUT_MS = 6_000;

async function withTimeout<T>(task: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('MCP capability discovery timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Discovery is read-only. A model can select existing IDs, never grant permissions. */
export async function discoverMcpForRequest(options: {
  servers: readonly McpServerConfig[];
  signal?: AbortSignal;
  select: (capabilities: McpCapability[]) => Promise<unknown>;
  load?: typeof loadMcpToolRuntime;
}) {
  const servers = options.servers.filter((server) => server.enabled);
  const load = options.load || loadMcpToolRuntime;
  type McpRuntime = Awaited<ReturnType<typeof loadMcpToolRuntime>>;
  const runtimes = await Promise.all(servers.map(async (server): Promise<McpRuntime> => {
    try {
      return await withTimeout(load({
        servers: [server], signal: options.signal, timeouts: { init: 4_000, list: 4_000 },
      }), MCP_DISCOVERY_SERVER_TIMEOUT_MS);
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason || error;
      return { servers: [], tools: [] } as McpRuntime;
    }
  }));
  options.signal?.throwIfAborted();
  const capabilities = runtimes.flatMap((runtime, index) => runtime.tools.length ? [{
    id: servers[index].id,
    name: servers[index].name,
    tools: runtime.tools.map((tool) => ({
      name: tool.mcp!.toolName,
      description: tool.description.slice(0, 360),
      readOnly: tool.mcp!.readOnly,
      blocked: tool.mcp!.blocked,
    })),
  }] : []);
  if (!capabilities.length) return { serverIds: [] as string[], unavailable: servers.map((server) => server.name) };
  const result = capabilities.length === 1
    ? [capabilities[0].id]
    : await withTimeout(options.select(capabilities), MCP_DISCOVERY_SELECT_TIMEOUT_MS);
  options.signal?.throwIfAborted();
  if (!Array.isArray(result) || result.some((id) => typeof id !== 'string' || !capabilities.some((item) => item.id === id))) {
    throw new Error('MCP 能力选择结果无效，尚未执行操作，请重试或切换模型');
  }
  return {
    serverIds: [...new Set(result as string[])],
    unavailable: servers.filter((server) => !capabilities.some((item) => item.id === server.id)).map((server) => server.name),
  };
}
