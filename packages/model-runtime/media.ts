import { invokeModelCandidates } from './invocation';
import { MEDIA_MODEL_INPUT_NOT_SUBMITTED, type ModelProviderFailure } from '../contracts/model';

type ProviderFailure = ModelProviderFailure;

/** Transport failures and possibly accepted tasks must not trigger a second
 * paid generation request. Definitive provider rejections and terminal task
 * failures can safely move to another configured model.
 */
export function isSafeMediaModelFallbackError(error: unknown): boolean {
  const failure = error as (ProviderFailure & {
    providerPossiblyAccepted?: boolean;
    providerAcceptedTask?: boolean;
    providerTaskTerminalFailure?: boolean;
    mediaModelNoOutput?: boolean;
  }) | null;
  if (failure?.providerPossiblyAccepted || failure?.providerAcceptedTask) return false;
  if (failure?.providerTaskTerminalFailure || failure?.mediaModelNoOutput) return true;
  const status = Number(failure?.providerStatus || failure?.status);
  return failure?.providerFailureKind === 'http'
    && [400, 401, 403, 404, 413, 415, 422, 429].includes(status);
}

export function isSafeMediaInputFallbackError(error: unknown): boolean {
  const failure = error as ProviderFailure | null;
  return failure?.providerFailureKind === 'input'
    && failure.providerFailureCode === MEDIA_MODEL_INPUT_NOT_SUBMITTED
    && failure.providerResponse === false;
}

/**
 * Capability-specific provider fallback. Candidate loading and retry policy
 * live in model-runtime so API routes and tool execution share one boundary.
 */
export function invokeMediaModelCandidates<T extends { model: { id: string } }, R>(
  initial: T,
  loadFallbacks: () => Promise<readonly T[]>,
  operation: (runtime: T) => Promise<R>,
  options: { allowFallbackBeforeProviderSubmission?: boolean } = {},
): Promise<R> {
  return invokeModelCandidates(initial, loadFallbacks, operation, (error) =>
    isSafeMediaModelFallbackError(error)
    || (options.allowFallbackBeforeProviderSubmission === true && isSafeMediaInputFallbackError(error)));
}
