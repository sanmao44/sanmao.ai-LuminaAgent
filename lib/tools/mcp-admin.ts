import { defineTool, TOOL_GATE } from './registry';

/**
 * 让助手能自己接入 MCP 服务，而不是只能让用户去面板手填地址和凭据。
 *
 * 下发条件由本地意图判断决定（context.mcpAdmin）；真正的授权校验在 lib/mcp/admin.ts，
 * 「打开写入权限」「删除服务」必须能在用户原话里找到依据，模型自己说了不算。
 */
export const mcpManageTool = defineTool({
  name: 'mcp_manage',
  description: '管理本机已配置的 MCP 服务：列出服务（list）、连接自检（probe）、添加（add）、修改开关或工具范围（update）、删除（remove）。只在用户明确要求接入、查看、修改或移除 MCP 服务时调用；这不是查询外部数据的工具，接入后的服务会以下一轮的 <serverId>__<toolName> 工具出现。删除服务和开启写入权限需要用户明确同意，被拒绝时如实转告，不要绕过。',
  permissions: ['network', 'fs:write'],
  tags: ['mcp-admin'],
  source: 'native',
  gating: TOOL_GATE.mcpAdmin,
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'probe', 'add', 'update', 'remove'], description: '要执行的动作。' },
      id: { type: 'string', description: '服务 id 或名称（probe / update / remove 必填）。' },
      name: { type: 'string', description: 'add 时的服务名称，例如 GitHub。' },
      url: { type: 'string', description: 'add 时的地址，必须是 Streamable HTTP 端点，例如 https://example.com/mcp。' },
      headers: { type: 'object', description: '可选请求头，例如 {"Authorization":"Bearer …"}。只填用户确实提供过的凭据，不要编造。' },
      allowWrite: { type: 'boolean', description: '是否有副作用的工具也放行。只有用户明确同意（例如说“允许写入”）时才传 true。' },
      enabled: { type: 'boolean', description: 'update 时启用或停用这个服务。' },
      enabledTools: { type: 'array', items: { type: 'string' }, description: 'update 时只放行这些工具名；留空表示放行全部。' },
    },
    required: ['action'],
  },
});
