import { generationLogComposerDraft } from '../generation-log-presentation';
import { IMAGE_RATIOS, type ImageCreationSettings } from '../creation/settings';
import type { GenerationLog } from '../generation-log';
import type { CanvasReuseDraft } from './reuse';
import type { CanvasAudioDraft, CanvasAudioGenerationMeta } from './types';
import { createMedia } from './model';

export function canvasImageGenerationRecoveryDraft(
  log: GenerationLog,
  defaults: ImageCreationSettings,
) {
  const source = generationLogComposerDraft(log);
  if (!source) return null;

  const references: CanvasReuseDraft['references'] = [];
  let unavailableReferenceCount = 0;
  for (const [index, reference] of source.references.entries()) {
    const url = String(reference.url || '').trim();
    const text = String(reference.text || '');
    if (reference.kind === 'text' ? !text.trim() : !url) {
      unavailableReferenceCount += 1;
      continue;
    }
    references.push({
      id: reference.id || `task-reference-${index + 1}`,
      kind: reference.kind || 'image',
      name: reference.name,
      origin: 'upload',
      ...(url ? { url } : {}),
      ...(text ? { text } : {}),
      ...(reference.mimeType ? { mimeType: reference.mimeType } : {}),
    });
  }

  const loggedResolution = `${log.resolution || ''} ${log.outputSize || ''}`
    .match(/(?:^|\b)(1K|2K|3K|4K)(?:\b|$)/i)?.[1]?.toUpperCase();
  const resolution = loggedResolution && ['1K', '2K', '3K', '4K'].includes(loggedResolution)
    ? loggedResolution as ImageCreationSettings['resolution']
    : defaults.resolution;

  return {
    draft: {
      kind: 'image',
      prompt: source.prompt,
      params: {
        ...defaults,
        model: source.modelId || defaults.model,
        aspect: source.aspectRatio && IMAGE_RATIOS.includes(source.aspectRatio as (typeof IMAGE_RATIOS)[number])
          ? source.aspectRatio
          : defaults.aspect,
        resolution,
        count: source.count,
        mask: undefined,
      },
      references,
      operation: 'generate',
      dirty: true,
    } satisfies CanvasReuseDraft,
    unavailableReferenceCount,
  };
}

export function canRestoreCanvasTaskContext(log: Pick<GenerationLog, 'status' | 'mode' | 'mediaKind' | 'errorCode'>) {
  const kind = log.mediaKind || (log.mode === 'video' ? 'video' : log.mode === 'audio' ? 'audio' : log.mode === 'llm' ? 'llm' : 'image');
  return log.status === 'error'
    && log.errorCode !== 'provider_result_unconfirmed'
    && (kind === 'image' || kind === 'video' || kind === 'audio');
}

export function canPreserveCanvasAudioDraft(log: Pick<GenerationLog, 'mode' | 'mediaKind' | 'errorCode'>) {
  const kind = log.mediaKind || (log.mode === 'audio' ? 'audio' : undefined);
  return kind === 'audio' && log.errorCode === 'provider_result_unconfirmed';
}

export function canvasAudioGenerationRecoveryDraft(
  log: Pick<GenerationLog, 'prompt' | 'createdAt' | 'requestedModelId' | 'voice'>,
  currentDraft?: CanvasAudioDraft,
  lastGeneration?: CanvasAudioGenerationMeta,
  now = Date.now(),
): CanvasAudioDraft {
  const logTime = Date.parse(log.createdAt);
  if (currentDraft?.updatedAt && Number.isFinite(logTime) && currentDraft.updatedAt > logTime) {
    return currentDraft;
  }

  return {
    text: log.prompt,
    ...(log.voice || lastGeneration?.voice ? { voice: log.voice || lastGeneration?.voice } : {}),
    modelId: log.requestedModelId
      || lastGeneration?.requestedModelId
      || lastGeneration?.modelId
      || 'auto',
    updatedAt: now,
  };
}

export function createCanvasAudioRecoveryDraftNode(
  log: Pick<GenerationLog, 'id' | 'taskId' | 'prompt' | 'createdAt' | 'requestedModelId' | 'voice'>,
  position: { x: number; y: number },
  now = Date.now(),
) {
  return createMedia('audio', '', '恢复的配音草稿', position, {
    role: '待编辑',
    status: 'draft',
    statusLabel: '配音文本已恢复',
    recoveryTaskId: String(log.taskId || log.id || '').trim() || undefined,
    referenceOrder: [],
    speechDraft: canvasAudioGenerationRecoveryDraft(log, undefined, undefined, now),
  });
}

export function restorableCanvasTaskLogs<T extends Pick<GenerationLog, 'status' | 'mode' | 'mediaKind' | 'errorCode'>>(
  logs: readonly T[],
): T[] {
  return logs.filter(canRestoreCanvasTaskContext);
}
