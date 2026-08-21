export type AgentWebMode = 'auto' | 'always' | 'off';

export type AgentWebDecisionReason =
  | 'off'
  | 'always'
  | 'explicit-search'
  | 'fact-verification'
  | 'time-sensitive'
  | 'context-follow-up'
  | 'ordinary-chat';

export type AgentWebContextMessage = { role?: 'user' | 'assistant'; content?: string };

export type AgentWebDecision = {
  shouldSearch: boolean;
  reason: AgentWebDecisionReason;
  query: string;
};

export const DEFAULT_AGENT_DIRECTIONS = [
  '强化构图层级：让主体更突出，优化元素大小、位置和留白。',
  '优化光线色彩：保持主体与场景不变，调整光影、色温和对比度。',
  '调整细节风格：保持当前构图与主体，尝试更统一、精致的材质和视觉风格。',
] as const;

export type AgentWebContextMessage = { role?: 'user' | 'assistant'; content?: string };

export type AgentWebDecision = {
  shouldSearch: boolean;
  reason: AgentWebDecisionReason;
  query: string;
};

export const DEFAULT_AGENT_DIRECTIONS = [
  '强化构图层级：让主体更突出，优化元素大小、位置和留白。',
  '优化光线色彩：保持主体与场景不变，调整光影、色温和对比度。',
  '调整细节风格：保持当前构图与主体，尝试更统一、精致的材质和视觉风格。',
] as const;

export const DEFAULT_CHAT_DIRECTIONS = [
  '请结合当前上下文举一个具体例子，帮助我更好理解。',
  '请换一个角度分析这个问题，并说明利弊或适用场景。',
  '请把上面的内容整理成一份可以直接执行的步骤清单。',
] as const;

const directionItemPattern = /^\s*(?:(?:[-*+•])\s*|\d+[.)、]\s*)(.+?)\s*$/;
const directionHeadingPattern = /(?:下一版|下个版本|后续).{0,24}(?:可尝试|尝试方向|调整方向|方向)/i;
const chatDirectionHeadingPattern = /(?:你还可以继续|还可以继续|接下来(?:可以|还能)|继续聊什么|进一步(?:了解|讨论|展开))/i;
const visualTargetPattern = '(?:图|图片|图像|画面|海报|封面|风格|构图|版式|布局|光线|色彩|视觉|细节|背景|主体|文字|标题|信息层级|插画|插图|漫画|头像|壁纸|表情包|图标|logo|徽标|banner|横幅|配图|信息图|流程图|概念图|效果图|渲染图|视觉稿|主视觉|宣传图|广告图|缩略图|写真|艺术图|绘画|素描|草图|分镜)';
const editVerbPattern = '(?:修改|调整|改图|修图|重绘|重制|重做|换|替换|做成|变成|改成|画成|转成|转为|排成|扩图|补图|抠图|上色|着色|换风格|换色|优化|强化|弱化|增加|减少|去掉|删除|保持|延续|继续|尝试)';
const imageTargetPattern = '(?:图|图片|图像|画|画面|海报|封面|插画|插图|漫画|头像|壁纸|表情包|图标|logo|徽标|banner|横幅|配图|信息图|流程图|概念图|效果图|渲染图|视觉稿|主视觉|宣传图|广告图|缩略图|写真|艺术图|绘画|素描|草图|分镜|立绘|人设|场景图|原画|美术图|image|picture|photo|poster|cover|illustration|avatar|wallpaper|icon)';
const drawingVerbPattern = '(?:画|绘制|画出|描绘|勾勒|涂鸦|画下|画成|临摹|创作|生成|制作|创建|设计|做成|变成|改成|排成|渲染|出图|可视化|视觉化|draw|illustrate|generate|create|make|render|visualize)';
const imageNeedVerbPattern = '(?:给我|请给我|我要|我想要|我需要|帮我|麻烦|请|来|弄|搞|整|做|做个|做一|来个|来一|出|直接出|配|配上|配一张|配几张)';
const imageTextArtifactPattern = '(?:提示词|prompt|文案|文稿|文档|文章|报告|总结|清单|表格|计划|方案|建议|回复|段落|故事|标题|脚本|代码|教程|步骤|方法|口号|slogan|视频|音频|音乐|文件|附件)';

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

/** Extract clickable follow-up prompts from a normal assistant reply. */
export function extractChatDirections(content: string) {
  const lines = String(content || '').replace(/\r/g, '').split('\n');
  const headingIndex = lines.findIndex((line) => chatDirectionHeadingPattern.test(line));
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
  return [...DEFAULT_CHAT_DIRECTIONS];
}

export function isChatDirectionHeading(line: string) {
  return chatDirectionHeadingPattern.test(String(line || ''));
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

const explicitSearchPattern = /(?:联网|上网|搜索|查询|查找|检索|查证|核验|核实|找来源|给出处|官方(?:网站|公告)?|查新闻|搜一下|搜寻).{0,24}|(?:search|look\s*up|check|verify|browse|find\s+sources?)\b/i;
const questionPattern = /(?:[吗呢么][。.!！?？]*$|[?？]|\b(?:who|what|when|where|which|how|why|is|are|did|does|do|can)\b)/i;
const timeSensitivePattern = /(?:今天|今日|刚刚|现在|当前|实时|最新|近期|本周|本月|今年|最近|目前|截至|进展|更新|新闻|快讯|突发|天气|温度|价格|报价|股价|汇率|版本|更新日志|排名|比赛|赛程|比分|政策|法规|选举|任命|发布会|上映)/i;
const verificationPattern = /(?:去世|逝世|死亡|病逝|失踪|辞职|离任|任职|当选|获奖|发布|上映|下架|关闭|宕机|真假|真伪|属实|谣言|假消息|辟谣|是否正确|是否存在|是否还在|还活着|发生了吗|是真的吗|真的假的|对不对|准确吗)/i;
const externalFactPattern = /(?:人物|公司|机构|组织|品牌|产品|型号|版本|政策|法规|事件|新闻|消息|天气|价格|汇率|职位|职务|总理|总统|CEO|创始人|作者|导演|演员|地点|城市|国家|学校|医院|平台|服务|接口|API|上市|召回|故障)/i;
const contextFollowUpPattern = /(?:^|[\s，。！？])(?:(?:他|她|它|其|这个人|那个人|该人物|该事件|这件事|这个消息|该消息)(?:现在|目前|后来|之后|最近)?(?:怎么样|如何|还在吗|还好吗|是否还在|的情况|的进展)?|(?:后来|之后|现在|目前|最近)(?:怎么样|如何|呢)?|结果呢|进展呢)(?:[\s，。！？]|$)/i;
const creativeOrArtifactPattern = /(?:生图|画图|绘图|改图|修图|海报|插画|提示词|prompt|代码|编程|typescript|javascript|python|脚本|文件|附件|总结|概括|改写|润色|翻译|摘要|整理成|数学题|公式|推导|证明|教程|步骤|怎么做|如何制作|设计方案)/i;
const conversationalPattern = /^(?:你好|嗨|哈喽|谢谢|感谢|晚安|早上好|你好吗|你是谁|你叫什么|能帮我吗|可以吗|在吗|有人吗)[。.!！?？]*$/i;
const stableConceptPattern = /^(?:请问)?(?:什么是|何为|请解释|解释一下|如何理解).{0,80}(?:概念|原理|定义|理论|算法|语法|函数|定理|物理|化学|数学|生物|编程|代码|机制|方法|光合作用|相对论|递归|向量|概率)[。.!！?？]*$/i;

function normalizeWebText(value: unknown, limit = 320) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function relevantContextForQuery(input: string, context: AgentWebContextMessage[]) {
  if (!contextFollowUpPattern.test(input)) return '';
  const previous = context
    .slice(-8)
    .reverse()
    .filter((message) => typeof message?.content === 'string' && message.content.trim())
    .slice(0, 2)
    .map((message) => normalizeWebText(message.content, 180));
  return previous.join(' ');
}

/** Build a bounded query without sending the full conversation to a search provider. */
export function buildAgentWebQuery(input: string, context: AgentWebContextMessage[] = []) {
  const current = normalizeWebText(input);
  const contextText = relevantContextForQuery(current, context);
  return normalizeWebText(contextText ? `${contextText} ${current}` : current);
}

function hasConcreteTopic(text: string) {
  if (externalFactPattern.test(text)) return true;
  const chunks = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const stopWords = /^(?:请问|帮我|告诉我|想知道|是否|是不是|有没有|怎么|如何|为什么|什么|哪个|哪里|谁|何时|多少|现在|目前|这个消息|这件事|真的吗|真的假的)$/;
  return chunks.some((chunk) => !stopWords.test(chunk));
}

const explicitSearchPattern = /(?:联网|上网|搜索|查询|查找|检索|查证|核验|核实|找来源|给出处|官方(?:网站|公告)?|查新闻|搜一下|搜寻).{0,24}|(?:search|look\s*up|check|verify|browse|find\s+sources?)\b/i;
const questionPattern = /(?:[吗呢么][。.!！?？]*$|[?？]|\b(?:who|what|when|where|which|how|why|is|are|did|does|do|can)\b)/i;
const timeSensitivePattern = /(?:今天|今日|刚刚|现在|当前|实时|最新|近期|本周|本月|今年|最近|目前|截至|进展|更新|新闻|快讯|突发|天气|温度|价格|报价|股价|汇率|版本|更新日志|排名|比赛|赛程|比分|政策|法规|选举|任命|发布会|上映)/i;
const verificationPattern = /(?:去世|逝世|死亡|病逝|失踪|辞职|离任|任职|当选|获奖|发布|上映|下架|关闭|宕机|真假|真伪|属实|谣言|假消息|辟谣|是否正确|是否存在|是否还在|还活着|发生了吗|是真的吗|真的假的|对不对|准确吗)/i;
const externalFactPattern = /(?:人物|公司|机构|组织|品牌|产品|型号|版本|政策|法规|事件|新闻|消息|天气|价格|汇率|职位|职务|总理|总统|CEO|创始人|作者|导演|演员|地点|城市|国家|学校|医院|平台|服务|接口|API|上市|召回|故障)/i;
const contextFollowUpPattern = /(?:^|[\s，。！？])(?:(?:他|她|它|其|这个人|那个人|该人物|该事件|这件事|这个消息|该消息)(?:现在|目前|后来|之后|最近)?(?:怎么样|如何|还在吗|还好吗|是否还在|的情况|的进展)?|(?:后来|之后|现在|目前|最近)(?:怎么样|如何|呢)?|结果呢|进展呢)(?:[\s，。！？]|$)/i;
const creativeOrArtifactPattern = /(?:生图|画图|绘图|改图|修图|海报|插画|提示词|prompt|代码|编程|typescript|javascript|python|脚本|文件|附件|总结|概括|改写|润色|翻译|摘要|整理成|数学题|公式|推导|证明|教程|步骤|怎么做|如何制作|设计方案)/i;
const conversationalPattern = /^(?:你好|嗨|哈喽|谢谢|感谢|晚安|早上好|你好吗|你是谁|你叫什么|能帮我吗|可以吗|在吗|有人吗)[。.!！?？]*$/i;
const stableConceptPattern = /^(?:请问)?(?:什么是|何为|请解释|解释一下|如何理解).{0,80}(?:概念|原理|定义|理论|算法|语法|函数|定理|物理|化学|数学|生物|编程|代码|机制|方法|光合作用|相对论|递归|向量|概率)[。.!！?？]*$/i;

function normalizeWebText(value: unknown, limit = 320) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function relevantContextForQuery(input: string, context: AgentWebContextMessage[]) {
  if (!contextFollowUpPattern.test(input)) return '';
  const previous = context
    .slice(-8)
    .reverse()
    .filter((message) => typeof message?.content === 'string' && message.content.trim())
    .slice(0, 2)
    .map((message) => normalizeWebText(message.content, 180));
  return previous.join(' ');
}

/** Build a bounded query without sending the full conversation to a search provider. */
export function buildAgentWebQuery(input: string, context: AgentWebContextMessage[] = []) {
  const current = normalizeWebText(input);
  const contextText = relevantContextForQuery(current, context);
  return normalizeWebText(contextText ? `${contextText} ${current}` : current);
}

function hasConcreteTopic(text: string) {
  if (externalFactPattern.test(text)) return true;
  const chunks = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const stopWords = /^(?:请问|帮我|告诉我|想知道|是否|是不是|有没有|怎么|如何|为什么|什么|哪个|哪里|谁|何时|多少|现在|目前|这个消息|这件事|真的吗|真的假的)$/;
  return chunks.some((chunk) => !stopWords.test(chunk));
}

/**
 * Decide locally whether the current request needs a fresh external source.
 * The returned query is deliberately bounded and only includes context for
 * pronoun/ellipsis follow-ups.
 */
export function shouldUseAgentWebSearch(mode: AgentWebMode, input: string, context: AgentWebContextMessage[] = []): AgentWebDecision {
  const text = normalizeWebText(input);
  const query = buildAgentWebQuery(text, context);
  if (mode === 'off') return { shouldSearch: false, reason: 'off', query };
  if (mode === 'always') return { shouldSearch: Boolean(query), reason: 'always', query };
  if (!text) return { shouldSearch: false, reason: 'ordinary-chat', query };

  const explicit = explicitSearchPattern.test(text);
  if (explicit) return { shouldSearch: true, reason: 'explicit-search', query };
  if (creativeOrArtifactPattern.test(text) || conversationalPattern.test(text)) return { shouldSearch: false, reason: 'ordinary-chat', query };
  if (stableConceptPattern.test(text)) return { shouldSearch: false, reason: 'ordinary-chat', query };

  const question = questionPattern.test(text);
  const verification = verificationPattern.test(text);
  const timeSensitive = timeSensitivePattern.test(text) && (question || hasConcreteTopic(text));
  const contextFollowUp = contextFollowUpPattern.test(text) && relevantContextForQuery(text, context).length > 0;
  const factQuestion = question && hasConcreteTopic(text);

  if (contextFollowUp) return { shouldSearch: true, reason: 'context-follow-up', query };
  if (verification) return { shouldSearch: true, reason: 'fact-verification', query };
  if (timeSensitive) return { shouldSearch: true, reason: 'time-sensitive', query };
  if (factQuestion) return { shouldSearch: true, reason: 'fact-verification', query };
  return { shouldSearch: false, reason: 'ordinary-chat', query };
}

  const explicit = explicitSearchPattern.test(text);
  if (explicit) return { shouldSearch: true, reason: 'explicit-search', query };
  if (creativeOrArtifactPattern.test(text) || conversationalPattern.test(text)) return { shouldSearch: false, reason: 'ordinary-chat', query };
  if (stableConceptPattern.test(text)) return { shouldSearch: false, reason: 'ordinary-chat', query };

  const question = questionPattern.test(text);
  const verification = verificationPattern.test(text);
  const timeSensitive = timeSensitivePattern.test(text) && (question || hasConcreteTopic(text));
  const contextFollowUp = contextFollowUpPattern.test(text) && relevantContextForQuery(text, context).length > 0;
  const factQuestion = question && hasConcreteTopic(text);

  if (contextFollowUp) return { shouldSearch: true, reason: 'context-follow-up', query };
  if (verification) return { shouldSearch: true, reason: 'fact-verification', query };
  if (timeSensitive) return { shouldSearch: true, reason: 'time-sensitive', query };
  if (factQuestion) return { shouldSearch: true, reason: 'fact-verification', query };
  return { shouldSearch: false, reason: 'ordinary-chat', query };
}

/** Identify a new image request before allowing the chat model to stream text. */
export function likelyImageGenerationRequest(input: string) {
  const text = String(input || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  const fileRequest = /(?:导出|下载|保存|生成|创建|制作).{0,16}(?:文件|附件|csv|tsv|json|markdown|md|txt|html|css|svg|xml|yaml|代码|脚本|报告|文档)/i;
  if (fileRequest.test(text)) return false;
  const imageAction = new RegExp(drawingVerbPattern, 'i');
  const imageTarget = new RegExp(imageTargetPattern, 'i');
  const promptMention = /(?:提示词|prompt)/i.test(text);
  const imageAfterPrompt = /(?:提示词|prompt).{0,40}(?:画|绘制|生成|制作|创建|设计|渲染|出图|visualize)/i.test(text);
  const combinedRequest = /(?:并|同时|然后|再|以及|之后).{0,24}(?:提示词|prompt)/i.test(text);
  const promptOnly = promptMention && !imageAfterPrompt && !combinedRequest && (
    /(?:提示词|prompt)\s*(?:是|怎么|如何|是什么|怎么写|如何写)?\s*[：:，,。.!！?？]?\s*$/i.test(text) ||
    new RegExp(`(?:写|生成|制作|创建|设计|优化|改写|润色|反推|提取|翻译|解释|画|绘制|做成|变成|改成).{0,36}(?:提示词|prompt)`, 'i').test(text) ||
    /(?:提示词|prompt).{0,12}(?:怎么|如何|是什么|写|优化|改写|润色|反推|提取)/i.test(text)
  );
  if (promptOnly) return false;
  if (/(?:步骤|方法|教程|技巧|软件|工具|代码|使用方法|制作方法|设计方法)\s*[。.!！?？]?\s*$/i.test(text) && !/^(?:请|帮我|给我|麻烦|我想|我要|我需要)?\s*(?:生成|制作|创建|设计|画|绘制|出图)/i.test(text)) return false;
  if (/(?:怎么|如何|教程|步骤|方法|技巧|软件|工具|代码|使用|制作方法|设计方法).{0,24}(?:画|绘制|生成|做图|海报|图片|插画|封面)/i.test(text) && !/(?:请|帮我|给我|我要|我想要|直接|生成|制作|创建|设计)\s*(?:一张|一幅|一个|一只|几张)?/i.test(text)) return false;
  if (/(?:画图|绘图|绘画|制图)(?:软件|工具).{0,12}(?:怎么|如何|教程|用|使用)/i.test(text)) return false;
  if (/(?:画图|绘图|绘画|制图).{0,8}(?:软件|工具|教程|方法|技巧|代码)|(?:怎么|如何|教我|教程|步骤|方法|技巧).{0,16}(?:画|绘制|生成图片|做图)/i.test(text) && !/^(?:请|帮我|给我|麻烦|我想|我要|我需要)?\s*(?:画|绘制|画出|生成|制作|创建)/i.test(text)) return false;
  const drawRequest = new RegExp(`^(?:请|帮我|给我|麻烦|我想|我要|我需要|能不能|可以|请你|帮忙)?\\s*(?:画|绘制|画出|描绘|勾勒|涂鸦|画下|临摹|draw|illustrate)\\s*(?:(?:一下|个|一个|只|张|幅|组|一只|一张|一幅|几张|一组)\\s*)?\\S+`, 'i');
  const actionWithVisualTarget = new RegExp(`${drawingVerbPattern}.{0,48}${imageTargetPattern}`, 'i');
  const visualNeed = new RegExp(`${imageNeedVerbPattern}\\s*(?:(?:一个|一只|一张|一幅|一副|几张|多张|一组|一套|个|只|张|幅)\\s*.{0,24})?${imageTargetPattern}`, 'i');
  const quantityRequestPrefix = `(?:${imageNeedVerbPattern})\\s*(?:一张|一幅|一副|几张|多张|一组|一套|张|幅)\\s*`;
  const quantityWithVisualTarget = new RegExp(`^${quantityRequestPrefix}.{0,20}${imageTargetPattern}`, 'i');
  const quantityObjectRequest = new RegExp(`^${quantityRequestPrefix}(?!.*${imageTextArtifactPattern}$).+`, 'i');
  const countedObjectGeneration = new RegExp(`^(?:请|帮我|给我|麻烦|我想|我要|我需要)?\\s*(?:生成|制作|创建|创作|渲染)\\s*(?:一只|一个|一张|一幅|一副|几张|多张|一组|一套)\\s*\\S+`, 'i');
  const informalObjectGeneration = new RegExp(`^(?:请|帮我|给我|麻烦|我想|我要|我需要)?\\s*(?:做|弄|搞|整|来)\\s*(?:个|一个|只|一只|张|一张|幅|一幅)\\s*\\S+`, 'i');
  const visualTransformation = new RegExp(`(?:把|将).{0,96}(?:画成|做成|变成|改成|转成|转为|排成|可视化|视觉化).{0,32}${imageTargetPattern}`, 'i');
  const illustrationRequest = /(?:配图|配一张|配几张|配套插图|插一张|做配图|加一张图|加配图)/i.test(text) && !new RegExp(`${imageTargetPattern}\\s*(?:的|之)?\\s*${imageTextArtifactPattern}`, 'i').test(text);
  const visualNeedRequest = visualNeed.test(text) || quantityWithVisualTarget.test(text) || quantityObjectRequest.test(text);
  const hasVisualAction = imageAction.test(text) && (imageTarget.test(text) || /(?:出图|配图|可视化|视觉化|画猫|画狗|画人|画物|draw|illustrate)/i.test(text));
  const nonVisualArtifact = new RegExp(`${imageTargetPattern}\\s*(?:的|之)?\\s*${imageTextArtifactPattern}`, 'i');
  if (nonVisualArtifact.test(text) && !visualTransformation.test(text) && !drawRequest.test(text)) return false;
  const objectGeneration = (countedObjectGeneration.test(text) || informalObjectGeneration.test(text)) && !new RegExp(imageTextArtifactPattern, 'i').test(text);
  return drawRequest.test(text) || actionWithVisualTarget.test(text) || visualTransformation.test(text) || illustrationRequest || visualNeedRequest || hasVisualAction || objectGeneration;
}

/** Requests that need the model's tool planner rather than direct text streaming. */
export function likelyAgentToolRequest(input: string, hasReferences: boolean) {
  const text = input.trim();
  if (likelyImageGenerationRequest(text)) return true;
  if (hasReferences && (isImageContinuationRequest(text) || /(修改|重绘|换(?:背景|场景)|保持(?:人物|主体)|参考(?:图|风格)|基于(?:这|图片|图)|反推)/i.test(text))) return true;
  return /(?:导出|下载|保存|生成).{0,12}(?:文件|csv|json|markdown|文档|代码)/i.test(text);
}
