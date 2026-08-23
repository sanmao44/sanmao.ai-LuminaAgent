import type { ModelCapability, ModelKind } from './types';

export type ModelKindSignals = {
  rawId?: string;
  displayName?: string;
  capabilities?: ModelCapability[];
};

/**
 * Infer the primary model category from provider metadata and common model
 * family names. This is deliberately conservative: embeddings, speech and
 * other models without a recognizable generation/chat signal stay unknown.
 */
export function inferModelKind({ rawId = '', displayName = '', capabilities = [] }: ModelKindSignals): ModelKind {
  const text = `${rawId} ${displayName}`.toLowerCase();
  if (capabilities.some((capability) => capability.startsWith('video-')) || /\b(?:video|sora|veo|seedance|kling|hailuo|runway)\b|text[-_ ]?to[-_ ]?video|image[-_ ]?to[-_ ]?video/.test(text)) return 'video';
  if (capabilities.includes('generate') || capabilities.includes('upscale') || /image|imagen|flux|sdxl|stable[-_ ]?diffusion|dall[-_ ]?e|ideogram|recraft|seedream|nano[-_ ]?banana|pixart|kolors|midjourney|upscal|super[-_ ]?resolution|real[-_ ]?esrgan|swinir/.test(text)) return 'image';
  const chatFamily = /(?:gpt|codex|gemini|claude|deepseek|qwen|llama|mistral|glm|kimi|command[-_ ]?r|o[134](?:[-_.]|$)|sonar|perplexity|intern|step[-_.]?\d|(?:hiy|hy)\d*|hunyuan|chatglm|yi|baichuan|minimax|longcat|ernie|doubao|phi|gemma|nemotron|jamba|cohere|aya|llava|pixtral|granite|smollm|falcon|wizardlm)/.test(text);
  const chatRole = /\b(?:instruct|instruction|chat|thinking|reasoning|coder|assistant)\b/.test(text);
  if (capabilities.includes('chat') || chatFamily || chatRole) return 'chat';
  return 'unknown';
}

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
