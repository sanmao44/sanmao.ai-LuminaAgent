import { defineTool } from './registry';

/**
 * Tabbit is a local browser-owned backend, not a Playwright Extension MCP
 * server. It is attached dynamically only for browser turns when the stable
 * Tabbit launcher is present.
 */
export const tabbitBrowserTool = defineTool({
  id: 'mcp:tabbit:browser',
  name: 'tabbit_browser',
  description: '使用 Tabbit 原生 CLI 控制用户的 Tabbit 浏览器。必须调用真实工具，不要输出伪造的工具调用或依赖 Playwright Extension。先用 tabs/diagnose 发现页面；用 nodejs 在 Tabbit 浏览器自有 Playwright 运行时中执行一段有界 JavaScript。为同一任务始终复用同一个 task 名称和 requestId；只读脚本才设置 readOnly=true；脚本返回有界 JSON 结果，不要返回 Page、Locator、DOM 或无限文本。',
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['diagnose', 'tabs', 'claim', 'resume', 'nodejs', 'resource', 'receipt', 'finish'] },
      task: { type: 'string', description: '短的稳定任务名；同一浏览器任务所有调用必须一致。' },
      requestId: { type: 'string', description: 'nodejs/receipt 使用的幂等请求 ID。' },
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
