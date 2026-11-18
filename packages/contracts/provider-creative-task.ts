export const PROVIDER_CREATIVE_TASK_PROTOCOLS = ['cangyuan-creative-v1'] as const;

export type ProviderCreativeTaskProtocol = typeof PROVIDER_CREATIVE_TASK_PROTOCOLS[number];

export function isProviderCreativeTaskProtocol(value: unknown): value is ProviderCreativeTaskProtocol {
  return PROVIDER_CREATIVE_TASK_PROTOCOLS.includes(value as ProviderCreativeTaskProtocol);
}
