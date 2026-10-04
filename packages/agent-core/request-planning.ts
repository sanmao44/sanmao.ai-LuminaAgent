import { extractGithubMcpInstallRequest, resolveAgentWebMode } from '@/lib/agent-web';
import { agentInstructionText, classifyAgentDeliverable, type AgentDeliverable } from '@/lib/agent-intent';
import { isBareImageExecution } from '@/lib/agent-context';
import { classifyAgentRequest, routeNeedsSemanticReview, routeToolSummary, selectAgentContextMessages } from '@/lib/agent-routing';
import { normalizeCreativeReferences, type CreativeReference } from '@/lib/creative-references';

export type AgentPlanningMessage = {
  role: 'user' | 'assistant';
  content: string;
  references?: CreativeReference[] | string[];
  files?: { name: string; content?: string; artifactId?: string }[];
};

export type AgentRequestPlanningInput = {
  body: Record<string, unknown>;
  messages: AgentPlanningMessage[];
  isCanvasSource: boolean;
  isCanvasNodeExecution: boolean;
  canvasTargetNodeIds: readonly string[];
  canvasTargetKind: string;
  canvasTargetOperation: string;
};

export function planAgentRequest(input: AgentRequestPlanningInput) {
  const { body, messages, isCanvasSource, isCanvasNodeExecution, canvasTargetNodeIds, canvasTargetOperation } = input;
  const latest = [...messages].reverse().find((message) => message.role === 'user');
  const latestRefs = normalizeCreativeReferences(latest?.references, 16);
  const latestInstruction = agentInstructionText(body.intentText, latest?.content || '');
  const previousImagePlan = [...messages.slice(0, -1)].reverse().find((message) => message.role === 'assistant'
    && /(?:^|\n)\s*1[\.\u3002\u3001)]/.test(message.content)
    && extractBatchPrompts(message.content).length >= 2);
  const selectedTextBatchPlan = latestRefs
    .filter((reference) => reference.kind === 'text' && typeof reference.text === 'string')
    .map((reference) => reference.text || '')
    .find((text) => extractBatchPrompts(text).length >= 2) || '';
  const batchPlanContent = selectedTextBatchPlan || previousImagePlan?.content || '';
  const intentDecision = classifyAgentDeliverable(latestInstruction, {
    messages: messages.slice(0, -1),
    hasReferences: latestRefs.length > 0,
    hasFiles: Boolean(latest?.files?.length),
  });
  const previousAssistantForRouting = [...messages].reverse().find((message) => message.role === 'assistant')?.content || '';
  const previousUserForGithubInstall = [...messages].slice(0, -1).reverse().find((message) => message.role === 'user')?.content || '';
  const previousContextForGithubInstall = messages.slice(0, -1).map((message) => message.content).join('\n');
  const directGithubMcpRepo = !isCanvasNodeExecution
    ? extractGithubMcpInstallRequest(latestInstruction, previousAssistantForRouting, previousUserForGithubInstall, previousContextForGithubInstall)
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
    || Boolean(previousImagePlan && isBareImageExecution(latestInstruction))
    || Boolean(directGithubMcpRepo)
    || canvasTargetExecution;
  const webMode = isCanvasNodeExecution ? 'off' : resolveAgentWebMode(body.webMode, body.webSearch);
  const routingStartedAt = Date.now();
  const requestRoute = classifyAgentRequest(latestInstruction, {
    messages: messages.slice(0, -1),
    hasReferences: latestRefs.length > 0,
    hasFiles: Boolean(latest?.files?.length),
  }, { webMode: isCanvasNodeExecution ? 'off' : webMode, previousAssistant: previousAssistantForRouting, intent: intentDecision });
  const routerMs = Date.now() - routingStartedAt;
  const latestMessage = messages[messages.length - 1]!;
  const modelContextMessages = [
    ...selectAgentContextMessages(messages.slice(0, -1), requestRoute.contextNeed),
    latestMessage,
  ];
  const routeSummary = requestRoute.needsTools || routeNeedsSemanticReview(requestRoute)
    ? routeToolSummary(requestRoute)
    : { route: requestRoute.route, contextNeed: requestRoute.contextNeed, shouldSearch: requestRoute.web.shouldSearch };
  const hasExplicitDeliverable = ['IMAGE', 'TEXT', 'BOTH', 'CLARIFY', 'OTHER'].includes(String(body.deliverable));
  let requestedDeliverable: AgentDeliverable = requestModeAllowsExecution && hasExplicitDeliverable
    ? body.deliverable as AgentDeliverable
    : requestRoute.intent.deliverable;
  if (previousImagePlan && isBareImageExecution(latestInstruction) && requestModeAllowsExecution) requestedDeliverable = 'IMAGE';
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
