import type { CreativeReviewEvidence, CreativeReviewMediaKind } from './creative-review';

export type CreativeVisualReviewFrame = {
  dataUrl: string;
  location: string;
};

export type CreativeVisualReviewer = (input: {
  mediaKind: CreativeReviewMediaKind;
  brief: string;
  generationPrompt?: string;
  frames: readonly CreativeVisualReviewFrame[];
  signal?: AbortSignal;
}) => Promise<CreativeReviewEvidence>;
