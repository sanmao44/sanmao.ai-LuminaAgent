import type { ModelCapability, ModelKind } from './types';

/**
 * Resolve a model's primary category without overwriting a user's choice.
 *
 * The registry may report capabilities that overlap (for example, a model can
 * expose both chat and image endpoints). Once a category has been selected in
 * the model library, that explicit value must remain authoritative. Inference
 * is only used for newly discovered/unclassified models.
 */
export function resolveModelKind(
  selectedKind: ModelKind,
  inferredKind: ModelKind,
  capabilities: ModelCapability[],
): ModelKind {
  if (selectedKind !== 'unknown') return selectedKind;
  if (capabilities.some((capability) => capability.startsWith('video-'))) return 'video';
  if (inferredKind !== 'unknown') return inferredKind;
  if (capabilities.includes('generate') || capabilities.includes('upscale')) return 'image';
  if (capabilities.includes('chat')) return 'chat';
  return 'unknown';
}
