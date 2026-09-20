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
  description: '管理本机已配置的 MCP 服务：列出服务（list）、连接自检（probe）、添加（add）、修改开关、工具范围或按需下发（update）、删除（remove）。另外可以查看本机「本地工具运行时」（runtime_status，目前是浏览器控制），并在用户明确要求时启停（runtime_start / runtime_stop）；安装只能由用户在面板上点，你不能自己装。只在用户明确要求接入、查看、修改或移除 MCP 服务，或明确要求查看、启停本地运行时时调用；这不是查询外部数据的工具，接入后的服务会以下一轮的 <serverId>__<toolName> 工具出现。删除服务、开启写入权限和启停本地运行时都需要用户明确同意，被拒绝时如实转告，不要绕过。',
  permissions: ['network', 'fs:write'],
  tags: ['mcp-admin'],
  source: 'native',
  gating: TOOL_GATE.mcpAdmin,
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'probe', 'add', 'update', 'remove', 'runtime_status', 'runtime_start', 'runtime_stop'], description: '要执行的动作。runtime_status / runtime_start / runtime_stop 针对本机「本地工具运行时」（目前是浏览器控制）：先查状态，用户明确要求时再启停；安装只能由用户在面板上点。' },
      id: { type: 'string', description: '服务 id 或名称（probe / update / remove 必填；runtime_start / runtime_stop 可留空，默认操作浏览器控制）。' },
      name: { type: 'string', description: 'add 时的服务名称，例如 GitHub。' },
      url: { type: 'string', description: 'add 时的地址，必须是 Streamable HTTP 端点，例如 https://example.com/mcp。' },
      headers: { type: 'object', description: '可选请求头，例如 {"Authorization":"Bearer …"}。只填用户确实提供过的凭据，不要编造。' },
      allowWrite: { type: 'boolean', description: '是否有副作用的工具也放行。只有用户明确同意（例如说“允许写入”）时才传 true。' },
      enabled: { type: 'boolean', description: 'update 时启用或停用这个服务。' },
      enabledTools: { type: 'array', items: { type: 'string' }, description: 'update 时只放行这些工具名；留空表示放行全部。' },
      lazy: { type: 'boolean', description: 'update 时是否「按需下发」这个服务的工具：打开后只有这一轮提到这个服务才会挂上它的工具，适合工具很多的服务；关闭表示每轮都下发。' },
    },
    required: ['action'],
  },
});
