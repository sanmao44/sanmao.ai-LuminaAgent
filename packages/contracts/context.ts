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
