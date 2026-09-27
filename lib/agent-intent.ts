export type AgentDeliverable = 'IMAGE' | 'TEXT' | 'BOTH' | 'CLARIFY' | 'OTHER';
export type AgentRequestMode = 'execute' | 'ask' | 'discuss' | 'follow_up' | 'unknown';

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
  mode: AgentRequestMode;
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

// Do not treat the noun "画面" as the verb "画". This distinction matters
// for requests such as "描述一下这个画面", especially when a reference image
// is attached: the requested deliverable is text, not a new image.
// 「画布 / 画板 / 画框」同理是名词：画布上下文里到处是"画布"，不能当成"画"这个动作。
const imageActionPattern = /(?:画(?!面|布|板|框|纸|册|廊)|绘制|描绘|涂鸦|出图|生图|生成图片|生成图像|制作海报|做海报|做封面图|做宣传图|生成海报|生成封面|生成插画|生成效果图|改图|修图|重绘|换背景|扩图|抠图|配图|配(?:一|两|几|\d+)?张|渲染|可视化|视觉化|image|picture|poster|illustration|render|visualize)/i;
const imageTargetPattern = /(?:图片|图像|画面|海报|封面图|封面|插画|插图|漫画|头像|壁纸|表情包|图标|logo|banner|配图|信息图|概念图|效果图|宣传图|广告图|主视觉|场景图|吉祥物|IP形象|设计稿|设计图|mascot|image|picture|poster|cover|illustration|avatar|wallpaper|icon)/i;
const imageEditPattern = /(?:修改|调整|改一下|改成|换成|替换|重绘|重制|修图|换背景|去掉|加上|增加|减少|保持主体|延续|继续|再来|更高级|更年轻|更简洁|优化构图|强化光线|调整色彩)/i;
const textArtifactPattern = /(?:文案|标题|正文|文章|脚本|口播|广告语|宣传语|配文|简介|描述|提示词|prompt|代码|程序|报告|方案|清单|表格|摘要|总结|翻译|邮件|回复|文字|方向|创意|灵感|思路|markdown|json|csv|html|css)/i;
// Office / 可下载文档类交付物。出现这些词时用户要的是一份文档，而不是一张图：
// 「做一个 word 简历模板」这类说法会命中下面的“做一个…”弱信号，必须让文档交付优先。
const documentDeliverablePattern = /(?:word|docx|excel|xlsx|ppt|pptx|pdf|文档|文件|简历|报告|周报|日报|月报|纪要|会议记录|总结|汇报|方案|合同|论文|说明书|手册|报表|台账|数据表|幻灯片|演示文稿|演示|deck|模板|自我介绍|报价单|排期表|计划表|预算表|申请表|邀请函|感谢信|演讲稿|发言稿|致辞|问卷)/i;
const textActionPattern = /(?:写|撰写|改写|重写|润色|扩写|缩写|概括|总结|翻译|起|想|生成|整理|提取|反推|解释|分析|比较|输出|提供|列出|优化).{0,48}(?:文案|标题|正文|文章|脚本|口播|广告语|宣传语|配文|简介|描述|提示词|prompt|代码|程序|报告|方案|清单|表格|摘要|文字)/i;
const promptOnlyPattern = /(?:提示词|prompt)/i;
const separateCopyPattern = /(?:另外|再|同时|并且|并|以及|配套|附上|额外).{0,36}(?:给我|提供|写|输出|来).{0,20}(?:文案|标题|配文|广告语|宣传语|脚本|文字)/i;
const embeddedTextPattern = /(?:图上|图片上|海报上|封面上|画面中|带(?:上|有)|加入|写着|写上).{0,28}(?:文字|标题|文案|字样|slogan|口号)/i;
// “去掉画面中的文字”是图片编辑动作；不能因为出现“文字”就路由成文字交付。
const imageTextRemovalPattern = /(?:去掉|删除|移除|擦除).{0,12}(?:画面|图片|海报|图像).{0,8}(?:文字|字样|标题)/i;
// 视觉名词后面如果紧跟“文案/标题/描述”等文字交付，用户要的是文字，
// 不是把这些名词重新生成成图片。中间不跨句，避免误伤“做一张海报，再给三条文案”。
const visualTextArtifactPattern = /(?:图片|图像|海报|封面|插画|插图|漫画|头像|壁纸|宣传图|广告图|主视觉|配图|信息图|概念图|效果图|视觉稿|banner|poster|cover)[^，。！？!?；;]{0,12}(?:文案|标题|描述|说明|提示词|prompt|配文|方案)/i;
const writeForVisualPattern = /(?:给|为|帮).{0,10}(?:图片|图像|海报|封面|插画|宣传图|广告图)[^，。！？!?；;]{0,12}(?:写|生成|优化|提供|输出|整理).{0,12}(?:文案|标题|描述|说明|提示词|prompt|配文)/i;
const questionOrAnalysisPattern = /(?:为什么|怎么做|如何做|教程|步骤|方法|技巧|解释|分析|比较|建议|了解|是什么|是否|能不能|可以吗|吗[？?]?$|[？?]$)/i;
const imageMetadataQuestionPattern = /(?:这张|这幅|该图|这张图|这幅图|图片|图像|结果|刚才|上一张).{0,36}(?:用什么|哪个|哪种|什么模型|模型名称|模型型号|服务商|供应商|参数|尺寸|比例|来源|生成记录|生成时间|生成信息)/i;
const vagueCreativePattern = /(?:帮我|给我|请|我要|我想要|麻烦|来|做|搞|弄|生成|制作|创建|设计).{0,16}(?:宣传|推广|营销|广告|活动|新品|内容|方案|套|东西)(?:吧|呢|呀|啊)?$/i;
const vagueFollowUpPattern = /^(?:继续|再来一个|再来一版|再来几版|这个再|这张再|按刚才|按照刚才|基于这个|基于这张|把它|它再|再短一点|再详细一点|更高级一点|更年轻一点|更简洁一点|优化一下|改一下|换一下|调整一下)/i;

// 先判断用户的“请求模式”，再判断交付物。这里识别的是句子的言语行为
// （询问、讨论、执行、承接上一轮），而不是把某个功能词直接映射到工具。
// 这层是图片、文件、联网、MCP 和 Skill 路由共用的安全闸门。
const capabilityQuestionPattern = /^(?:你)?(?:能否|能不能|能|可以|支持|会不会|会).{0,96}(?:吗|么|呢)[？?]$/i;
const taskLeadPattern = /^(?:请(?!问)|麻烦(?!问)|帮我|给我|给我们|替我|为我|我想(?:要|让你|生成|制作|创建|写|改写|润色|总结|翻译|分析|描述|搜索|打开|执行)|我(?:要|需要)(?!了解|知道|确认|咨询|问|弄清楚)|需要你|直接|开始|继续|再来|按照刚才|基于这个|把它|将其)/i;
const taskVerbPattern = /(?:生成|制作|创建|写|撰写|改写|润色|总结|翻译|分析|解释|描述|列出|整理|提取|搜索|查询|打开|访问|点击|填写|提交|下载|导出|保存|读取|修改|删除|运行|部署|打包|压缩|渲染|绘制|安装|接入|连接|导入|生图|出图)/i;
const questionShapePattern = /^(?:为什么|怎么(?:做|办)|如何|什么是|是什么|能否|能不能|是否|可以吗|支持吗|请问|告诉我|解释一下|分析一下|比较一下|建议一下|你觉得).*[？?]?$|[？?]$/i;

/**
 * A capability word is not an execution frame. The frame has to be visible in
 * the sentence: an imperative/request lead, a direct action lead, a
 * context-to-action construction (“基于这张图生成…”), or an explicit
 * delegation (“创意交给你”). This is intentionally structural: a sentence
 * such as “我的默认生图模型已经设置” contains the capability noun but has
 * no request frame, so it cannot authorize a side effect.
 */
const directTaskLeadPattern = /^(?:生成|制作|创建|写|撰写|改写|润色|总结|翻译|分析|解释|描述|列出|整理|提取|搜索|查询|打开|访问|点击|填写|提交|下载|导出|保存|读取|修改|删除|运行|部署|打包|压缩|渲染|绘制|优化|改|换|去掉|安装|接入|连接|导入|生图|出图|做|出(?:个|一张|张)?|来(?:个|一张|张)?|画)(?=\s|[一二三四五六七八九十百千万\d个只条张幅份位篇猫狗鱼鸟图画字构背景文字\u4e00-\u9fff])/i;
const contextualTaskPattern = /^(?:根据|按照|基于|用|按|把|将).{0,80}(?:生成|制作|创建|写|撰写|改写|润色|总结|翻译|分析|解释|描述|列出|整理|提取|搜索|查询|打开|访问|点击|填写|提交|下载|导出|保存|读取|修改|删除|运行|部署|打包|压缩|渲染|绘制|生图|出图|改成|换成)/i;
const delegatedTaskPattern = /^我(?:只(?:说|提供|给你|告诉你)|仅(?:说|提供|给你|告诉你)).{0,32}(?:目标|要求|想法|描述).{0,32}(?:交给你|由你|你来)/i;
const declarativeStatePattern = /^(?:(?:我|我的|当前|默认|系统|助手|模型|他|她|它|刚才|上一轮|这次)[^！？?!]{0,96}(?:已经|已|正在|尚未|还没|没有|没|并未|并没有|不需要|不该|误|错误地|居然|竟然|自动|擅自|设置|配置|启用|接入|连接|开启|关闭|完成|失败|报错|生效|调用了|使用了|生成了|生图了|出图了)[^！？?!]{0,96})$/i;
const unwantedActionReportPattern = /^(?:我(?:没有|没|并未|并没有)[^！？?!]{0,40}(?:生图|出图|生成图片|图片需求)|(?:他|她|它|系统|助手|模型|刚才|上一轮)[^！？?!]{0,60}(?:误|错误地|居然|竟然|自动|擅自|给我|替我|帮我)[^！？?!]{0,80}(?:生图|出图|生成图片|调用|执行))/i;

function hasExplicitExecutionFrame(text: string) {
  if (declarativeStatePattern.test(text) || unwantedActionReportPattern.test(text)) return false;
  return taskLeadPattern.test(text)
    || directTaskLeadPattern.test(text)
    || contextualTaskPattern.test(text)
    || delegatedTaskPattern.test(text)
    || taskVerbPattern.test(text);
}

function isNonExecutableStatement(text: string) {
  return declarativeStatePattern.test(text) || unwantedActionReportPattern.test(text);
}

/**
 * Infer the user's speech act before selecting a deliverable or tool.
 * A feature noun is never sufficient to authorize execution by itself.
 */
export function inferAgentRequestMode(input: string): AgentRequestMode {
  const text = clean(input);
  if (!text) return 'unknown';
  if (vagueFollowUpPattern.test(text) && text.length <= 32) return 'follow_up';

  const capabilityQuestion = capabilityQuestionPattern.test(text);
  const genericQuestion = questionShapePattern.test(text)
    || /^(?:请问|麻烦问一下|我想(?:了解|知道|确认)|我要(?:了解|知道|确认)|我需要(?:了解|知道|确认)|帮我(?:了解|确认|弄清楚)).*[？?]?$/.test(text);
  const explicitTask = hasExplicitExecutionFrame(text);
  // A capability-leading question that merely contains an action verb is
  // still a question. A concrete imperative followed by “可以吗？” is the
  // opposite: it is an execution request asking for confirmation.
  // “你能帮我打开网页吗？” must not become a browser command. An imperative
  // lead such as “请帮我打开网页，可以吗？” is the explicit exception.
  if (capabilityQuestion) return 'ask';
  if (genericQuestion && !explicitTask && !taskLeadPattern.test(text)) return 'ask';

  if (explicitTask) return 'execute';
  if (/(?:分析|比较|评估|讨论|解释|说明|原因|方案|思路|建议)/i.test(text)) return 'discuss';
  return 'unknown';
}

function clean(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function latestMessageWithImages(messages: AgentIntentMessage[]) {
  return [...messages].reverse().find((message) => message?.role === 'assistant' && Array.isArray(message.images) && message.images.length);
}

function result(deliverable: AgentDeliverable, reason: string, confidence: AgentIntentDecision['confidence'], signals: string[], mode: AgentRequestMode = 'execute'): AgentIntentDecision {
  const metadata: Record<AgentDeliverable, { label: string; summary: string }> = {
    IMAGE: { label: imageLabel, summary: '我会优先准备图片生成或图片编辑能力。' },
    TEXT: { label: textLabel, summary: '我会先给你可复制、可继续修改的文字内容。' },
    BOTH: { label: bothLabel, summary: '我会同时准备视觉产物和独立可复制的配套文案。' },
    CLARIFY: { label: clarifyLabel, summary: '这句话有两种合理方向，先确认交付形式可以少走一步。' },
    OTHER: { label: otherLabel, summary: '我会先按问答、分析或其他任务处理，不擅自调用生图。' },
  };
  return { deliverable, mode, ...metadata[deliverable], reason, confidence, signals };
}

/**
 * Decide what the user expects to receive, rather than classifying by a
 * single visual keyword. This is intentionally small and explainable so the
 * UI can show the decision and the server can use the same contract.
 */
function classifyAgentDeliverableCore(input: string, context: AgentIntentContext = {}): AgentIntentDecision {
  const text = clean(input);
  const messages = Array.isArray(context.messages) ? context.messages : [];
  const hasReferences = Boolean(context.hasReferences);
  const hasFiles = Boolean(context.hasFiles);
  const requestMode = inferAgentRequestMode(text);
  if (!text && (hasReferences || hasFiles)) {
    return result('OTHER', hasReferences ? '检测到参考图，默认先分析内容；你可以补充“修改”或“反推提示词”。' : '检测到文件，默认先读取并处理文件内容。', 'medium', [hasReferences ? '参考图' : '文件']);
  }
  if (!text) return result('OTHER', '还没有足够的文字目标。', 'low', []);

  if (requestMode === 'unknown' && isNonExecutableStatement(text)) {
    return result('OTHER', '用户正在陈述配置、已发生的动作或异常反馈，不把其中提到的能力当成本轮执行指令。', 'high', ['陈述/反馈'], requestMode);
  }

  // This gate must precede image/document heuristics. Questions about a
  // capability or a plan are conversational turns even when they contain the
  // exact name of a generative feature.
  if (requestMode === 'ask' || requestMode === 'discuss') {
    return result(
      'OTHER',
      requestMode === 'ask' ? '用户在询问能力或事实，先文字回答，不执行工具。' : '用户在讨论、分析或评估方案，先文字回答，不执行交付工具。',
      'high',
      [requestMode === 'ask' ? '询问模式' : '讨论模式'],
      requestMode,
    );
  }

  // 描述图片/画面是文字交付；不要被通用的“解释/分析”规则吞成普通问答。
  if (/(?:描述|描写).{0,20}(?:画面|图片|图像|这张图|这幅图|参考图)/i.test(text)) {
    return result('TEXT', '用户要的是对图片内容的文字描述。', 'high', ['图片描述'], requestMode);
  }

  if (/(?:不要|别|不需要|暂不|先不)(?:再)?(?:出图|生图|画图|生成图片|生成图像)/.test(text)) {
    return result('TEXT', '用户明确要求本轮不生成图片。', 'high', ['禁止生图']);
  }
  if (imageMetadataQuestionPattern.test(text) || /(?:用什么模型|哪个模型|什么服务商|生成参数|图片尺寸|生成尺寸|生成来源|生成记录).{0,24}(?:吗|？|\?|是什么|是哪个)/i.test(text)) {
    return result('OTHER', '用户在询问已有图片的生成元数据，只需文字回答，不应再次生成图片。', 'high', ['图片元数据']);
  }
  const asksForPrompt = promptOnlyPattern.test(text) && /(?:写|生成|优化|改写|润色|反推|提取|翻译|解释|给我|输出|提供|整理|怎么|如何|只要|仅需)/i.test(text);
  const asksForVisualText = visualTextArtifactPattern.test(text) || writeForVisualPattern.test(text);
  const asksForText = !imageTextRemovalPattern.test(text) && (textActionPattern.test(text) || asksForVisualText || ((textArtifactPattern.test(text) || documentDeliverablePattern.test(text)) && !imageActionPattern.test(text)));
  const asksForImage = !asksForVisualText && (imageActionPattern.test(text) || /(?:做|生成|制作|创建|设计|来).{0,12}(?:一张|一幅|一个|个|张|幅|海报|封面|宣传图|图片|插画)/i.test(text)) && (imageTargetPattern.test(text) || /(?:出图|生图)/i.test(text));
  // 口语里经常省略“一”（例如“画只猫”“画条鱼”）。这类请求虽然没有
  // “图片 / 海报”等目标名词，仍然是在明确索要视觉产物。
  const asksForImageWithoutTarget = !asksForVisualText && /(?:画(?:个|一?只|一个|一张|一幅|一?条|一?头|一?匹|一?朵|一?辆|一?艘|一?座|一?棵|一?位)|画出|出图|生图|生成一张|生成一个|做一张|来一张).{1,80}/i.test(text) && !documentDeliverablePattern.test(text) && (!textArtifactPattern.test(text) || embeddedTextPattern.test(text));
  const asksHowToCreateImage = /(?:怎么|如何|教我|教程|步骤|方法|技巧).{0,24}(?:画|绘制|生成图片|做图)/i.test(text);
  const asksForSeparateCopy = separateCopyPattern.test(text) || /(?:图片|海报|封面|宣传图).{0,30}(?:另外|再|同时|并且|以及).{0,30}(?:文案|标题|配文)/i.test(text);
  const textInsideImage = embeddedTextPattern.test(text) && (asksForImage || asksForImageWithoutTarget);
  const asksToEditReference = hasReferences
    && imageEditPattern.test(text)
    && !asksForText
    && !questionOrAnalysisPattern.test(text)
    && !/(?:描述|分析|解释|总结|提取|识别|比较|建议)/i.test(text);

  if (asksForPrompt && !asksForSeparateCopy && !/(?:然后|之后|再|同时|并且).{0,24}(?:出图|生图|生成图片|画图)/i.test(text)) {
    return result('TEXT', '你要的是可复制的提示词，图片只是提示词描述的对象。', 'high', ['提示词交付']);
  }
  if (/^(?:请|直接|现在|帮我|给我)?(?:出|生成)(?:个|一张|张)?(?:图片|图像|图)(?:看下|看看)?(?:[，,\s]*(?:1:1|2:3|3:2|3:4|4:3|9:16|16:9|21:9))?[吧啊！!。.\s]*$/.test(text)) {
    return result('IMAGE', '用户用口语明确要求实际出图。', 'high', ['口语生图指令']);
  }
  if (vagueCreativePattern.test(text)) {
    return result('CLARIFY', '“宣传/新品/活动”没有说明要图片、文案，还是两者都要。', 'low', ['缺少交付形式']);
  }
  if (/^(?:请|帮我|给我)?(?:生成|画|绘制|制作).{1,100}(?:场景|场面|情景)(?:图)?[吧。！!]*$/.test(text)
    && !/(?:视频|动画|脚本|代码|提示词|文案|文字|描述|怎么|如何)/i.test(text)) {
    return result('IMAGE', '用户要求把场景生成成图片。', 'high', ['场景生成']);
  }
  if (asksToEditReference) {
    return result('IMAGE', '检测到参考图和明确的修改动作，会按图片编辑任务处理。', 'high', ['参考图', '编辑动作']);
  }
  if (asksForImage && asksForText && asksForSeparateCopy) {
    return result('BOTH', '同时检测到图片动作和“另外提供文案”的独立交付要求。', 'high', ['图片动作', '独立文案']);
  }
  if ((asksForImage || asksForImageWithoutTarget) && !asksHowToCreateImage) {
    return result('IMAGE', textInsideImage ? '文字属于图片内部设计，最终交付物仍然是图片。' : hasReferences && imageEditPattern.test(text) ? '检测到参考图和编辑动作，会优先沿用当前视觉上下文。' : '检测到明确的视觉创作动作和目标。', 'high', [textInsideImage ? '图内文字' : '图片动作', hasReferences ? '参考图' : '']);
  }
  if (asksForText) {
    return result('TEXT', '检测到文字创作或文字处理动作，不会因为出现“图片/海报”就切换到生图。', 'high', ['文字动作']);
  }

  const previousAssistant = [...messages].reverse().find((message) => message?.role === 'assistant' && (clean(message.content) || message.images?.length));
  const previousImage = latestMessageWithImages(messages);
  if (previousImage && (previousAssistant === previousImage || /(?:图|背景|构图|光线|色彩)/.test(text)) && !questionOrAnalysisPattern.test(text) && (vagueFollowUpPattern.test(text) || imageEditPattern.test(text))) {
    return result('IMAGE', '上一轮产物是图片，本轮表达更像是在继续修改它。', 'medium', ['上一轮图片', '延续修改']);
  }
  if (previousAssistant && (vagueFollowUpPattern.test(text) || /(?:短一点|长一点|口语一点|正式一点|换个说法|再写)/i.test(text))) {
    return result('TEXT', '本轮省略了对象，已沿用上一轮的文字回答。', 'medium', ['上一轮文字', '省略指代']);
  }
  if (questionOrAnalysisPattern.test(text)) {
    return result('OTHER', '更像是在提问、分析或寻求方法，不是直接索要视觉产物。', 'medium', ['问答/分析']);
  }
  return result('OTHER', '暂时没有足够信号判断具体交付物，先按普通 Agent 任务处理。', 'low', ['信号不足']);
}

/**
 * Public intent contract. The deliverable rules remain explainable and
 * local, while the request mode is normalized once at the boundary so every
 * caller receives the same execution/ask/discuss decision.
 */
export function classifyAgentDeliverable(input: string, context: AgentIntentContext = {}): AgentIntentDecision {
  const decision = classifyAgentDeliverableCore(input, context);
  const mode = inferAgentRequestMode(input);
  // A high-confidence local deliverable classification is enough to preserve
  // a direct creative/document command whose wording does not start with a
  // typical imperative (for example “画一只猫” or “做一份周报”). It never
  // upgrades OTHER, and questions/discussions have already returned above.
  const effectiveMode = mode === 'unknown'
    && decision.confidence === 'high'
    && decision.deliverable !== 'OTHER'
    ? 'execute'
    : mode;
  return effectiveMode === decision.mode ? decision : { ...decision, mode: effectiveMode };
}

/**
 * 画布等调用方会把系统上下文（节点摘要、提示词等）拼在用户消息末尾，这些内容不是
 * 用户指令：一旦参与意图判断，"画布 / 图片 / 渲染"等词会把普通提问误判成生图请求。
 * 调用方可以把用户原话单独传进来，这里只做取值和兜底。
 */
export function agentInstructionText(intentText: unknown, fallback: unknown) {
  const value = clean(intentText);
  return (value || clean(fallback)).slice(0, 4000);
}

/** Ambiguous commands get one semantic planning pass, not a paid tool guess. */
export function needsSemanticIntent(input: string, decision: AgentIntentDecision) {
  return decision.confidence !== 'high' && /(?:生成|制作|创建|设计|执行|开始|继续|按.{0,8}(?:做|来)|改成|换成|就这样|可以|好的|^\d+$)/.test(input)
    && !/(?:不要|别|暂不|先不|怎么|如何|为什么|是什么|[?？]$)/.test(input);
}

export function parseSemanticIntent(content: unknown): AgentIntentDecision | null {
  if (typeof content !== 'string') return null;
  try {
    const parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) as Record<string, unknown>;
    if (!['IMAGE', 'TEXT', 'BOTH', 'CLARIFY', 'OTHER'].includes(String(parsed.deliverable))) return null;
    if (parsed.confidence !== 'high') return null;
    const mode = ['execute', 'ask', 'discuss', 'follow_up', 'unknown'].includes(String(parsed.mode))
      ? String(parsed.mode) as AgentRequestMode
      : (parsed.deliverable === 'OTHER' || parsed.deliverable === 'CLARIFY' ? 'unknown' : 'execute');
    return result(parsed.deliverable as AgentDeliverable, String(parsed.reason || '结合当前对话理解用户要求。').slice(0, 240), 'high', ['上下文语义判断'], mode);
  } catch { return null; }
}

export function agentDeliverableLabel(value: unknown) {
  if (value === 'IMAGE') return imageLabel;
  if (value === 'TEXT') return textLabel;
  if (value === 'BOTH') return bothLabel;
  if (value === 'CLARIFY') return clarifyLabel;
  return otherLabel;
}
