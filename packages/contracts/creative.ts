export type CreativeReference = {
  id: string;
  kind: 'image' | 'video' | 'text';
  name: string;
  url?: string;
  text?: string;
  mimeType?: string;
  nodeId?: string;
  pending?: boolean;
  error?: string;
};

/**
 * Shared creative routing contract for the main Agent and Canvas Agent.
 * `lane` controls which tools may run; `operation` describes visual work.
 */
export type CreativeLane = 'prompt' | 'image' | 'chat' | 'clarify';
export type CreativeOperation = 'none' | 'generate' | 'edit' | 'reference-generate';
export type CreativeExecution = 'none' | 'preview' | 'run';

export type CreativeRoute = {
  lane: CreativeLane;
  operation: CreativeOperation;
  execution: CreativeExecution;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  requiresReference: boolean;
};
