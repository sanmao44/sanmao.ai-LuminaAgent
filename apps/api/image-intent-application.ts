import type { ImageRequestMode, ImageRequestOperation } from '@/packages/contracts/creative';

const IMAGE_INTENT_CLASSIFICATION_TIMEOUT_MS = 8000;

export type CanvasImageIntentClassification = {
  operation?: Extract<ImageRequestOperation, 'edit' | 'reference-generate'>;
  confidence?: 'high' | 'low';
  modelId?: string;
};

export type CanvasImageIntentResolution = {
  operation: ImageRequestOperation;
  classifierStatus?: 'used' | 'fallback' | 'unavailable';
  classifierModelId?: string;
  classifierMs?: number;
};

export type CanvasImageIntentJudge = (
  input: { prompt: string; imageReferenceCount: number },
  signal: AbortSignal,
) => Promise<CanvasImageIntentClassification | null>;

export async function resolveCanvasImageIntent(input: {
  requestedMode: ImageRequestMode;
  isCanvasRequest: boolean;
  prompt: string;
  imageReferenceCount: number;
  hasMask: boolean;
  signal?: AbortSignal;
}, judge?: CanvasImageIntentJudge): Promise<CanvasImageIntentResolution> {
  if (input.requestedMode !== 'auto') return { operation: input.requestedMode };
  if (input.hasMask) return { operation: 'edit' };
  if (!input.imageReferenceCount) return { operation: 'generate' };
  if (!input.isCanvasRequest || !judge) {
    return { operation: 'reference-generate', classifierStatus: 'unavailable' };
  }

  const startedAt = Date.now();
  const deadline = AbortSignal.timeout(IMAGE_INTENT_CLASSIFICATION_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
  try {
    const classification = await judge({
      prompt: input.prompt.slice(0, 12_000),
      imageReferenceCount: input.imageReferenceCount,
    }, signal);
    if (input.signal?.aborted) throw input.signal.reason || new Error('GENERATION_CANCELLED');
    if (signal.aborted || !classification) {
      return {
        operation: 'reference-generate',
        classifierStatus: classification ? 'fallback' : 'unavailable',
        ...(classification?.modelId ? { classifierModelId: classification.modelId } : {}),
        classifierMs: Date.now() - startedAt,
      };
    }
    if (classification.confidence === 'high' && classification.operation) {
      return {
        operation: classification.operation,
        classifierStatus: 'used',
        ...(classification.modelId ? { classifierModelId: classification.modelId } : {}),
        classifierMs: Date.now() - startedAt,
      };
    }
    return {
      operation: 'reference-generate',
      classifierStatus: 'fallback',
      ...(classification.modelId ? { classifierModelId: classification.modelId } : {}),
      classifierMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason || error;
    return {
      operation: 'reference-generate',
      classifierStatus: 'fallback',
      classifierMs: Date.now() - startedAt,
    };
  }
}
