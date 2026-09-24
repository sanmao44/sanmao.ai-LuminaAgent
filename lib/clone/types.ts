/**
 * 「一键克隆出片」的数据结构（一期窄管线）。
 *
 * 当前边界：不贴脸、不换脸、不做数字人；主体镜头优先用参考帧/参考视频参与重建，
 * 卡片、分栏和转场优先保留原片动态；声音用用户已配的 TTS，没有可用 TTS 时降级为本地语音或字幕。
 */
import type { CanvasVideoEditorClip, CanvasVideoEditorState, CanvasVideoEditorMotionPath, CanvasVideoEditorLayout, CanvasVideoEditorWord } from '../canvas/types';

export type CloneStage =
  | 'queued'
  | 'analyzing'
  | 'scripting'
  | 'planned'
  | 'voicing'
  | 'imaging'
  | 'rendering'
  | 'assembling'
  | 'done'
  | 'failed'
  | 'cancelled';

export type CloneShotStatus = 'pending' | 'voicing' | 'imaging' | 'rendering' | 'done' | 'failed';
export type CloneShotSpeechMode = 'narration' | 'talking' | 'silent';

export type CloneShotReferenceRole = 'performance' | 'broll' | 'graphic' | 'transition' | 'product' | 'other';

/** A semantic, shot-local event recovered from the reference timeline. */
export type CloneVisualEvent = {
  id?: string;
  kind: 'graphics' | 'broll' | 'effect';
  /** Seconds relative to the containing shot, not the whole project. */
  start: number;
  end: number;
  /** Optional source-speech anchor used to re-project the event after rewriting/voicing. */
  anchorText?: string;
  /** Optional zero-based source word range, end-exclusive, within the shot transcript. */
  anchorStartWord?: number;
  anchorEndWord?: number;
  text?: string;
  prompt?: string;
  style?: string;
  effect?: string;
  position?: string;
  mediaKind?: 'image' | 'video';
  source?: 'reference-video' | 'generated-media';
  url?: string;
};

export type CloneOcrBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CloneOcrObservation = {
  text: string;
  bounds?: CloneOcrBounds;
  confidence?: number;
  source: 'tesseract' | 'transformers' | 'vision';
};

export type CloneReferenceOcrFrame = {
  time: number;
  observations: CloneOcrObservation[];
};

export type CloneShotAnalysis = {
  camera?: string;
  composition?: string;
  motion?: string;
  visualStyle?: string;
  graphics?: string;
  /** OCR/vision 提取到的画卡、标题或贴纸文字。 */
  graphicsText?: string;
  /** 画卡在画面中的位置，例如 top、center、bottom 或更具体的描述。 */
  graphicsPosition?: string;
  /** 画卡的视觉样式，例如纯色卡、描边字、品牌贴纸。 */
  graphicsStyle?: string;
  effect?: string;
  graphicsBounds?: CloneOcrBounds;
  /** 可直接交给时间轴渲染器的显式构图层，避免 composition 只停留在文字提示。 */
  layout?: CanvasVideoEditorLayout;
  audio?: string;
  transition?: string;
  /** 结构化转场类型；transition 保留为兼容旧任务的文字描述。 */
  transitionType?: 'cut' | 'fade' | 'dissolve' | 'wipe' | 'slide' | 'none';
  transitionDuration?: number;
  /** 连续运动的可执行描述，后续可映射为关键帧或镜头曲线。 */
  motionPath?: string;
  role?: CloneShotReferenceRole;
  /** Word/event-oriented visual timing, kept separate from the shot boundary. */
  events?: CloneVisualEvent[];
};

export type CloneTranscriptWord = {
  start: number;
  end: number;
  text: string;
};

export type CloneTranscriptSegment = {
  start: number;
  end: number;
  text: string;
  words?: CloneTranscriptWord[];
};

/** Locally recovered speech from the reference video's original audio track. */
export type CloneTranscript = {
  text: string;
  segments: CloneTranscriptSegment[];
  words: CloneTranscriptWord[];
  model: string;
  language?: string;
};

/** Local, model-free rhythm cues recovered from the reference audio. */
export type CloneBeatCue = {
  time: number;
  strength: number;
};

export type CloneReferenceEvidenceReason =
  | 'overview'
  | 'scene-before'
  | 'scene-after'
  | 'beat'
  | 'speech-boundary';

/** One locally selected frame and the signals that made it worth inspecting. */
export type CloneReferenceEvidenceSample = {
  time: number;
  reasons: CloneReferenceEvidenceReason[];
};

export type CloneReferenceAnalysis = {
  version: 1;
  duration: number;
  sampleTimes: number[];
  /** The local evidence map used to choose the frames sent to visual analysis. */
  evidence?: CloneReferenceEvidenceSample[];
  /** Locally detected hard cuts used to guide vision analysis and fallback planning. */
  sceneChangeTimes?: number[];
  method: 'multimodal-frames' | 'fallback';
  transcript?: string;
  transcriptData?: CloneTranscript;
  /** Energy peaks used to keep local transitions/effects aligned to the source rhythm. */
  beats?: CloneBeatCue[];
  /** 可选的本地 OCR 结果；视觉模型字段仍作为没有 OCR 引擎时的兜底。 */
  ocr?: CloneReferenceOcrFrame[];
  /** Global visual grammar recovered once for the whole reference video. */
  visualBible?: CloneVisualBible;
  shots: Array<{
    index: number;
    start: number;
    end: number;
    analysis?: CloneShotAnalysis;
  }>;
};

/** Stable identity/style constraints shared by generated shots in one clone. */
export type CloneVisualBible = {
  subjectIdentity?: string;
  productIdentity?: string;
  brandLanguage?: string;
  visualStyle?: string;
  palette?: string;
  lighting?: string;
  cameraGrammar?: string;
  continuityRules?: string;
  negativeConstraints?: string;
};

/** 一个镜头：参考视频里的一个时间段，对应一句新文案和一份重新生成的素材。 */
export type CloneShot = {
  index: number;
  /** 参考视频里的起止时间（秒），仅用于拆解与展示。 */
  start: number;
  end: number;
  /** 参考视频里这一段画面在讲什么（拆解结果）。 */
  visual: string;
  /** 重写后的口播文案，一句一镜。 */
  line: string;
  /** 重新生成画面用的提示词。 */
  prompt: string;
  /** A structural gap emitted when the vision model skipped part of the reference timeline. */
  referenceGap?: boolean;
  /** 原片对应镜头的结构化拆解，用于生成提示词和后续多轨编辑。 */
  analysis?: CloneShotAnalysis;
  /** 当前镜头实际使用的素材；缺少该字段的历史任务才继承全局素材。 */
  assetIds?: string[];
  strategy?: 'reference' | 'keyframe' | 'text' | 'static';
  /** 声音与画面的关系：Talking 镜头只在视频模型支持时才传声音参考。 */
  speechMode?: CloneShotSpeechMode;
  preserveIdentity?: boolean;
  preserveProduct?: boolean;
  status: CloneShotStatus;
  imageUrl?: string;
  videoUrl?: string;
  /** 原片该镜头最接近中点的代表帧，供静态图/首帧降级使用。 */
  referenceFrameUrl?: string;
  /** 图形/卡片镜头优先保留原片代表帧，避免重新生成时把字卡和版式改掉。 */
  preserveReferenceFrame?: boolean;
  /** Allow a Blueprint variant to add an intentional overlay on a preserved reference shot. */
  allowReferenceOverlays?: boolean;
  /** 临时生成的原片对应镜头片段；只作为视频模型输入，不作为最终交付节点。 */
  referenceVideoUrl?: string;
  audioUrl?: string;
  /** 这一句配音的实际时长（秒）；没有 TTS 时为空，改用字数估算。 */
  audioSeconds?: number;
  /** Local word alignment for the generated voice clip, relative to this shot. */
  audioWords?: CloneTranscriptWord[];
  error?: string;
};

export type CloneOptions = {
  brief: string;
  maxShots: number;
  maxSeconds: number;
  aspect: '9:16' | '16:9' | '1:1';
  voice: string;
  /** 默认保留参考视频的镜头节奏；旁白过长时只向后延展，不压缩原片镜头。 */
  preserveReferenceTiming: boolean;
  /** 默认把参考视频的环境音/音乐作为底轨，与新配音混音。 */
  preserveReferenceAudio: boolean;
};

export type CloneCapabilities = {
  vision: boolean;
  speech: boolean;
  image: boolean;
  video: boolean;
  referenceImages: boolean;
  /** 视频模型是否能接收参考视频；启用后会优先传入原片对应时间片段。 */
  referenceVideo?: boolean;
  firstFrame: boolean;
  referenceAudio: boolean;
  /** 没有在线 TTS 模型时，是否改用系统自带语音合成（Windows / macOS 的「本机离线配音」）。 */
  offlineSpeech: boolean;
};

export type CloneReference = {
  nodeId?: string;
  name: string;
  url: string;
  seconds: number;
  kind?: 'image' | 'video';
};

/** 用户提供给克隆管线的身份/产品/品牌素材；sourceVideo 与这些素材职责不同。 */
export type CloneAssetRole = 'person' | 'product' | 'brand' | 'scene' | 'style' | 'broll' | 'voice';
export type CloneAssetKind = 'image' | 'video' | 'audio';
export type CloneAsset = {
  nodeId?: string;
  name: string;
  url: string;
  kind: CloneAssetKind;
  role: CloneAssetRole;
};

export type CloneModels = {
  chat: string;
  image?: string;
  video?: string;
  speech?: string;
};

/** 高级设置里显式选择的模型 id：为「自动」的轨道不写，执行时按 id 精确取模型。 */
export type CloneModelIds = Partial<CloneModels>;

/** 可复用的克隆蓝图：保留结构、素材依赖与策略，而非只保存一次性成片。 */
export type CloneBlueprint = {
  version: 1;
  sourceVideo: CloneReference;
  assets: CloneAsset[];
  shots: CloneShot[];
  /** Shared visual constraints reused by local variants and rerenders. */
  visualBible?: CloneVisualBible;
  /** Reusable rhythm cues recovered from the source audio. */
  beats?: CloneBeatCue[];
  /** Reusable visual grammar recovered from repeated shot structures. */
  components?: CloneBlueprintComponent[];
  /** Optional named local variants; the base Blueprint remains unchanged. */
  variants?: CloneBlueprintVariantSpec[];
  createdAt: string;
  updatedAt: string;
};

export type CloneBlueprintComponentSource = 'preserve-reference' | 'generate-media';

/** A reusable visual component template; shot indexes are its instances. */
export type CloneBlueprintComponent = {
  id: string;
  role: CloneShotReferenceRole;
  label: string;
  source: CloneBlueprintComponentSource;
  shotIndexes: number[];
  layout?: CanvasVideoEditorLayout;
  motionPath?: CanvasVideoEditorMotionPath;
  graphicsStyle?: string;
  transitionType?: CloneShotAnalysis['transitionType'];
};

/**
 * A non-destructive override for one reusable Blueprint component. Text and
 * layout changes stay local; changing a visual prompt or source assets is
 * reported by the variant planner so only the affected shots need new media.
 */
export type CloneBlueprintVariantOverride = {
  componentId?: string;
  shotIndexes?: number[];
  assetIds?: string[];
  text?: string;
  graphicsText?: string;
  visual?: string;
  line?: string;
  prompt?: string;
  layout?: CanvasVideoEditorLayout;
  motionPath?: CanvasVideoEditorMotionPath;
  graphicsStyle?: string;
  preserveReferenceFrame?: boolean;
  /** Explicitly allow a caption/card overlay while the reference video remains intact. */
  allowReferenceOverlays?: boolean;
  regenerate?: boolean;
};

/** A named, reusable local variant of one reference-derived Blueprint. */
export type CloneBlueprintVariantSpec = {
  id: string;
  name: string;
  description?: string;
  overrides: CloneBlueprintVariantOverride[];
  finalVideoUrl?: string;
  finalVideoMime?: string;
  renderedAt?: string;
};

/** The deterministic result of expanding a Blueprint variant. */
export type CloneBlueprintVariantPlan = {
  id: string;
  name: string;
  description?: string;
  shots: CloneShot[];
  timeline: CloneTimeline;
  generationShotIndexes: number[];
  voiceShotIndexes: number[];
  reusedShotIndexes: number[];
};

/** 成片时间轴：直接落进画布的视频编辑节点。 */
export type CloneTimelineTrackKind = 'video' | 'reference-audio' | 'voice' | 'caption' | 'graphics' | 'broll' | 'effect';

export type CloneTimelineTrackClip = {
  id: string;
  eventId?: string;
  anchorText?: string;
  anchorStartWord?: number;
  anchorEndWord?: number;
  componentId?: string;
  role?: CloneShotReferenceRole;
  shotIndex: number;
  start: number;
  duration: number;
  source?: 'reference-video' | 'generated-media';
  mediaKind?: 'image' | 'video' | 'audio';
  url?: string;
  sourceOffset?: number;
  text?: string;
  /** Word-level timing relative to this semantic clip's start. */
  words?: CanvasVideoEditorWord[];
  /** Local effect cue for the editable effect track. */
  effect?: string;
  graphicsStyle?: string;
  position?: string;
  textBox?: { x: number; y: number; width: number; height: number };
  x?: number;
  y?: number;
  transitionIn?: CanvasVideoEditorClip['transitionIn'];
  transitionDuration?: number;
  transitionDirection?: CanvasVideoEditorClip['transitionDirection'];
  motionPath?: CanvasVideoEditorMotionPath;
  layout?: CanvasVideoEditorLayout;
  volume?: number;
  playbackRate?: CanvasVideoEditorClip['playbackRate'];
  fit?: CanvasVideoEditorClip['fit'];
  enabled?: boolean;
};

/**
 * Persisted semantic tracks behind the flattened canvas clips.  The canvas
 * still receives one final MP4, while this plan keeps the source relationship
 * available for re-editing and deterministic re-assembly.
 */
export type CloneTimelineTrack = {
  id: string;
  kind: CloneTimelineTrackKind;
  label: string;
  clips: CloneTimelineTrackClip[];
};

export type CloneTimeline = {
  duration: number;
  fps: number;
  aspect: string;
  clips: CanvasVideoEditorClip[];
  /** Latest editor-authored timeline sent back for deterministic server re-assembly. */
  editorState?: CanvasVideoEditorState;
  /** Optional for jobs created before semantic tracks were persisted. */
  tracks?: CloneTimelineTrack[];
  /** Reusable component templates referenced by flattened editor clips. */
  components?: CloneBlueprintComponent[];
  /** 服务端完成多轨合成后的单个最终视频地址。镜头 clips 只是可编辑内部计划。 */
  finalVideoUrl?: string;
  finalVideoMime?: string;
  /** Canvas clone projects duck A2 reference ambience under A1 voice. */
  referenceAudioDucking?: boolean;
};

export type CloneJob = {
  id: string;
  createdAt: string;
  updatedAt: string;
  idempotencyKey?: string;
  stage: CloneStage;
  /** 0..1，用于按钮上的进度条。 */
  progress: number;
  message: string;
  reference: CloneReference;
  assets: CloneAsset[];
  planConfirmed?: boolean;
  /** One-click mode confirms the generated plan on the server. */
  autoConfirmPlan?: boolean;
  referenceAnalysis?: CloneReferenceAnalysis;
  blueprint?: CloneBlueprint;
  options: CloneOptions;
  capabilities: CloneCapabilities;
  warnings: string[];
  models: CloneModels;
  modelIds?: CloneModelIds;
  shots: CloneShot[];
  timeline: CloneTimeline;
  error?: string;
  cancelRequested?: boolean;
  finishedAt?: string;
  /** 成片已经放进画布的时间：重开弹窗时不再拿旧成片问一遍，避免重复落节点。 */
  appliedAt?: string;
};

export type { CanvasVideoEditorClip, CanvasVideoEditorState };
