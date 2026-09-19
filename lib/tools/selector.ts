/**
 * 本轮「哪些工具下发给模型」的唯一入口（任务书 §3.3）。
 *
 * 以前这段逻辑散在 index.ts 的 toolSchemasFor 里，加一个工具组（比如浏览器、GitHub）
 * 就得回主流程改判断。现在收敛成三步：enabled → 分组 → 工具自己的门控，
 * 后面接 MCP 工具组时只在这里加规则，Agent 主流程不用动。
 *
 * v1 刻意不做模型选组：选组只看本地信号（门控、显式分组），不额外发一次 LLM 请求。
 */
import type { ToolDefinition, ToolGatingContext } from './registry';

/** 工具分组：内置一组，每个 MCP 服务一组；大工具表按组开关。 */
export type ToolGroupId = 'native' | `mcp:${string}`;

export type ToolSelectionInput = {
  context: ToolGatingContext;
  /** 候选工具：内置工具 + 本轮挂上来的运行时工具（MCP）。 */
  availableTools: readonly ToolDefinition[];
  /**
   * 只放行这些分组；为空表示不限制。
   * 给「用户主动打开某个连接」这类入口用，也是以后浏览器工具组按需加载的开关。
   */
  explicitGroups?: readonly ToolGroupId[];
  /** 用户原话，用来判断按需下发的分组这一轮要不要挂上。 */
  userText?: string;
  /**
   * 分组关键词覆盖：按需下发的服务在这里带上自己的关键词表，
   * 没写的分组回落到 MCP_GROUP_KEYWORDS。
   */
  groupKeywords?: Record<string, readonly string[]>;
};

export function toolGroupOf(tool: Pick<ToolDefinition, 'source' | 'mcp'>): ToolGroupId {
  if (tool.source !== 'mcp') return 'native';
  const serverId = String(tool.mcp?.serverId || '').trim();
  return serverId ? `mcp:${serverId}` : 'mcp:unknown';
}

/**
 * 分组级的关键词开关：只有写在这张表里的分组需要「被提到」才会加载。
 *
 * 为什么只写浏览器：浏览器服务一开就是二十多个工具、上万字符的 schema，普通聊天带上它
 * 既费钱又容易让模型乱点（任务书 §3.3、§54.12）。用户自己配的远程服务保持原样加载——
 * 那些是用户主动接的，突然不给他用才是 bug。面板里给某个服务打开「按需下发」后，
 * 该服务改用自己的关键词表（服务名 + 工具名），没打开的服务仍然原样加载。
 */
export const MCP_GROUP_KEYWORDS: Record<string, readonly string[]> = {
  'mcp:playwright': [
    '浏览器', '网页', '网站', '网址', '链接', '页面', '打开', '点击', '填表', '登录', '注册', '提交',
    '截图', '下载', '抓取', '爬', 'http://', 'https://', 'www.',
    'browser', 'playwright', 'chrome', 'webpage', 'website',
  ],
};

function groupActivatedByText(
  group: ToolGroupId,
  userText: string | undefined,
  overrides?: Record<string, readonly string[]>,
) {
  // 面板给某个服务打开「按需下发」后，它自己的关键词表优先于内置默认（见 lib/mcp/tools.ts）。
  const keywords = overrides?.[group] ?? MCP_GROUP_KEYWORDS[group];
  if (!keywords) return true;
  if (!userText) return false;
  const text = userText.toLowerCase();
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function isEnabled(tool: ToolDefinition) {
  return tool.enabled !== false;
}

/**
 * 本轮要下发给模型的工具。
 *
 * 名字空间按来源分先后：内置工具声明的名字是保留字，MCP 服务就算公布同名工具也会被跳过
 * （内置工具这轮没下发也一样保留，否则它会在别的轮次里被冒牌货顶掉）。剩下的同名工具只留第一个。
 * 这是任务书 §3.2「工具名不能互相覆盖」的最后一道保险。
 */
export function selectToolsForTurn(input: ToolSelectionInput): ToolDefinition[] {
  const groups = input.explicitGroups?.length ? new Set(input.explicitGroups) : null;
  const reservedNames = new Set(input.availableTools.filter((tool) => tool.source !== 'mcp').map((tool) => tool.name));
  const selected: ToolDefinition[] = [];
  const seen = new Set<string>();
  for (const tool of input.availableTools) {
    if (!isEnabled(tool)) continue;
    const group = toolGroupOf(tool);
    // 显式指定分组时以调用方为准；否则需要关键词的分组得先被提到。
    if (groups) {
      if (!groups.has(group)) continue;
    } else if (!groupActivatedByText(group, input.userText, input.groupKeywords)) {
      continue;
    }
    if (tool.source === 'mcp' && reservedNames.has(tool.name)) continue;
    if (seen.has(tool.name)) continue;
    if (!tool.gating(input.context)) continue;
    seen.add(tool.name);
    selected.push(tool);
  }
  return selected;
}

/** 注册表自检：id / name 必须唯一。测试和启动自检都靠它，缺字段的条目在这里就会被抓出来。 */
export function registryProblems(tools: readonly ToolDefinition[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const tool of tools) {
    if (!tool.id) problems.push(`${tool.name || '(无名工具)'} 缺少 id`);
    else if (ids.has(tool.id)) problems.push(`重复的工具 id：${tool.id}`);
    else ids.add(tool.id);
    if (!tool.name) problems.push(`${tool.id || '(无 id 工具)'} 缺少 name`);
    else if (names.has(tool.name)) problems.push(`重复的工具名：${tool.name}`);
    else names.add(tool.name);
    if (!tool.risk) problems.push(`${tool.name} 缺少风险等级`);
  }
  return problems;
}
