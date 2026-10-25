import { defineTool } from './registry';

/**
 * Tabbit is a local browser-owned backend, not a Playwright Extension MCP
 * server. It is attached dynamically only for browser turns when the stable
 * Tabbit launcher is present.
 */
export const tabbitBrowserTool = defineTool({
  id: 'mcp:tabbit:browser',
  name: 'tabbit_browser',
  description: '使用 Tabbit 原生 CLI 控制用户的 Tabbit 浏览器。必须调用真实工具，不要输出伪造的工具调用或依赖 Playwright Extension。访问明确的新网址时直接用 nodejs，它会创建任务和初始页面；操作已有标签页时先 create，再用 tabs 查看并选择页面。每个新 nodejs 程序使用新的 requestId，只有 receipt 查询同一次程序时才复用原 ID。只读脚本才设置 readOnly=true；脚本返回有界 JSON 结果，不要返回 Page、Locator、DOM 或无限文本。',
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['diagnose', 'create', 'tabs', 'claim', 'resume', 'nodejs', 'resource', 'receipt', 'finish'] },
      task: { type: 'string', description: '简短可读的任务名，可包含空格；新网址由 nodejs 创建任务，已有标签页先用 create 创建任务；同一任务的调用保持一致。' },
      requestId: { type: 'string', description: '每个新的 nodejs 程序使用唯一 ID；receipt 查询同一程序时复用该 ID。' },
      code: { type: 'string', description: 'nodejs 的 Browser-owned Playwright JavaScript，使用 page/context/pages()/tabbit helper，必须返回有界 JSON。' },
      readOnly: { type: 'boolean', description: '仅当脚本绝不会导航、聚焦、输入、点击或改变浏览器/网页状态时为 true。' },
      timeoutMs: { type: 'integer', minimum: 60000, maximum: 180000 },
      state: { type: 'string', enum: ['available', 'owned', 'claimed'] },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
      tabId: { type: 'integer', minimum: 1 },
      tabIds: { type: 'array', items: { type: 'integer', minimum: 1 }, maxItems: 20 },
      groupId: { type: 'string' },
      resource: { type: 'string' },
      offset: { type: 'integer', minimum: 0 },
      maxBytes: { type: 'integer', minimum: 1, maximum: 65536 },
      discard: { type: 'boolean' },
    },
    required: ['action'],
  },
  permissions: ['process', 'network'],
  tags: ['tabbit', 'mcp'],
  source: 'mcp',
  risk: 'read',
  gating: () => true,
  mcp: {
    serverId: 'tabbit',
    serverName: 'Tabbit Browser',
    toolName: 'browser',
    // The approval layer classifies nodejs from its actual arguments. This
    // remains false so a mutating program cannot be remembered as harmless.
    readOnly: false,
    blocked: false,
  },
});
