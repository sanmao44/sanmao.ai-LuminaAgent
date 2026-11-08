import type { CanvasGenerationLogKind } from './activity-log';

export type CanvasTaskPrimaryAction = 'check' | 'preserve-audio' | 'restore' | 'retry' | 'continue' | 'open' | 'focus';

/** Select one useful task-card action while leaving other actions available on demand. */
export function deriveCanvasTaskPrimaryAction(input: {
  kind: CanvasGenerationLogKind;
  needsRecordCheck: boolean;
  canPreserveAudio: boolean;
  canRestoreTaskContext: boolean;
  canRetryTask: boolean;
  canContinueTask: boolean;
  hasMediaResult: boolean;
}): CanvasTaskPrimaryAction | null {
  if (input.needsRecordCheck) return 'check';
  if (input.canPreserveAudio) return 'preserve-audio';
  if (input.kind === 'video' && input.canRetryTask) return 'retry';
  if (input.canRestoreTaskContext) return 'restore';
  if (input.canRetryTask) return 'retry';
  if (input.canContinueTask) return 'continue';
  if (input.kind === 'llm') return null;
  return input.hasMediaResult ? 'open' : 'focus';
}
