import { createAgentApplicationInfrastructure } from './agent-composition';
import { runAgentApplication, type AgentApplicationInput } from './agent-application';
export { startAgentAssistantRun, readAgentAssistantRun, controlAgentAssistantRun } from './agent-assistant-runs';

/**
 * Composition boundary for the production Agent application entry.
 * Concrete infrastructure is assembled once here and passed into the
 * application; HTTP transport never constructs provider or tool services.
 */
export function runComposedAgentApplication(input: AgentApplicationInput) {
  return runAgentApplication(input, createAgentApplicationInfrastructure());
}
