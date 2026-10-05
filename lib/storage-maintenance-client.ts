type StorageMaintenanceResponse = {
  usage?: unknown;
  snapshots?: unknown[];
  [key: string]: unknown;
};

async function readJson(response: Response, fallback: string): Promise<StorageMaintenanceResponse> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : fallback);
  return data as StorageMaintenanceResponse;
}

export async function loadStorageMaintenance(): Promise<{ usage?: unknown; snapshots: unknown[] }> {
  const [usageResponse, snapshotResponse] = await Promise.all([
    fetch('/api/storage/usage', { cache: 'no-store' }),
    fetch('/api/storage/snapshots', { cache: 'no-store' }),
  ]);
  const usageData = await usageResponse.json().catch(() => ({}));
  const snapshotData = await snapshotResponse.json().catch(() => ({}));
  return {
    usage: usageResponse.ok ? usageData.usage : undefined,
    snapshots: snapshotResponse.ok && Array.isArray(snapshotData.snapshots) ? snapshotData.snapshots : [],
  };
}

export async function createManualStorageSnapshot(): Promise<StorageMaintenanceResponse> {
  const response = await fetch('/api/storage/snapshots', { method: 'POST' });
  return readJson(response, '\u521b\u5efa\u5feb\u7167\u5931\u8d25');
}

export async function restoreLocalStorageSnapshot(name: string): Promise<StorageMaintenanceResponse> {
  const response = await fetch('/api/storage/snapshots', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return readJson(response, '\u6062\u590d\u5feb\u7167\u5931\u8d25');
}