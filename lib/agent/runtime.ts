/**
 * TEMPORARY MIGRATION ADAPTER
 *
 * The route still imports from the legacy lib alias while the core contracts
 * settle. Remove this bridge when the HTTP adapter can import packages/
 * directly without breaking the existing test harness.
 */
export { AgentRuntime } from '../../packages/agent-core/runtime';
export type { AgentMessage, ModelDescriptor } from '../../packages/contracts';
export { runPlainAgentTurn } from '../../apps/api/agent-entry';
