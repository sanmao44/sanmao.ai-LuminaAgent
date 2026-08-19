export type AgentWebMode = 'auto' | 'always' | 'off';

/** Convert the legacy boolean preference without changing existing users' intent. */
export function resolveAgentWebMode(value: unknown, legacy?: unknown): AgentWebMode {
  if (value === 'always' || value === 'off' || value === 'auto') return value;
  return legacy === false ? 'off' : 'auto';
}

/**
 * Fast, intentionally conservative local gate for queries whose answer needs
 * a fresh external source. This avoids a full LLM tool-planning round trip for
 * ordinary writing, creative work, code and conversation.
 */
export function shouldUseAgentWebSearch(mode: AgentWebMode, input: string) {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  const text = input.trim();
  if (!text) return false;
  const explicit = /(?:联网|上网|搜索|查询|查找|检索|查证|核验|核实).{0,10}(?:一下|下|网页|网络|资料|新闻)?|(?:search|look\s*up|check|verify)\s+(?:the\s+)?(?:web|internet)?/i;
  const changingFact = /(?:今天|今日|刚刚|现在|当前|实时|最新|近期|本周|本月|今年).{0,18}(?:新闻|消息|动态|情况|价格|股价|汇率|天气|比赛|赛程|比分|政策|法规|版本|发布|更新|排名)|(?:新闻|快讯|突发|天气|温度|价格|报价|股价|汇率|版本|更新日志|政策|法规|比赛|赛程|比分|选举|任命|发布会|上映).{0,10}(?:多少|怎样|如何|是什么|有吗|了吗|吗|？|\?)/i;
  const sourceNeed = /(?:来源|出处|官方(?:网站|公告)?|证据|依据|事实(?:核验|核实)|是否属实|真的假的|辟谣|验证)/i;
  return explicit.test(text) || changingFact.test(text) || sourceNeed.test(text);
}

/** Requests that need the model's tool planner rather than direct text streaming. */
export function likelyAgentToolRequest(input: string, hasReferences: boolean) {
  const text = input.trim();
  if (hasReferences && /(修改|重绘|换(?:背景|场景)|保持(?:人物|主体)|参考(?:图|风格)|基于(?:这|图片|图)|反推)/i.test(text)) return true;
  return /(生成|画|做|设计|创建|出).{0,14}(?:图|图片|海报|封面|插画|logo|图标)|(?:导出|下载|保存|生成).{0,12}(?:文件|csv|json|markdown|文档|代码)/i.test(text);
}
