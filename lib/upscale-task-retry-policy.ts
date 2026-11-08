export type UpscaleRetryDisposition = 'explicit_rejection' | 'blocked' | 'unknown';

export const UPSCALE_BATCH_RETRYABLE_ERROR_CODES = [
  'INVALID_CREDENTIAL',
  'SIGNATURE_INVALID',
  'NOT_PURCHASED',
  'PERMISSION_DENIED',
  'INSUFFICIENT_BALANCE',
  'IMAGE_TOO_LARGE',
  'INVALID_IMAGE',
] as const;

const retryableErrorCodes = new Set<string>(UPSCALE_BATCH_RETRYABLE_ERROR_CODES);

export function isExplicitUpscaleRejection(errorCode?: string) {
  return Boolean(errorCode && retryableErrorCodes.has(errorCode));
}

export function canBatchRetryUpscaleTask(task: {
  status: string;
  retryDisposition?: UpscaleRetryDisposition;
  errorCode?: string;
  providerTaskId?: string;
  localImageUrl?: string;
  remoteImageUrl?: string;
}) {
  return task.status === 'failed'
    && task.retryDisposition === 'explicit_rejection'
    && isExplicitUpscaleRejection(task.errorCode)
    && !task.providerTaskId
    && !task.localImageUrl
    && !task.remoteImageUrl;
}
