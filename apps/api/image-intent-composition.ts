import { canvasImageIntentCompletion } from '@/lib/providers';
import { getRuntimeIntentClassifierModel } from '@/lib/store';
import { resolveCanvasImageIntent, type CanvasImageIntentClassification } from './image-intent-application';

export async function resolveCanvasImageRequestIntent(input: {
  requestedMode: 'auto';
  isCanvasRequest: boolean;
  prompt: string;
  imageReferenceCount: number;
  hasMask: boolean;
  signal?: AbortSignal;
}) {
  return resolveCanvasImageIntent(input, async (request, signal) => {
    const runtime = await getRuntimeIntentClassifierModel();
    if (!runtime) return null;
    const decision = await canvasImageIntentCompletion(
      runtime.provider,
      runtime.model.rawId,
      request,
      signal,
    );
    return {
      operation: decision.operation,
      confidence: decision.confidence,
      modelId: runtime.model.id,
    } satisfies CanvasImageIntentClassification;
  });
}
