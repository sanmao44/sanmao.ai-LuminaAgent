export type AgentDeliverable = 'IMAGE' | 'TEXT' | 'BOTH' | 'CLARIFY' | 'OTHER';

export type AgentIntentMessage = {
  role?: 'user' | 'assistant' | string;
  content?: string;
  images?: unknown[];
};

export type AgentIntentContext = {
  messages?: AgentIntentMessage[];
  hasReferences?: boolean;
  hasFiles?: boolean;
};

export type AgentIntentDecision = {
  deliverable: AgentDeliverable;
  label: string;
  summary: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
};

const imageLabel = '图片产物';
const textLabel = '文字产物';
const bothLabel = '图片 + 文案';
const clarifyLabel = '需要你选择';
const otherLabel = '通用对话';

const imageActionPattern = /(?:画|绘制|描绘|涂鸦|出图|生图|生成图片|生成图像|制作海报|做海报|做封面图|做宣传图|生成海报|生成封面|生成插画|生成效果图|改图|修图|重绘|换背景|扩图|抠图|配图|渲染|可视化|视觉化|image|picture|poster|illustration|render|visualize)/i;
const imageTargetPattern = /(?:图片|图像|画面|海报|封面图|封面|插画|插图|漫画|头像|壁纸|表情包|图标|logo|banner|配图|信息图|概念图|效果图|宣传图|广告图|主视觉|场景图|image|picture|poster|cover|illustration|avatar|wallpaper|icon)/i;
const imageEditPattern = /(?:修改|调整|改一下|改成|换成|替换|重绘|重制|修图|换背景|去掉|加上|增加|减少|保持主体|延续|继续|再来|更高级|更年轻|更简洁|优化构图|强化光线|调整色彩)/i;
const textArtifactPattern = /(?:文案|标题|正文|文章|脚本|口播|广告语|宣传语|配文|简介|描述|提示词|prompt|代码|程序|报告|方案|清单|表格|摘要|总结|翻译|邮件|回复|文字|方向|创意|灵感|思路|markdown|json|csv|html|css)/i;
const textActionPattern = /(?:写|撰写|改写|重写|润色|扩写|缩写|概括|总结|翻译|起|想|生成|整理|提取|反推|解释|分析|比较|输出|提供|列出|优化).{0,48}(?:文案|标题|正文|文章|脚本|口播|广告语|宣传语|配文|简介|描述|提示词|prompt|代码|程序|报告|方案|清单|表格|摘要|文字)/i;
const promptOnlyPattern = /(?:提示词|prompt)/i;
const separateCopyPattern = /(?:另外|再|同时|并且|并|以及|配套|附上|额外).{0,36}(?:给我|提供|写|输出|来).{0,20}(?:文案|标题|配文|广告语|宣传语|脚本|文字)/i;
const embeddedTextPattern = /(?:图上|图片上|海报上|封面上|画面中|带(?:上|有)|加入|写着|写上).{0,28}(?:文字|标题|文案|字样|slogan|口号)/i;
const questionOrAnalysisPattern = /(?:为什么|怎么做|如何做|教程|步骤|方法|技巧|解释|分析|比较|建议|了解|是什么|是否|能不能|可以吗|吗[？?]?$|[？?]$)/i;
const vagueCreativePattern = /(?:帮我|给我|请|我要|我想要|麻烦|来|做|搞|弄|生成|制作|创建|设计).{0,16}(?:宣传|推广|营销|广告|活动|新品|内容|方案|套|东西)(?:吧|呢|呀|啊)?$/i;
const vagueFollowUpPattern = /^(?:继续|再来一个|再来一版|再来几版|这个再|这张再|按刚才|按照刚才|基于这个|基于这张|把它|它再|再短一点|再详细一点|更高级一点|更年轻一点|更简洁一点|优化一下|改一下|换一下|调整一下)/i;

function clean(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function latestMessageWithImages(messages: AgentIntentMessage[]) {
  return [...messages].reverse().find((message) => message?.role === 'assistant' && Array.isArray(message.images) && message.images.length);
}

function result(deliverable: AgentDeliverable, reason: string, confidence: AgentIntentDecision['confidence'], signals: string[]): AgentIntentDecision {
  const metadata: Record<AgentDeliverable, { label: string; summary: string }> = {
    IMAGE: { label: imageLabel, summary: '我会优先准备图片生成或图片编辑能力。' },
    TEXT: { label: textLabel, summary: '我会先给你可复制、可继续修改的文字内容。' },
    BOTH: { label: bothLabel, summary: '我会同时准备视觉产物和独立可复制的配套文案。' },
    CLARIFY: { label: clarifyLabel, summary: '这句话有两种合理方向，先确认交付形式可以少走一步。' },
    OTHER: { label: otherLabel, summary: '我会先按问答、分析或其他任务处理，不擅自调用生图。' },
  };
  return { deliverable, ...metadata[deliverable], reason, confidence, signals };
}

/**
 * Decide what the user expects to receive, rather than classifying by a
 * single visual keyword. This is intentionally small and explainable so the
 * UI can show the decision and the server can use the same contract.
 */
export function classifyAgentDeliverable(input: string, context: AgentIntentContext = {}): AgentIntentDecision {
  const text = clean(input);
  const messages = Array.isArray(context.messages) ? context.messages : [];
  const hasReferences = Boolean(context.hasReferences);
  const hasFiles = Boolean(context.hasFiles);
  if (!text && (hasReferences || hasFiles)) {
    return result('OTHER', hasReferences ? '检测到参考图，默认先分析内容；你可以补充“修改”或“反推提示词”。' : '检测到文件，默认先读取并处理文件内容。', 'medium', [hasReferences ? '参考图' : '文件']);
  }
  if (!text) return result('OTHER', '还没有足够的文字目标。', 'low', []);

  const asksForPrompt = promptOnlyPattern.test(text) && /(?:写|生成|优化|改写|润色|反推|提取|翻译|解释|给我|输出|提供|整理|怎么|如何|只要|仅需)/i.test(text);
  const asksForText = textActionPattern.test(text) || (textArtifactPattern.test(text) && !imageActionPattern.test(text));
  const asksForImage = (imageActionPattern.test(text) || /(?:做|生成|制作|创建|设计|来).{0,12}(?:一张|一幅|一个|个|张|幅|海报|封面|宣传图|图片|插画)/i.test(text)) && (imageTargetPattern.test(text) || /(?:出图|生图)/i.test(text));
  const asksForImageWithoutTarget = /(?:画一只|画一个|画一张|画出|出图|生图|生成一张|生成一个|做一张|做一个|做个|来一张|来个).{1,80}/i.test(text) && (!textArtifactPattern.test(text) || embeddedTextPattern.test(text));
  const asksForSeparateCopy = separateCopyPattern.test(text) || /(?:图片|海报|封面|宣传图).{0,30}(?:另外|再|同时|并且|以及).{0,30}(?:文案|标题|配文)/i.test(text);
  const textInsideImage = embeddedTextPattern.test(text) && (asksForImage || asksForImageWithoutTarget);

  if (asksForPrompt && !asksForSeparateCopy && !/(?:然后|之后|再|同时|并且).{0,24}(?:出图|生图|生成图片|画图)/i.test(text)) {
    return result('TEXT', '你要的是可复制的提示词，图片只是提示词描述的对象。', 'high', ['提示词交付']);
  }
  if (vagueCreativePattern.test(text)) {
    return result('CLARIFY', '“宣传/新品/活动”没有说明要图片、文案，还是两者都要。', 'low', ['缺少交付形式']);
  }
  if (asksForImage && asksForText && asksForSeparateCopy) {
    return result('BOTH', '同时检测到图片动作和“另外提供文案”的独立交付要求。', 'high', ['图片动作', '独立文案']);
  }
  if (asksForImage || asksForImageWithoutTarget) {
    return result('IMAGE', textInsideImage ? '文字属于图片内部设计，最终交付物仍然是图片。' : hasReferences && imageEditPattern.test(text) ? '检测到参考图和编辑动作，会优先沿用当前视觉上下文。' : '检测到明确的视觉创作动作和目标。', 'high', [textInsideImage ? '图内文字' : '图片动作', hasReferences ? '参考图' : '']);
  }
  if (asksForText) {
    return result('TEXT', '检测到文字创作或文字处理动作，不会因为出现“图片/海报”就切换到生图。', 'high', ['文字动作']);
  }

  const previousImage = latestMessageWithImages(messages);
  if (previousImage && (vagueFollowUpPattern.test(text) || imageEditPattern.test(text))) {
    return result('IMAGE', '上一轮产物是图片，本轮表达更像是在继续修改它。', 'medium', ['上一轮图片', '延续修改']);
  }
  const previousAssistant = [...messages].reverse().find((message) => message?.role === 'assistant' && clean(message.content));
  if (previousAssistant && (vagueFollowUpPattern.test(text) || /(?:短一点|长一点|口语一点|正式一点|换个说法|再写)/i.test(text))) {
    return result('TEXT', '本轮省略了对象，已沿用上一轮的文字回答。', 'medium', ['上一轮文字', '省略指代']);
  }
  if (questionOrAnalysisPattern.test(text)) {
    return result('OTHER', '更像是在提问、分析或寻求方法，不是直接索要视觉产物。', 'medium', ['问答/分析']);
  }
  return result('OTHER', '暂时没有足够信号判断具体交付物，先按普通 Agent 任务处理。', 'low', ['信号不足']);
}

export function agentDeliverableLabel(value: unknown) {
  if (value === 'IMAGE') return imageLabel;
  if (value === 'TEXT') return textLabel;
  if (value === 'BOTH') return bothLabel;
  if (value === 'CLARIFY') return clarifyLabel;
  return otherLabel;
}
