export type AgentWebMode = 'auto' | 'always' | 'off';

export const DEFAULT_AGENT_DIRECTIONS = [
  '强化构图层级：让主体更突出，优化元素大小、位置和留白。',
  '优化光线色彩：保持主体与场景不变，调整光影、色温和对比度。',
  '调整细节风格：保持当前构图与主体，尝试更统一、精致的材质和视觉风格。',
] as const;

const directionItemPattern = /^\s*(?:(?:[-*+•])\s*|\d+[.)、]\s*)(.+?)\s*$/;
const directionHeadingPattern = /(?:下一版|下个版本|后续).{0,24}(?:可尝试|尝试方向|调整方向|方向)/i;
const visualTargetPattern = '(?:图|图片|画面|海报|封面|风格|构图|版式|布局|光线|色彩|视觉|细节|背景|主体|文字|标题|信息层级)';
const editVerbPattern = '(?:修改|调整|改图|重绘|换|替换|做成|变成|改成|排成|优化|强化|弱化|增加|减少|去掉|删除|保持|延续|继续|尝试)';

/** Extract the numbered/bulleted continuation choices from an assistant caption. */
export function extractAgentDirections(content: string) {
  const lines = String(content || '').replace(/\r/g, '').split('\n');
  const headingIndex = lines.findIndex((line) => directionHeadingPattern.test(line));
  if (headingIndex >= 0) {
    const directions: string[] = [];
    for (let index = headingIndex + 1; index < lines.length && directions.length < 3; index += 1) {
      const line = lines[index];
      if (/^\s*#{1,6}\s+/.test(line)) break;
      if (!line.trim()) continue;
      const match = line.match(directionItemPattern);
      if (!match) break;
      const value = match[1].replace(/^\*\*(.+)\*\*$/, '$1').trim();
      if (value) directions.push(value);
    }
    if (directions.length) return directions;
  }
  return [...DEFAULT_AGENT_DIRECTIONS];
}

/** Hide the textual direction list when the image message already renders it as buttons. */
export function stripAgentDirectionSection(content: string) {
  const lines = String(content || '').replace(/\r/g, '').split('\n');
  const headingIndex = lines.findIndex((line) => directionHeadingPattern.test(line));
  if (headingIndex < 0) return String(content || '');

  let index = headingIndex + 1;
  let directionCount = 0;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (!directionItemPattern.test(line)) break;
    directionCount += 1;
  }
  if (!directionCount) return String(content || '');

  const remaining = lines.slice(index);
  while (remaining.length && !remaining[0].trim()) remaining.shift();
  return [...lines.slice(0, headingIndex), ...remaining].join('\n').trim();
}

/** Identify a visual edit request that should be handled by image_edit. */
export function isImageContinuationRequest(input: string) {
  const text = String(input || '').trim();
  if (!text) return false;
  const actionThenTarget = new RegExp(`${editVerbPattern}.{0,32}${visualTargetPattern}`, 'i');
  const targetThenAction = new RegExp(`${visualTargetPattern}.{0,32}${editVerbPattern}`, 'i');
  return actionThenTarget.test(text) || targetThenAction.test(text);
}

/** Return the last image from the most recent assistant message containing images. */
export function latestAssistantImage(messages: Array<{ role?: string; images?: unknown[] }> = []) {
  for (const message of [...messages].reverse()) {
    if (message?.role !== 'assistant' || !Array.isArray(message.images) || !message.images.length) continue;
    return message.images[message.images.length - 1];
  }
  return null;
}

export function buildContinuationPrompt(direction: string) {
  const value = String(direction || '').trim();
  return value ? `请基于这张参考图继续修改：${value}` : '请基于这张参考图继续修改，保持主体和核心构图不变。';
}

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

/** Identify a new image request before allowing the chat model to stream text. */
export function likelyImageGenerationRequest(input: string) {
  const text = String(input || '').trim();
  if (!text) return false;
  const fileRequest = /(?:导出|下载|保存|生成).{0,12}(?:文件|csv|json|markdown|文档|代码)/i;
  if (fileRequest.test(text)) return false;
  const promptRequest = /(?:生成|制作|创建|设计|优化|改写|润色|写).{0,20}(?:提示词|prompt)/i;
  if (promptRequest.test(text) && !/(?:画|绘制|画出)\s*(?:(?:一只|一张|一幅|几张|一组|个|一个)\s*)?(?:图|图片|画面|海报|封面|插画)/i.test(text)) return false;
  if (/(?:提示词|prompt)\s*[：:，,。.!！?？]?\s*$/i.test(text)) return false;
  const drawRequest = /^(?:请|帮我|给我|麻烦|我想|我要|能不能|可以)?\s*(?:画|绘制|画出)\s*(?:(?:一下|个|一个|只|张|幅|组|一只|一张|一幅|几张|一组)\s*)?\S+/i;
  const explicitGeneration = /^(?:请|帮我|给我|麻烦)?\s*(?:生成|制作|创建|设计|做成|变成|改成|排成)\s*(?:(?:个|一个|只|张|幅|组|一只|一张|一幅|几张|一组)\s*)\S+/i;
  const embeddedVisualRequest = /(?:画|绘制|画出|生成|制作|创建|设计|做成|变成|改成|排成)\s*(?:(?:一下|个|一个|只|张|幅|组|一只|一张|一幅|几张|一组)\s*)?(?:画|图|图片|画面|海报|封面|插画|logo|图标|\S+)/i;
  return drawRequest.test(text) || explicitGeneration.test(text) || embeddedVisualRequest.test(text);
}

/** Requests that need the model's tool planner rather than direct text streaming. */
export function likelyAgentToolRequest(input: string, hasReferences: boolean) {
  const text = input.trim();
  if (likelyImageGenerationRequest(text)) return true;
  if (hasReferences && (isImageContinuationRequest(text) || /(修改|重绘|换(?:背景|场景)|保持(?:人物|主体)|参考(?:图|风格)|基于(?:这|图片|图)|反推)/i.test(text))) return true;
  return /(?:导出|下载|保存|生成).{0,12}(?:文件|csv|json|markdown|文档|代码)/i.test(text);
}
