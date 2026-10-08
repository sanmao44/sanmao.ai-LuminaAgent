import type { AgentInformationDecision } from '../contracts/planning';

export type AgentInformationRoutingSignals = {
  capabilityQuestion: boolean;
  browserAutomation: boolean;
  filesystem: boolean;
  externalAction: boolean;
  webShouldSearch: boolean;
};

const externalEntityPattern = /\b(?:openai|anthropic|google|gemini|claude|github|gitlab|api|sdk|npm|pricing|release)\b|(?:OpenAI|Anthropic|谷歌|微软|GitHub|GitLab|接口|价格|版本发布)/i;
const capabilityTopicPattern = /(?:pptx?|幻灯片|演示文稿|word|excel|表格|文档|文件|图片|生图|改图|联网|搜索|浏览器|mcp|技能|画布|模型|视频|音频|代码|zip|压缩包|工具)/i;

function capabilityTopic(text: string) {
  return text.match(capabilityTopicPattern)?.[0];
}

/**
 * Decide where an answer's authoritative information should come from.
 * Freshness is only one signal: a current-looking question about this product
 * must stay on the internal capability projection, while an outside entity
 * may use the web route.
 */
export function classifyAgentInformationSource(
  input: string,
  signals: AgentInformationRoutingSignals,
): AgentInformationDecision {
  const text = String(input || '').replace(/\s+/g, ' ').trim();
  if (signals.browserAutomation) return { source: 'browser', needsExternalWeb: false, reason: '用户要求在网页中观察或操作，信息由浏览器工具提供。' };
  if (signals.filesystem) return { source: 'local-workspace', needsExternalWeb: false, reason: '用户询问或操作本地工作区，信息由文件系统工具或当前项目提供。' };
  if (signals.externalAction) return { source: 'external-service', needsExternalWeb: false, reason: '用户指向已接入的外部服务，信息应由受控连接器提供。' };
  const externalEntity = externalEntityPattern.test(text);
  if (signals.capabilityQuestion && /^(?:什么是|啥是|何为|请问什么是|解释一下什么是)/i.test(text)) {
    return { source: 'model-knowledge', needsExternalWeb: false, reason: '问题询问稳定概念定义，不需要读取产品运行时能力。' };
  }
  if (signals.capabilityQuestion && !externalEntity) {
    const topic = capabilityTopic(text);
    return {
      source: 'internal-capability',
      needsExternalWeb: false,
      reason: '问题询问的是当前产品或助手能力，应读取运行时能力快照。',
      ...(topic ? { capabilityTopic: topic } : {}),
    };
  }
  if (signals.webShouldSearch) return { source: 'external-web', needsExternalWeb: true, reason: externalEntity ? '问题涉及外部实体的最新或可核验事实。' : '问题需要外部世界的最新或可核验事实。' };
  if (signals.capabilityQuestion) return { source: 'model-knowledge', needsExternalWeb: false, reason: '问题是一般能力或概念问答，不需要外部实时信息。' };
  return { source: /[?？]|(?:什么是|是什么|为什么|如何|怎么)/i.test(text) ? 'model-knowledge' : 'conversation', needsExternalWeb: false, reason: '当前请求不需要外部实时信息。' };
}
