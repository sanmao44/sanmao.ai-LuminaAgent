import type { RuntimeProvider } from '@/lib/providers';

type ProviderFailureKind = 'http' | 'transport' | 'timeout';

export type AgentModelHealthRecord = {
  modelId: string;
  providerId: string;
  modelName: string;
  providerName: string;
  consecutiveFailures: number;
  lastFailureAt?: string;
  lastSuccessAt?: string;
  lastLatencyMs?: number;
  circuitOpenUntil?: string;
  state: 'healthy' | 'degraded' | 'cooldown';
};

type RuntimeModel = {
  model: { id: string; displayName: string };
  provider: RuntimeProvider & { id: string; name: string };
};

type MutableHealth = {
  modelName: string;
  providerName: string;
  consecutiveFailures: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  lastLatencyMs?: number;
  circuitOpenUntil?: number;
};

const health = new Map<string, MutableHealth>();
const MAX_RECORDS = 256;

function keyFor(runtime: RuntimeModel) {
  return `${runtime.provider.id}\u0000${runtime.model.id}`;
}

function isAbortError(error: unknown) {
  const value = error as { name?: string; message?: string } | null;
  return value?.name === 'AbortError' || /AGENT_CANCELLED|请求已取消|请求已停止/i.test(String(value?.message || ''));
}

function failureKind(error: unknown) {
  const value = error as { providerFailureKind?: ProviderFailureKind; providerStatus?: number; status?: number } | null;
  return {
    kind: value?.providerFailureKind,
    status: Number(value?.providerStatus || value?.status || 0),
  };
}

function cooldownFor(failures: number, error: unknown) {
  const { kind, status } = failureKind(error);
  if (status === 401 || status === 403) return 15 * 60_000;
  if (status === 404 || status === 422) return 5 * 60_000;
  if (kind === 'timeout' || kind === 'transport') return Math.min(5 * 60_000, 45_000 * 2 ** Math.max(0, failures - 1));
  return Math.min(3 * 60_000, 30_000 * 2 ** Math.max(0, failures - 1));
}

function trimRecords() {
  if (health.size <= MAX_RECORDS) return;
  const oldest = [...health.entries()]
    .sort((left, right) => (left[1].lastFailureAt || left[1].lastSuccessAt || 0) - (right[1].lastFailureAt || right[1].lastSuccessAt || 0))
    .slice(0, health.size - MAX_RECORDS);
  for (const [key] of oldest) health.delete(key);
}

export function isAgentModelCircuitOpen(runtime: RuntimeModel, now = Date.now()) {
  return Boolean(health.get(keyFor(runtime))?.circuitOpenUntil && (health.get(keyFor(runtime))?.circuitOpenUntil || 0) > now);
}

export function orderAgentModelCandidates<T extends RuntimeModel>(candidates: readonly T[], now = Date.now()) {
  return [...candidates].sort((left, right) => {
    const leftHealth = health.get(keyFor(left));
    const rightHealth = health.get(keyFor(right));
    const leftOpen = Number(isAgentModelCircuitOpen(left, now));
    const rightOpen = Number(isAgentModelCircuitOpen(right, now));
    if (leftOpen !== rightOpen) return leftOpen - rightOpen;
    const leftFailures = leftHealth?.consecutiveFailures || 0;
    const rightFailures = rightHealth?.consecutiveFailures || 0;
    if (leftFailures !== rightFailures) return leftFailures - rightFailures;
    return 0;
  });
}

export function noteAgentModelSuccess(runtime: RuntimeModel, latencyMs: number) {
  const current = health.get(keyFor(runtime)) || { modelName: runtime.model.displayName, providerName: runtime.provider.name, consecutiveFailures: 0 };
  current.modelName = runtime.model.displayName;
  current.providerName = runtime.provider.name;
  current.consecutiveFailures = 0;
  current.lastSuccessAt = Date.now();
  current.lastLatencyMs = Math.max(0, Math.round(latencyMs));
  delete current.circuitOpenUntil;
  health.set(keyFor(runtime), current);
  trimRecords();
}

export function noteAgentModelFailure(runtime: RuntimeModel, error: unknown, latencyMs: number) {
  if (isAbortError(error)) return;
  const current = health.get(keyFor(runtime)) || { modelName: runtime.model.displayName, providerName: runtime.provider.name, consecutiveFailures: 0 };
  current.modelName = runtime.model.displayName;
  current.providerName = runtime.provider.name;
  current.consecutiveFailures += 1;
  current.lastFailureAt = Date.now();
  current.lastLatencyMs = Math.max(0, Math.round(latencyMs));
  current.circuitOpenUntil = Date.now() + cooldownFor(current.consecutiveFailures, error);
  health.set(keyFor(runtime), current);
  trimRecords();
}

export function getAgentModelHealthSnapshot(): AgentModelHealthRecord[] {
  const now = Date.now();
  return [...health.entries()].map(([key, value]) => {
    const [providerId, modelId] = key.split('\u0000');
    const open = Boolean(value.circuitOpenUntil && value.circuitOpenUntil > now);
    return {
      modelId,
      providerId,
      modelName: value.modelName,
      providerName: value.providerName,
      consecutiveFailures: value.consecutiveFailures,
      ...(value.lastFailureAt ? { lastFailureAt: new Date(value.lastFailureAt).toISOString() } : {}),
      ...(value.lastSuccessAt ? { lastSuccessAt: new Date(value.lastSuccessAt).toISOString() } : {}),
      ...(value.lastLatencyMs !== undefined ? { lastLatencyMs: value.lastLatencyMs } : {}),
      ...(open && value.circuitOpenUntil ? { circuitOpenUntil: new Date(value.circuitOpenUntil).toISOString() } : {}),
      state: open ? 'cooldown' : value.consecutiveFailures ? 'degraded' : 'healthy',
    };
  });
}

export function resetAgentModelHealth() {
  health.clear();
}
