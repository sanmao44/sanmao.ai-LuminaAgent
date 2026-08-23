export type CanvasNodeType = 'media' | 'prompt' | 'generator';
export type CanvasMediaKind = 'image' | 'video';
export type CanvasGenerationStatus = 'idle' | 'draft' | 'queued' | 'running' | 'completed' | 'failed';

export type CanvasGenerationParams = {
  model?: string;
  aspect?: string;
  resolution?: string;
  quality?: string;
  count?: number;
  duration?: number;
  audio?: boolean;
};

export type CanvasGenerationMeta = {
  kind: CanvasMediaKind;
  prompt: string;
  params: CanvasGenerationParams;
  referenceIds?: string[];
  sourceGeneratorId?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type CanvasNodeData = {
  kind?: CanvasMediaKind;
  url?: string;
  name?: string;
  role?: string;
  model?: string;
  status?: CanvasGenerationStatus;
  statusLabel?: string;
  progress?: number;
  jobId?: string;
  text?: string;
  autoFit?: boolean;
  nativeWidth?: number;
  nativeHeight?: number;
  referenceOrder?: string[];
  generation?: CanvasGenerationMeta;
  [key: string]: unknown;
};

export type CanvasNode = {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  w?: number;
  h?: number;
  groupId?: string;
  data: CanvasNodeData;
};

export type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  sourcePort?: 'left' | 'right';
  targetPort?: 'left' | 'right';
  kind?: 'manual' | 'generated' | 'variant' | 'lineage';
};

export type CanvasGroup = {
  id: string;
  name: string;
  nodeIds: string[];
};

export type CanvasCamera = {
  x: number;
  y: number;
  zoom: number;
};

export type CanvasDocument = {
  version: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  groups: CanvasGroup[];
  camera: CanvasCamera;
};

export type CanvasProject = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type CanvasRuntimeModel = {
  id: string;
  providerId: string;
  providerName: string;
  displayName: string;
  kind: 'image' | 'video' | 'chat' | 'unknown';
  enabled: boolean;
  published: boolean;
  capabilities?: string[];
};

export type CanvasRuntimeState = {
  models: CanvasRuntimeModel[];
  providers: Array<{ id: string; name: string; status?: string }>;
  settings: {
    defaultImageModelId?: string | null;
    defaultVideoModelId?: string | null;
  };
};

export type CanvasSnapshot = Pick<CanvasDocument, 'nodes' | 'edges' | 'groups' | 'camera'>;
