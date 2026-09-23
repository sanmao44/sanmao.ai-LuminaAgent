import type { CreationSettings, ImageCreationSettings, VideoCreationSettings } from '../creation/settings';
import type { PublicState, UpscaleOutputFormat } from '../types';
import type { LocalEditAnnotation } from '../local-edit';
import type {
  AngleCameraState,
  AngleOutputSpec,
  LightingState,
  SubjectType,
  ViewMode,
} from '../angle-control';
import type { ProvenanceEdge } from '../provenance/types';

export type CanvasNodeType = 'media' | 'prompt' | 'generator' | 'upscale' | 'video-editor' | 'angle';
export type CanvasMediaKind = 'image' | 'video' | 'audio';
/** A non-destructive range that reuses the original video source. */
export type CanvasVideoClipState = {
  version: 1;
  /** Source node kept only for provenance; playback still uses `data.url`. */
  sourceNodeId?: string;
  startTime: number;
  endTime: number;
  volume: number;
  muted: boolean;
  playbackRate: 0.5 | 1 | 1.5 | 2;
  fit: 'contain' | 'cover';
  scale?: number;
  x?: number;
  y?: number;
  opacity?: number;
};
export type CanvasVideoEditorTrack = 'video' | 'audio' | 'reference-audio' | 'caption' | 'graphics';
export type CanvasVideoEditorClipType = 'image' | 'video' | 'audio' | 'caption';
export type CanvasVideoEditorTransition = 'cut' | 'fade' | 'dissolve' | 'wipe' | 'slide' | 'none';
export type CanvasVideoEditorMotionPath = 'none' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down' | 'zoom-in' | 'zoom-out';
/** Normalized text box recovered from a reference frame (top-left origin). */
export type CanvasVideoEditorTextBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** A timed token inside a caption clip, relative to that clip's start. */
export type CanvasVideoEditorWord = {
  start: number;
  end: number;
  text: string;
};

/**
 * A small, deterministic layout contract recovered from a reference shot.
 * It describes composition rather than generated pixels so browser preview,
 * browser export, and FFmpeg can consume the same data.
 */
export type CanvasVideoEditorLayoutMode = 'full' | 'split-horizontal' | 'split-vertical' | 'picture-in-picture' | 'card';
export type CanvasVideoEditorLayoutRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
};
export type CanvasVideoEditorLayout = {
  mode: CanvasVideoEditorLayoutMode;
  backgroundColor?: string;
  surfaceColor?: string;
  accentColor?: string;
  gap?: number;
  padding?: number;
  radius?: number;
  primary?: CanvasVideoEditorLayoutRegion;
  secondary?: CanvasVideoEditorLayoutRegion;
};

export type CanvasVideoEditorClip = {
  id: string;
  /** Original semantic clip id when a clone timeline is opened in the editor. */
  sourceClipId?: string;
  /** Original clone shot index used by the server-side re-assembler. */
  shotIndex?: number;
  /** Reusable clone visual component this clip instantiates, when present. */
  componentId?: string;
  /** Semantic clone role (performance, B-roll, graphic, transition, ...). */
  role?: string;
  sourceNodeId?: string;
  track: CanvasVideoEditorTrack;
  type: CanvasVideoEditorClipType;
  name: string;
  start: number;
  /** Duration on the editor timeline (after the clip playback rate is applied). */
  duration: number;
  sourceOffset: number;
  text?: string;
  /** Word-level caption timing. Times are relative to this clip's start. */
  words?: CanvasVideoEditorWord[];
  /** Explicit caption font size in output pixels. */
  fontSize?: number;
  /** Caption background opacity, from transparent to opaque. */
  captionBackgroundOpacity?: number;
  /** Semantic role for text overlays; graphics are kept separate from narration captions. */
  textRole?: 'caption' | 'graphics';
  /** Original visual-card style hint retained for a later renderer/editor pass. */
  graphicsStyle?: string;
  /** Normalized visual-card text box, kept separate from the manual x/y nudge. */
  textBox?: CanvasVideoEditorTextBox;
  /** Explicit composition recovered from the reference shot. */
  layout?: CanvasVideoEditorLayout;
  scale?: number;
  opacity?: number;
  x?: number;
  y?: number;
  volume?: number;
  playbackRate?: 0.5 | 1 | 1.5 | 2;
  fit?: 'contain' | 'cover';
  fadeIn?: number;
  /** Transition applied when this video clip enters after the previous V1 clip. */
  transitionIn?: CanvasVideoEditorTransition;
  transitionDuration?: number;
  transitionDirection?: 'left' | 'right' | 'up' | 'down';
  /** Normalized motion cue recovered from the reference shot analysis. */
  motionPath?: CanvasVideoEditorMotionPath;
};

export type CanvasVideoEditorState = {
  version: 1;
  projectDuration: number;
  fps: number;
  aspect: string;
  /** Output canvas quality preset used by the editor preview/export handoff. */
  resolution?: "720p" | "1080p" | "2K" | "4K";
  clips: CanvasVideoEditorClip[];
  mutedTracks: CanvasVideoEditorTrack[];
  /** Lower reference ambience/music while the clone voice track is speaking. */
  referenceAudioDucking?: boolean;
  /** Tracks hidden from preview and export. Missing means every track is enabled. */
  disabledTracks?: CanvasVideoEditorTrack[];
};
export type CanvasConnectionStyle = 'curve' | 'straight' | 'orthogonal';
export type CanvasGenerationStatus = 'idle' | 'draft' | 'queued' | 'running' | 'completed' | 'failed';
export type CanvasVariantStatus = 'pending' | 'running' | 'completed' | 'failed';
export type CanvasMaskStatus = 'pending' | 'running' | 'used' | 'failed';
/** Local, non-generative image operations available from an image node. */
export type CanvasImageOperation = 'outpaint' | 'resize' | 'crop' | 'grid' | 'grid-compose' | 'transform';

export type CanvasImageOperationMeta = {
  operation: CanvasImageOperation;
  sourceNodeId?: string;
  sourceNodeIds?: string[];
  inputWidth: number;
  inputHeight: number;
  outputWidth: number;
  outputHeight: number;
  prompt?: string;
  params?: Record<string, string | number | boolean | number[]>;
  createdAt?: number;
};
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

/** Persisted controls for the dedicated image-to-image angle node. */
export type CanvasAngleParams = {
  kind: 'angle';
  camera: AngleCameraState;
  cameraStart: AngleCameraState | null;
  subjectType: SubjectType;
  cameraMode: ViewMode;
  lighting: LightingState;
  angleNote: string;
  angleGuide: boolean;
  output: AngleOutputSpec;
  referenceNodeId?: string;
  referenceMedia?: {
    id?: string;
    name?: string;
    url?: string;
    assetId?: string;
  };
};

/** Alias kept explicit for callers that model the node rather than its params. */
export type CanvasAngleNodeConfig = CanvasAngleParams;

export type CanvasNodeParams = CanvasGenerationParams | CanvasUpscaleParams;

export type CanvasGenerationMeta = {
  kind: CanvasMediaKind;
  prompt: string;
  /** Prompt entered by the user, excluding opaque preset instructions. */
  userPrompt?: string;
  params: CanvasNodeParams;
  modelId?: string;
  modelName?: string;
  providerName?: string;
  presetId?: string;
  presetName?: string;
  /** Identifies the automatic image-to-video workflow. */
  generationType?: "one_click_cinematic" | string;
  sourceImageNodeId?: string;
  sourceImageUrl?: string;
  sourceImageAssetId?: string;
  duration?: number;
  wowLevel?: 1 | 2 | 3 | 4 | 5;
  directingMode?: "auto" | "one_take" | "montage";
  aspectRatio?: string;
  creativity?: "strict" | "balanced" | "bold";
  userDirection?: string;
  directorPlan?: Record<string, unknown>;
  finalVideoPrompt?: string;
  negativePrompt?: string;
  error?: string;
  /** Full provenance for an image produced by a dedicated angle node. */
  angle?: {
    camera: AngleCameraState;
    cameraStart: AngleCameraState | null;
    angleNote: string;
    angleGuide: boolean;
    output: AngleOutputSpec;
    referenceNodeId?: string;
    referenceMedia?: {
      id?: string;
      name?: string;
      url?: string;
      assetId?: string;
    };
  };
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
  /** Elapsed time from request start until the provider returned the result. */
  durationMs?: number;
  updatedAt?: number;
  provenance?: ProvenanceEdge[];
};

export type CanvasHistoryEntry = {
  id: string;
  operation: "generate" | "edit" | "inpaint" | "outpaint" | "upscale" | "extend";
  prompt: string;
  presetId?: string;
  presetName?: string;
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
  /** A locally composed move guide sent to the provider beside the original source. */
  sourceAssetId?: string;
  sourceUrl?: string;
  /** Inline move guide retained for older canvas documents. */
  sourceImageDataUrl?: string;
  status: CanvasMaskStatus;
  coverage?: number;
  annotations?: LocalEditAnnotation[];
  /** Feather radius in source-image pixels, clamped to 0–48 on restore. */
  feather?: number;
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
  providerName?: string;
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
  /** Distinguishes an explicit manual lock from legacy auto-mode state. */
  videoInputModeLocked?: boolean;
  assetId?: string;
  sourceAssetId?: string;
  /** MIME type of an imported media asset, kept for reliable audio handling. */
  mimeType?: string;
  autoFit?: boolean;
  nativeWidth?: number;
  nativeHeight?: number;
  /** Duration of a loaded video in milliseconds, when available. */
  durationMs?: number;
  /** Native media duration for a referenced video clip, in milliseconds. */
  sourceDurationMs?: number;
  /** Trim and playback metadata for a video node; editor outputs may materialize it. */
  videoClip?: CanvasVideoClipState;
  /** Identifies the node operation that produced the current media URL. */
  resultSource?: "upscale-node";
  referenceOrder?: string[];
  generation?: CanvasGenerationMeta;
  /** One line per requested batch variation on a generator node. */
  variantRequirements?: string[];
  /** Editing buffer that preserves empty lines while the user types. */
  variantRequirementsText?: string;
  smartVariantSnapshot?: {
    categories: string[];
    variants: { instruction: string; category?: string; sources?: string[] }[];
    sources: { id: string; name: string; text: string }[];
  };
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
  /** Metadata for a locally rendered image transform. */
  imageOperation?: CanvasImageOperationMeta;
  /** Persisted edit plan for a video-editor node; it is not a rendered media URL. */
  videoEditor?: CanvasVideoEditorState;
  /** Metadata for a locally generated depth-map video. */
  depthVideo?: {
    sourceNodeId?: string;
    model?: string;
    mode?: "grayscale";
    fps?: number;
    frameCount?: number;
    startedAt?: number;
    completedAt?: number;
  };
  /** Configuration for an independent angle node. */
  angle?: CanvasAngleParams;
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
  /** Persisted top-level paint order shared with ungrouped nodes. */
  zIndex?: number;
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
  /** Stable creative-project identity shared with chat, assets and tasks. */
  projectId?: string;
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
