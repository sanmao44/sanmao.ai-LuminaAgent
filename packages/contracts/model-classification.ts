/**
 * Stable classification vocabulary shared by model discovery and model-library
 * presentation. Provider adapters may map their own labels to this contract,
 * but they must not expose provider SDK types here.
 */

export type AudioModelPurpose =
  | 'speech'
  | 'transcription'
  | 'music'
  | 'sound-effect'
  | 'conversation'
  | 'unknown';

export type ModelClassificationSource =
  | 'official'
  | 'provider-metadata'
  | 'adapter'
  | 'heuristic'
  | 'local-ai-suggested'
  | 'manual';

export type ModelClassificationConfidence = 'high' | 'medium' | 'low';

export type ModelClassificationEvidence = {
  kind: 'official' | 'metadata' | 'endpoint' | 'model-id' | 'ai' | 'manual';
  value: string;
};

export type AudioModelClassification = {
  purposes: readonly AudioModelPurpose[];
  source: ModelClassificationSource;
  confidence: ModelClassificationConfidence;
  evidence: readonly ModelClassificationEvidence[];
  /** Local AI suggestions remain reviewable until a user accepts them. */
  requiresReview: boolean;
};

export type AudioModelClassificationSuggestion = {
  purposes: readonly Exclude<AudioModelPurpose, 'unknown'>[];
  confidence: Extract<ModelClassificationConfidence, 'medium' | 'low'>;
  reason?: string;
};
