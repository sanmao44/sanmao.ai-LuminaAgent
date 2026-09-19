/**
 * 「一键克隆出片」的数据结构（一期窄管线）。
 *
 * 一期边界：不贴脸、不换脸、不做数字人；参考视频只用来拆解结构与节奏，
 * 画面全部用平台已有的生图 / 图生视频重新生成；声音用用户已配的 TTS，
 * 没有可用 TTS 时自动降级为「无声成片 + 字幕」。
 */
import type { CanvasVideoEditorClip, CanvasVideoEditorState } from '../canvas/types';

export type CloneStage =
  | 'queued'
  | 'analyzing'
  | 'scripting'
  | 'voicing'
  | 'imaging'
  | 'rendering'
  | 'assembling'
  | 'done'
  | 'failed'
  | 'cancelled';

export type CloneShotStatus = 'pending' | 'voicing' | 'imaging' | 'rendering' | 'done' | 'failed';

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
  status: CloneShotStatus;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  /** 这一句配音的实际时长（秒）；没有 TTS 时为空，改用字数估算。 */
  audioSeconds?: number;
  error?: string;
};

export type CloneOptions = {
  brief: string;
  maxShots: number;
  maxSeconds: number;
  aspect: '9:16' | '16:9' | '1:1';
  voice: string;
};

export type CloneCapabilities = {
  vision: boolean;
  speech: boolean;
  image: boolean;
  video: boolean;
};

export type CloneReference = {
  nodeId?: string;
  name: string;
  url: string;
  seconds: number;
};

export type CloneModels = {
  chat: string;
  image?: string;
  video?: string;
  speech?: string;
};

/** 高级设置里显式选择的模型 id：为「自动」的轨道不写，执行时按 id 精确取模型。 */
export type CloneModelIds = Partial<CloneModels>;

/** 成片时间轴：直接落进画布的视频编辑节点。 */
export type CloneTimeline = {
  duration: number;
  fps: number;
  aspect: string;
  clips: CanvasVideoEditorClip[];
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
};

export type { CanvasVideoEditorClip, CanvasVideoEditorState };
