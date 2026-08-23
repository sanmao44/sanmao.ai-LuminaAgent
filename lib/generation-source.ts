export type GenerationSource = 'workspace' | 'agent' | 'canvas';

export function normalizeGenerationSource(value: unknown, fallback: GenerationSource): GenerationSource {
  return value === 'canvas' || value === 'agent' || value === 'workspace' ? value : fallback;
}
