import type {
  AgentContextNeed,
  AgentDeliverable,
  AgentIntentContext,
  AgentIntentDecision,
  AgentPlanningMessage,
  AgentRequestDecision,
  AgentWebMode,
  CreativeReference,
} from '../contracts/planning';
import type { SkillRouteDecision } from '../contracts/skill';

export type { AgentPlanningMessage } from '../contracts/planning';

export type AgentPlanningPorts = {
  extractGithubMcpInstallRequest: (input: string, previousAssistantText?: string, previousUserText?: string, previousContextText?: string) => string | null;
  resolveAgentWebMode: (value: unknown, legacy?: unknown) => AgentWebMode;
  agentInstructionText: (intentText: unknown, fallback: unknown) => string;
  classifyAgentDeliverable: (input: string, context?: AgentIntentContext) => AgentIntentDecision;
  isBareImageExecution: (input: string) => boolean;
  classifyAgentRequest: (input: string, context?: AgentIntentContext, options?: { webMode?: AgentWebMode; previousAssistant?: string; intent?: AgentIntentDecision; skillRoute?: SkillRouteDecision }) => AgentRequestDecision;
  routeSkillRequest?: (input: string) => SkillRouteDecision;
  routeNeedsSemanticReview: (decision: AgentRequestDecision) => boolean;
  routeToolSummary: (decision: AgentRequestDecision) => Record<string, unknown>;
  selectAgentContextMessages: (messages: AgentPlanningMessage[], need: AgentContextNeed) => AgentPlanningMessage[];
  normalizeCreativeReferences: (input: unknown, max?: number) => CreativeReference[];
};

export type AgentRequestPlanningInput = {
  body: Record<string, unknown>;
  messages: AgentPlanningMessage[];
  isCanvasSource: boolean;
  isCanvasNodeExecution: boolean;
  canvasTargetNodeIds: readonly string[];
  canvasTargetKind: string;
  canvasTargetOperation: string;
  ports: AgentPlanningPorts;
};

export function planAgentRequest(input: AgentRequestPlanningInput) {
  const { body, messages, isCanvasSource, isCanvasNodeExecution, canvasTargetNodeIds, canvasTargetOperation, ports } = input;
  const latest = [...messages].reverse().find((message) => message.role === 'user');
  const latestRefs = ports.normalizeCreativeReferences(latest?.references, 16);
  const latestInstruction = ports.agentInstructionText(body.intentText, latest?.content || '');
  const previousImagePlan = [...messages.slice(0, -1)].reverse().find((message) => message.role === 'assistant'
    && /(?:^|\n)\s*1[\.\u3002\u3001)]/.test(message.content)
    && isExplicitImageBatchPlan(message.content)
    && extractBatchPrompts(message.content).length >= 2);
  const selectedTextBatchPlan = latestRefs
    .filter((reference) => reference.kind === 'text' && typeof reference.text === 'string')
    .map((reference) => reference.text || '')
    .find((text) => extractBatchPrompts(text).length >= 2) || '';
  const batchPlanContent = selectedTextBatchPlan || previousImagePlan?.content || '';
  const intentDecision = ports.classifyAgentDeliverable(latestInstruction, {
    messages: messages.slice(0, -1),
    hasReferences: latestRefs.length > 0,
    hasFiles: Boolean(latest?.files?.length),
  });
  const previousAssistantForRouting = [...messages].reverse().find((message) => message.role === 'assistant')?.content || '';
  const previousUserForGithubInstall = [...messages].slice(0, -1).reverse().find((message) => message.role === 'user')?.content || '';
  const previousContextForGithubInstall = messages.slice(0, -1).map((message) => message.content).join('\n');
  const directGithubMcpRepo = !isCanvasNodeExecution
    ? ports.extractGithubMcpInstallRequest(latestInstruction, previousAssistantForRouting, previousUserForGithubInstall, previousContextForGithubInstall)
    : null;
  const canvasTargetExecution = isCanvasSource
    && body.executionMode === 'agent-dock'
    && canvasTargetNodeIds.length > 0
    && canvasTargetOperation === 'edit'
    && intentDecision.mode !== 'ask'
    && intentDecision.mode !== 'discuss'
    && Boolean(latestInstruction.trim());
  let requestModeAllowsExecution = intentDecision.mode === 'execute'
    || intentDecision.mode === 'follow_up'
    || Boolean(previousImagePlan && ports.isBareImageExecution(latestInstruction))
    || Boolean(directGithubMcpRepo)
    || canvasTargetExecution;
  const webMode = isCanvasNodeExecution ? 'off' : ports.resolveAgentWebMode(body.webMode, body.webSearch);
  const routingStartedAt = Date.now();
  const skillRoute = ports.routeSkillRequest?.(latestInstruction) || {
    enabled: false,
    matched: false,
    explicit: false,
    confidence: 'none' as const,
    skillId: '',
    skillName: '',
    reason: '未执行技能路由。',
  };
  const requestRoute = ports.classifyAgentRequest(latestInstruction, {
    messages: messages.slice(0, -1),
    hasReferences: latestRefs.length > 0,
    hasFiles: Boolean(latest?.files?.length),
  }, { webMode: isCanvasNodeExecution ? 'off' : webMode, previousAssistant: previousAssistantForRouting, intent: intentDecision, skillRoute });
  if (requestRoute.tools.useSkills && requestRoute.skillRoute.matched) requestModeAllowsExecution = true;
  // Read-only GitHub repository queries are intentionally classified from a
  // question-shaped sentence, but they still need the normal MCP discovery
  // and execution path. This does not authorize writes; the MCP approval and
  // catalog policy remain the final side-effect gates.
  if (requestRoute.tools.useMcp && requestRoute.route === 'chat' && requestRoute.policy.discoverMcp) {
    requestModeAllowsExecution = true;
  }
  const routerMs = Date.now() - routingStartedAt;
  const latestMessage = messages[messages.length - 1]!;
  const modelContextMessages = [
    ...ports.selectAgentContextMessages(messages.slice(0, -1), requestRoute.contextNeed),
    latestMessage,
  ];
  const routeSummary = requestRoute.needsTools || ports.routeNeedsSemanticReview(requestRoute)
    ? ports.routeToolSummary(requestRoute)
    : { route: requestRoute.route, contextNeed: requestRoute.contextNeed, shouldSearch: requestRoute.web.shouldSearch, information: requestRoute.information };
  const hasExplicitDeliverable = ['IMAGE', 'TEXT', 'BOTH', 'CLARIFY', 'OTHER'].includes(String(body.deliverable));
  let requestedDeliverable: AgentDeliverable = requestModeAllowsExecution && hasExplicitDeliverable
    ? body.deliverable as AgentDeliverable
    : requestRoute.intent.deliverable;
  if (previousImagePlan && ports.isBareImageExecution(latestInstruction) && requestModeAllowsExecution) requestedDeliverable = 'IMAGE';
  let requestedIntentReason = hasExplicitDeliverable && typeof body.intentReason === 'string' && body.intentReason.trim()
    ? body.intentReason.trim().slice(0, 320)
    : requestRoute.intent.reason;
  if (isCanvasNodeExecution) {
    requestedDeliverable = 'TEXT';
    requestedIntentReason = 'canvas node execution is text-only; side effects belong to the Agent dock';
  }
  return { latest, latestRefs, latestInstruction, latestReferenceImageCount: latestRefs.filter((reference) => reference.kind !== 'text').length, previousImagePlan, batchPlanContent, previousAssistantForRouting, directGithubMcpRepo, intentDecision, requestModeAllowsExecution, setRequestModeAllowsExecution(value: boolean) { requestModeAllowsExecution = value; }, webMode, requestRoute, routerMs, modelContextMessages, routeSummary, requestedDeliverable, setRequestedDeliverable(value: AgentDeliverable) { requestedDeliverable = value; }, requestedIntentReason, setRequestedIntentReason(value: string) { requestedIntentReason = value; } };
}

function extractBatchPrompts(content: string): string[] {
  const prompts = content.split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:\d+[\.\u3002\u3001)]|[\u4e00-\u9fff]+[\u3002\u3001)])\s*(.+?)\s*$/)?.[1] || '')
    .map((prompt) => prompt.replace(/\s+/g, ' ').trim())
    .filter((prompt) => prompt.length >= 8)
    .slice(0, 20);
  return prompts.length >= 2 ? prompts : [];
}

function isExplicitImageBatchPlan(content: string): boolean {
  const text = content.replace(/\s+/g, ' ').trim();
  if (!text || /(?:下一版可尝试方向|你还可以继续|继续尝试方向)/i.test(text)) return false;
  return /(?:批量(?:生图|出图|生成)?|套图|详情图|一套图|一组图|系列图|多张图|组图|(?:一次|共|分成).{0,8}\d+\s*张|\d+\s*张(?:图|图片))/i.test(text);
}
