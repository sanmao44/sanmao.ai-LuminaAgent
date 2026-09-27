import { loadMcpToolRuntime } from './tools';
import type { McpServerConfig } from './types';

export type McpCapability = {
  id: string;
  name: string;
  tools: Array<{ name: string; description: string; readOnly: boolean; blocked: boolean }>;
};

/** Discovery is read-only. A model can select existing IDs, never grant permissions. */
export async function discoverMcpForRequest(options: {
  servers: readonly McpServerConfig[];
  signal?: AbortSignal;
  select: (capabilities: McpCapability[]) => Promise<unknown>;
  load?: typeof loadMcpToolRuntime;
}) {
  const servers = options.servers.filter((server) => server.enabled);
  const load = options.load || loadMcpToolRuntime;
  const runtimes = await Promise.all(servers.map((server) => load({
    servers: [server], signal: options.signal, timeouts: { init: 10_000, list: 10_000 },
  })));
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
  const result = await options.select(capabilities);
  options.signal?.throwIfAborted();
  if (!Array.isArray(result) || result.some((id) => typeof id !== 'string' || !capabilities.some((item) => item.id === id))) {
    throw new Error('MCP 能力选择结果无效，尚未执行操作，请重试或切换模型');
  }
  return {
    serverIds: [...new Set(result as string[])],
    unavailable: servers.filter((server) => !capabilities.some((item) => item.id === server.id)).map((server) => server.name),
  };
}
