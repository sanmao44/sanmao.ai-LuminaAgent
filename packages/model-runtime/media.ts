import { invokeModelCandidates } from './invocation';

type ProviderFailure = {
  providerFailureKind?: string;
  providerStatus?: number;
  status?: number;
  message?: string;
};

/**
 * A media model may be replaced only when the provider explicitly rejects the
 * selected model or capability. Transport failures and ambiguous server
 * errors must remain visible to the caller instead of silently switching
 * providers.
 */
export function isSafeMediaModelFallbackError(error: unknown): boolean {
  const failure = error as ProviderFailure | null;
  const status = Number(failure?.providerStatus || failure?.status);
  const message = String(failure?.message || '').toLowerCase();
  const explicitCompatibility = /unsupported\s+(?:model|image|edit|generation)|(?:model|image|edit|generation)\s+(?:not found|does not exist|is not supported|unsupported)|unknown model|model .*not supported|configured account|does not support (?:this )?(?:model|image|image generation|image editing)|不支持(?:此模型|该模型|这个模型|图片生成|图片修改)|未找到模型|模型不存在|模型不支持|账号未配置(?:该模型)?/.test(message);
  return failure?.providerFailureKind === 'http'
    && [400, 404, 415, 422].includes(status)
    && explicitCompatibility;
}

/**
 * Capability-specific provider fallback. Candidate loading and retry policy
 * live in model-runtime so API routes and tool execution share one boundary.
 */
export function invokeMediaModelCandidates<T extends { model: { id: string } }, R>(
  initial: T,
  loadFallbacks: () => Promise<readonly T[]>,
  operation: (runtime: T) => Promise<R>,
): Promise<R> {
  return invokeModelCandidates(initial, loadFallbacks, operation, isSafeMediaModelFallbackError);
}
