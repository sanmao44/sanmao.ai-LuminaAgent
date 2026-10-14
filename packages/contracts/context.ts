export type WorkspaceContext = {
  schemaVersion: 1;
  creativeProjectId: string;
  chatId?: string;
  canvasId?: string;
  selectedNodeIds: string[];
  assetIds: string[];
  updatedAt: number;
};

export type GenerationSource = 'workspace' | 'agent' | 'canvas';

export type CanvasAgentTargetKind = 'none' | 'text' | 'image' | 'video' | 'mixed';

export type CanvasAgentTargetOperation = 'generate' | 'edit';
