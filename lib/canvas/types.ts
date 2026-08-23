import type { CreationSettings, ImageCreationSettings, VideoCreationSettings } from '../creation/settings';
import type { PublicState } from '../types';

export type CanvasNodeType = 'media' | 'prompt' | 'generator';
export type CanvasMediaKind = 'image' | 'video';
export type CanvasConnectionStyle = 'curve' | 'straight' | 'orthogonal';
export type CanvasGenerationStatus = 'idle' | 'draft' | 'queued' | 'running' | 'completed' | 'failed';
export type CanvasVariantStatus = 'pending' | 'running' | 'completed' | 'failed';

export type CanvasVariantState = {
  id: string;
  instruction: string;
  status: CanvasVariantStatus;
  resultIds: string[];
  taskIds?: string[];
  progress?: number;
  error?: string;
  updatedAt?: number;
};

export type CanvasImageGenerationParams = ImageCreationSettings;
export type CanvasVideoGenerationParams = VideoCreationSettings;
export type CanvasGenerationParams = CreationSettings;

export type CanvasGenerationMeta = {
  kind: CanvasMediaKind;
  prompt: string;
  params: CanvasGenerationParams;
  referenceIds?: string[];
  sourceGeneratorId?: string;
  parentNodeId?: string;
  taskId?: string;
  variantBatchId?: string;
  variantIndex?: number;
  variantInstruction?: string;
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
  /** Original Agent request kept alongside the visible response for reruns/audit. */
  agentPrompt?: string;
  /** Latest Agent response rendered in the prompt card. */
  agentResponse?: string;
  prompt?: string;
  params?: CanvasGenerationParams;
  assetId?: string;
  sourceAssetId?: string;
  autoFit?: boolean;
  nativeWidth?: number;
  nativeHeight?: number;
  referenceOrder?: string[];
  generation?: CanvasGenerationMeta;
  /** One line per requested batch variation on a generator node. */
  variantRequirements?: string[];
  /** Editing buffer that preserves empty lines while the user types. */
  variantRequirementsText?: string;
  /** Runtime/persisted status for each variation in the latest batch. */
  variantStates?: CanvasVariantState[];
  variantBatchId?: string;
  variantGroupId?: string;
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

/** Backward-compatible name used by the canvas client. Runtime state is the app's public registry. */
export type CanvasRuntimeState = PublicState;

export type CanvasSnapshot = Pick<CanvasDocument, 'nodes' | 'edges' | 'groups' | 'camera'>;
