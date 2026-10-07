import { defineTool, nativeToolId, TOOL_GATE } from './registry';

/**
 * 让助手能自己接入 MCP 服务，而不是只能让用户去面板手填地址和凭据。
 *
 * 下发条件由本地意图判断决定（context.mcpAdmin）；真正的授权校验在 lib/mcp/admin.ts，
 * 「打开写入权限」「删除服务」必须能在用户原话里找到依据，模型自己说了不算。
 */
export const mcpManageTool = defineTool({
  id: nativeToolId('mcp_manage'),
  // 能删服务、能放开第三方写入权限，交给审批链路兜底最稳。
  risk: 'dangerous',
  name: 'mcp_manage',
  description: '管理本机 MCP 服务：可以列出、自检、修改和删除已配置服务，也可以把用户明确提供的 GitHub MCP 仓库下载、安装、启动并自检（install_from_repo）。GitHub 仓库安装只接受用户原话里的仓库地址，安装到应用数据目录，默认只读；不会执行 README 命令。另可查看或启停受控本地运行时。只在用户明确要求接入、安装、查看、修改或移除 MCP 服务时调用；接入后的服务会在下一轮对话出现。',
  permissions: ['network', 'fs:write'],
  tags: ['mcp-admin'],
  source: 'native',
  gating: TOOL_GATE.mcpAdmin,
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'probe', 'add', 'update', 'remove', 'install_from_repo', 'runtime_status', 'runtime_start', 'runtime_stop'], description: '要执行的动作。install_from_repo 用用户提供的 GitHub 仓库地址安装 MCP；runtime_* 针对受控本地运行时。' },
      id: { type: 'string', description: '服务 id 或名称（probe / update / remove 必填；runtime_start / runtime_stop 可留空，默认操作浏览器控制）。' },
      name: { type: 'string', description: 'add 时的服务名称，例如 GitHub。' },
      url: { type: 'string', description: 'add 时的地址，必须是 Streamable HTTP 端点，例如 https://example.com/mcp。' },
      repo: { type: 'string', description: 'install_from_repo 时的 GitHub 仓库地址，例如 https://github.com/owner/repo。只能使用用户原话里出现的地址。' },
      headers: { type: 'object', description: '可选请求头，例如 {"Authorization":"Bearer …"}。只填用户确实提供过的凭据，不要编造。' },
      allowWrite: { type: 'boolean', description: '是否有副作用的工具也放行。只有用户明确同意（例如说“允许写入”）时才传 true。' },
      enabled: { type: 'boolean', description: 'update 时启用或停用这个服务。' },
      enabledTools: { type: 'array', items: { type: 'string' }, description: 'update 时只放行这些工具名；留空表示放行全部。' },
      lazy: { type: 'boolean', description: 'update 时是否「按需下发」这个服务的工具：打开后只有这一轮提到这个服务才会挂上它的工具，适合工具很多的服务；关闭表示每轮都下发。' },
    },
    required: ['action'],
  },
});
