import type { CreationSettings, ImageCreationSettings, VideoCreationSettings } from '../creation/settings';
import type { PublicState, UpscaleOutputFormat } from '../types';
import type { LocalEditAnnotation } from '../local-edit';

export type CanvasNodeType = 'media' | 'prompt' | 'generator' | 'upscale';
export type CanvasMediaKind = 'image' | 'video' | 'audio';
export type CanvasConnectionStyle = 'curve' | 'straight' | 'orthogonal';
export type CanvasGenerationStatus = 'idle' | 'draft' | 'queued' | 'running' | 'completed' | 'failed';
export type CanvasVariantStatus = 'pending' | 'running' | 'completed' | 'failed';
export type CanvasMaskStatus = 'pending' | 'running' | 'used' | 'failed';
export type CanvasInputRole =
  | 'prompt'
  | 'context'
  | 'reference-image'
  | 'audio'
  | 'mask'
  | 'video'
  | 'first-frame'
  | 'last-frame'
  | 'upscale-image';

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

/** Settings owned by an independent canvas upscale node. */
export type CanvasUpscaleParams = {
  kind: "upscale";
  model: string;
  scale: 1 | 2 | 3 | 4;
  target: "auto" | "1K" | "2K" | "4K";
  seed: number;
  colorCorrection: "wavelet" | "none";
  algorithm: "lanczos" | "bicubic" | "nearest";
  outputFormat?: UpscaleOutputFormat;
  outputQuality?: number;
  prompt?: string;
};

export type CanvasNodeParams = CanvasGenerationParams | CanvasUpscaleParams;

export type CanvasGenerationMeta = {
  kind: CanvasMediaKind;
  prompt: string;
  params: CanvasNodeParams;
  operation?: "generate" | "edit" | "upscale" | "extend";
  referenceIds?: string[];
  sourceGeneratorId?: string;
  parentNodeId?: string;
  /** The completed media node whose prompt/parameters were copied for a new branch. */
  reuseSourceNodeId?: string;
  taskId?: string;
  variantBatchId?: string;
  variantIndex?: number;
  variantInstruction?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type CanvasHistoryEntry = {
  id: string;
  operation: "generate" | "edit" | "inpaint" | "outpaint" | "upscale" | "extend";
  prompt: string;
  params?: CanvasNodeParams;
  referenceIds: string[];
  resultIds?: string[];
  parentNodeId?: string;
  taskId?: string;
  status: "pending" | "running" | "completed" | "failed";
  error?: string;
  createdAt: number;
  updatedAt?: number;
};

export type CanvasNodePresentation = {
  hidden?: boolean;
  compoundId?: string;
  role?: "editor" | "lineage" | "result" | "reference";
};

/** Persisted UI/lifecycle metadata for the mask attached to an image node. */
export type CanvasMaskState = {
  url: string;
  assetId?: string;
  /** A locally moved source image that must replace the original first reference. */
  sourceAssetId?: string;
  sourceUrl?: string;
  status: CanvasMaskStatus;
  coverage?: number;
  annotations?: LocalEditAnnotation[];
  taskId?: string;
  error?: string;
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
  /** Timestamp for the currently active generation, used by the canvas timer. */
  processingStartedAt?: number;
  jobId?: string;
  text?: string;
  /** Original Agent request kept alongside the visible response for reruns/audit. */
  agentPrompt?: string;
  /** Latest Agent response rendered in the prompt card. */
  agentResponse?: string;
  prompt?: string;
  params?: CanvasNodeParams;
  /** Video nodes automatically derive their input mode from connected images until locked. */
  videoInputModeAuto?: boolean;
  assetId?: string;
  sourceAssetId?: string;
  /** MIME type of an imported media asset, kept for reliable audio handling. */
  mimeType?: string;
  autoFit?: boolean;
  nativeWidth?: number;
  nativeHeight?: number;
  /** Duration of a loaded video in milliseconds, when available. */
  durationMs?: number;
  /** Identifies the node operation that produced the current media URL. */
  resultSource?: "upscale-node";
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
  editor?: CanvasEditorState;
  history?: CanvasHistoryEntry[];
  presentation?: CanvasNodePresentation;
  /** Mask metadata is kept beside params so the canvas can explain its state. */
  mask?: CanvasMaskState;
  /** True when this result was created from a request that included a mask. */
  maskApplied?: boolean;
  maskSourceNodeId?: string;
  [key: string]: unknown;
};

export type CanvasEditorState = {
  expanded?: boolean;
  draftPrompt?: string;
  draftParams?: CanvasGenerationParams;
  draftReferenceIds?: string[];
  activeHistoryId?: string;
  dirty?: boolean;
};

export type CanvasNode = {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** Persisted paint order inside the transformed canvas world. */
  zIndex?: number;
  groupId?: string;
  data: CanvasNodeData;
};

export type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  /** Optional subset of a grouped source selected for this connection. */
  sourceNodeIds?: string[];
  sourcePort?: 'left' | 'right';
  targetPort?: 'left' | 'right';
  inputRole?: CanvasInputRole;
  order?: number;
  kind?: 'manual' | 'generated' | 'variant' | 'lineage' | 'reference';
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
