import { classifyAgentDeliverable, inferAgentRequestMode, type AgentDeliverable, type AgentIntentContext, type AgentIntentDecision, type AgentIntentMessage } from '@/lib/agent-intent';
import { likelyArtifactGenerationRequest, likelyBrowserAutomationRequest, likelyFileGenerationRequest, likelyFilesystemRequest, likelyMcpManagementRequest, shouldUseAgentWebSearch, type AgentWebDecision, type AgentWebMode } from '@/lib/agent-web';

export type AgentArtifactKind = 'none' | 'word' | 'excel' | 'ppt' | 'archive' | 'file';
export type AgentContextNeed = 'none' | 'recent' | 'required';
export type AgentRequestRoute = 'chat' | 'text' | 'image' | 'both' | 'word' | 'excel' | 'ppt' | 'archive' | 'file' | 'browser' | 'filesystem' | 'web' | 'clarify';
export type AgentToolPlan = {
  useMcp: boolean;
  useBrowserMcp: boolean;
  useFilesystemMcp: boolean;
  useSkills: boolean;
  useNativeWeb: boolean;
  useNativeArtifact: boolean;
  reason: string;
};

export type AgentRouteCandidate = {
  route: AgentRequestRoute;
  score: number;
  signals: string[];
};

export type AgentRequestDecision = {
  intent: AgentIntentDecision;
  route: AgentRequestRoute;
  artifactKind: AgentArtifactKind;
  contextNeed: AgentContextNeed;
  contextReason: string;
  browserAutomation: boolean;
  filesystem: boolean;
  web: AgentWebDecision;
  needsTools: boolean;
  tools: AgentToolPlan;
  candidates: AgentRouteCandidate[];
};

const creationVerbPattern = /(?:生成|制作|创建|导出|下载|保存|整理|整理成|输出|写|准备|打包|压缩|做成|做一份|做一个|来一份|来一个|给我一份|给我一个)/i;
const wordPattern = /(?:word|docx|文档|报告|方案|合同|简历|周报|日报|月报|纪要|会议记录|报价单|排期表|计划表|预算表|申请表|邀请函|感谢信|演讲稿|发言稿|致辞|问卷|汇报|论文|说明书|手册)/i;
const excelPattern = /(?:excel|xlsx|表格|报表|台账|清单|数据表|排期表|计划表|预算表)/i;
const pptPattern = /(?:ppt|pptx|幻灯片|演示文稿|演示|deck)/i;
const archivePattern = /(?:zip|压缩包|打包|压缩成|资料包)/i;
const filePattern = /(?:文件|附件|csv|tsv|json|markdown|\.md\b|\.txt\b|\.html\b|\.css\b|\.svg\b|\.xml\b|\.yaml\b|代码文件|脚本文件)/i;
const contextReferencePattern = /(?:刚才|上一条|上面|之前|此前|继续|再来|再写|再做|基于|按照|按刚才|这个|这张|这份|该|它|他|她|同上|沿用|保持|换成|改成|第[一二三四五六七八九十\d]+张)/i;
const selfContainedPattern = /(?:只根据这句话|只看本句|不要结合上下文|无需上下文|独立回答|不参考历史|不用参考之前)/i;
const skillNeedPattern = /(?:技能|skill|工作流|流程|规范|指南|模板|调试|排查|报错|bug|修复|部署|发布|重构|测试|代码库)/i;
const externalServiceActionPattern = /(?:mcp|model context protocol|接入|连接|调用|同步|提交|发送|发到|创建|更新|删除|读取|查看|列出|搜索|查询).{0,24}(?:github|gitlab|notion|slack|飞书|钉钉|云盘|数据库|仓库|远程服务|外部服务|连接器|api)|(?:github|gitlab|notion|slack|飞书|钉钉|云盘|数据库|仓库|远程服务|外部服务|连接器).{0,24}(?:接入|连接|调用|同步|提交|发送|创建|更新|删除|读取|查看|列出|搜索|查询)/i;

function artifactKindFor(text: string) {
  if (!creationVerbPattern.test(text)) return 'none' as const;
  if (archivePattern.test(text)) return 'archive' as const;
  if (pptPattern.test(text)) return 'ppt' as const;
  if (excelPattern.test(text) && !/(?:封面图|图片|配图)/i.test(text)) return 'excel' as const;
  if (wordPattern.test(text) && !/(?:封面图|图片|配图)/i.test(text)) return 'word' as const;
  if (filePattern.test(text)) return 'file' as const;
  return 'none' as const;
}

function contextDecision(text: string, messages: AgentIntentMessage[]) {
  if (selfContainedPattern.test(text) || !messages.length) return { need: 'none' as const, reason: '本轮没有必要读取旧对话。' };
  if (contextReferencePattern.test(text) || text.length <= 12) return { need: 'required' as const, reason: '检测到省略、指代或短确认，需要最近对话才能执行。' };
  return { need: 'recent' as const, reason: '保留少量近期消息，避免把完整历史重复发送给模型。' };
}

function candidate(route: AgentRequestRoute, score: number, ...signals: string[]): AgentRouteCandidate {
  return { route, score, signals: signals.filter(Boolean) };
}

/**
 * Shared local first-pass router. It borrows Fast Browser Use's useful idea:
 * constrain the model to a small, inspectable candidate set before execution.
 * It does not require a local model; ambiguous requests can still use the
 * already configured cloud model as a semantic tie-breaker.
 */
export function classifyAgentRequest(input: string, context: AgentIntentContext = {}, options: { webMode?: AgentWebMode; previousAssistant?: string; intent?: AgentIntentDecision } = {}): AgentRequestDecision {
  const text = String(input || '').replace(/\s+/g, ' ').trim();
  const messages = Array.isArray(context.messages) ? context.messages : [];
  // The API route already classifies the latest user instruction before it
  // builds this bounded route plan. Reuse that result to avoid running the
  // same regex classifier twice on every request.
  const intent = options.intent || classifyAgentDeliverable(text, context);
  const requestMode = intent.mode || inferAgentRequestMode(text);
  const executable = requestMode === 'execute' || requestMode === 'follow_up';
  const artifactKind = artifactKindFor(text);
  const browserAutomation = executable && likelyBrowserAutomationRequest(text);
  const filesystem = executable && likelyFilesystemRequest(text, options.previousAssistant || '');
  const contextInfo = contextDecision(text, messages);
  // `context.messages` is the prior conversation for callers from the Agent
  // route, so do not drop its newest item a second time. That item is often
  // exactly the topic needed to resolve a short web follow-up.
  const webContext = contextInfo.need === 'none' ? [] : messages.slice(-8).map((message) => ({
    role: (message.role === 'assistant' || message.role === 'user' ? message.role : undefined) as 'assistant' | 'user' | undefined,
    content: message.content,
  }));
  const web = executable
    ? shouldUseAgentWebSearch(options.webMode || 'auto', text, webContext)
    : { shouldSearch: false, reason: 'ordinary-chat' as const, query: text };
  // Non-execution modes never enter an executable candidate route. This is a
  // shared side-effect gate for capability questions, discussions and unclear
  // turns; feature words alone cannot activate image/file/web/MCP/Skill work.
  if (!executable) {
    return {
      intent,
      route: 'chat',
      artifactKind: 'none',
      contextNeed: contextInfo.need,
      contextReason: contextInfo.reason,
      browserAutomation: false,
      filesystem: false,
      web,
      needsTools: false,
      tools: {
        useMcp: false,
        useBrowserMcp: false,
        useFilesystemMcp: false,
        useSkills: false,
        useNativeWeb: false,
        useNativeArtifact: false,
        reason: '当前是询问、讨论或未确认的请求模式，先正常回复。',
      },
      candidates: [candidate('chat', 60, '询问、讨论或待确认请求')],
    };
  }
  const candidates: AgentRouteCandidate[] = [];
  if (browserAutomation) candidates.push(candidate('browser', 112, '页面操作动作'));
  if (filesystem) candidates.push(candidate('filesystem', 110, '本地文件或项目操作'));
  if (artifactKind !== 'none') candidates.push(candidate(artifactKind, 108, '明确文件格式和交付动词'));
  if (intent.deliverable === 'IMAGE') candidates.push(candidate('image', intent.confidence === 'high' ? 106 : 76, ...intent.signals));
  if (intent.deliverable === 'BOTH') candidates.push(candidate('both', intent.confidence === 'high' ? 106 : 76, ...intent.signals));
  if (intent.deliverable === 'TEXT') candidates.push(candidate('text', intent.confidence === 'high' ? 104 : 72, ...intent.signals));
  if (web.shouldSearch) candidates.push(candidate('web', 102, web.reason));
  if (intent.deliverable === 'CLARIFY') candidates.push(candidate('clarify', 80, '交付形式不明确'));
  if (!candidates.length) candidates.push(candidate('chat', 60, '普通对话或问答'));
  candidates.sort((a, b) => b.score - a.score);
  const route = candidates[0].route;
  const needsTools = ['image', 'both', 'word', 'excel', 'ppt', 'archive', 'file', 'browser', 'filesystem'].includes(route);
  // A site name alone is not enough to load a connector: "搜索 GitHub 最新
  // 资料" belongs to the normal web path. MCP is reserved for explicit
  // connector/service actions or local/browser execution.
  const explicitExternalAction = externalServiceActionPattern.test(text)
    && /(?:mcp|连接|接入|调用|同步|提交|发送|创建|更新|删除)/i.test(text);
  const useMcp = browserAutomation || filesystem || likelyMcpManagementRequest(text) || explicitExternalAction;
  const useBrowserMcp = browserAutomation;
  const useFilesystemMcp = filesystem;
  const useSkills = !browserAutomation && !filesystem && !intent.deliverable.toString().match(/^(IMAGE|BOTH)$/) && skillNeedPattern.test(text) && !/^(?:什么是|解释|介绍|为什么|如何理解)/i.test(text);
  const useNativeWeb = web.shouldSearch && !browserAutomation && !filesystem;
  const useNativeArtifact = artifactRouteIsGenerated(route) || likelyFileGenerationRequest(text) || likelyArtifactGenerationRequest(text);
  const reason = useMcp ? '检测到外部服务或本地执行动作，优先使用受控 MCP。'
    : useSkills ? '检测到流程/模板/规范需求，先按需检索技能。'
      : useNativeWeb ? '检测到需要外部事实，先联网再回答。'
        : useNativeArtifact ? '检测到明确文件交付，调用对应内置工具。' : '普通回答不加载额外工具。';
  return { intent, route, artifactKind, contextNeed: contextInfo.need, contextReason: contextInfo.reason, browserAutomation, filesystem, web, needsTools, tools: { useMcp, useBrowserMcp, useFilesystemMcp, useSkills, useNativeWeb, useNativeArtifact, reason }, candidates };
}

/** Keep enough recent context for continuity while dropping stale turns. */
export function selectAgentContextMessages<T extends AgentIntentMessage>(messages: T[], need: AgentContextNeed) {
  if (need === 'required') return messages.slice(-10);
  if (need === 'recent') return messages.slice(-4);
  return [];
}

export function artifactRouteIsGenerated(route: AgentRequestRoute) {
  return route === 'word' || route === 'excel' || route === 'ppt' || route === 'archive' || route === 'file';
}

export function routeDeliverable(route: AgentRequestRoute, intent: AgentDeliverable): AgentDeliverable {
  if (route === 'image') return 'IMAGE';
  if (route === 'both') return 'BOTH';
  if (route === 'clarify') return 'CLARIFY';
  if (route === 'text' || artifactRouteIsGenerated(route)) return 'TEXT';
  return intent;
}

export function routeNeedsSemanticReview(decision: AgentRequestDecision) {
  const top = decision.candidates[0];
  const next = decision.candidates[1];
  if (!top || decision.route === 'clarify') return true;
  // A short contextual acknowledgement (for example “好的”) has no local
  // deliverable signal. Let the already configured cloud model resolve it
  // once against the bounded recent context instead of guessing a tool route.
  if (decision.intent.mode === 'unknown' && decision.intent.deliverable === 'OTHER' && decision.contextNeed === 'required') return true;
  return Boolean(next && top.score - next.score < 8 && !['browser', 'filesystem'].includes(top.route));
}

export type CompactPlainTurnInput = {
  isCanvasSource: boolean;
  isCanvasNodeExecution: boolean;
  isTextPolishTask: boolean;
  isReversePromptTask: boolean;
  isOneTakeVideoPromptTask: boolean;
  isCinematicDirectorTask: boolean;
  isSmartVariantPlanningTask: boolean;
  identityQuestion: boolean;
  needsWebSearch: boolean;
  browserAutomationRequest: boolean;
  filesystemRequest: boolean;
  imageGenerationRequest: boolean;
  fileGenerationRequest: boolean;
  artifactGenerationRequest: boolean;
  canvasPatchRequest: boolean;
  tools: AgentToolPlan;
};

/**
 * A conservative gate for the small prompt path. Any possibility of an
 * external side effect, search, creative delivery, or special task stays on
 * the full Agent prompt and tool pipeline.
 */
export function canUseCompactPlainTurn(input: CompactPlainTurnInput) {
  return !input.isCanvasSource
    && !input.isCanvasNodeExecution
    && !input.isTextPolishTask
    && !input.isReversePromptTask
    && !input.isOneTakeVideoPromptTask
    && !input.isCinematicDirectorTask
    && !input.isSmartVariantPlanningTask
    && !input.tools.useMcp
    && !input.tools.useSkills
    && !input.tools.useNativeWeb
    && !input.needsWebSearch
    && !input.browserAutomationRequest
    && !input.filesystemRequest
    && !input.identityQuestion
    && !input.imageGenerationRequest
    && !input.fileGenerationRequest
    && !input.artifactGenerationRequest
    && !input.canvasPatchRequest;
}

export function routeToolSummary(decision: AgentRequestDecision) {
  return {
    route: decision.route,
    artifactKind: decision.artifactKind,
    contextNeed: decision.contextNeed,
    shouldSearch: decision.web.shouldSearch,
    browserAutomation: decision.browserAutomation,
    filesystem: decision.filesystem,
    tools: decision.tools,
    candidates: decision.candidates.slice(0, 4),
  };
}
