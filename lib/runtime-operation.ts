import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dataDir = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data');
const requestDir = path.join(dataDir, 'runtime-requests');
const drainPath = path.join(dataDir, 'runtime-draining.json');
const operationLockPath = path.join(dataDir, 'update-staging', 'update.lock');
const coordinationLockPath = path.join(dataDir, 'runtime-coordination.lock');
const MARKER_STALE_MS = 10 * 60 * 1000;
const COORDINATION_LOCK_TIMEOUT_MS = 30_000;
const runtimeInstanceId = process.env.SANMAO_RUNTIME_INSTANCE_ID || randomUUID();
if (!process.env.SANMAO_RUNTIME_INSTANCE_ID) process.env.SANMAO_RUNTIME_INSTANCE_ID = runtimeInstanceId;

export class RuntimeDrainingError extends Error {
  constructor() {
    super('SANMAO.AI 正在准备重启，请稍候再试。');
    this.name = 'RuntimeDrainingError';
  }
}

type RuntimeRequestRecord = {
  id: string;
  instanceId?: string;
  pid: number;
  kind: string;
  startedAt: string;
  lastSeenAt: string;
};

type RuntimeDrainMarker = {
  operationId: string;
  instanceId?: string;
  pid: number;
  startedAt: string;
};

export type RuntimeOperationLock = {
  kind: 'restart' | 'update';
  operationId: string;
  token: string;
  instanceId?: string;
  pid: number;
  startedAt: string;
  jobId?: string;
};

export type RuntimeDrainStatus = {
  draining: boolean;
  activeRequests: number;
  requestIds: string[];
};

function requestPath(id: string) {
  return path.join(requestDir, `${id}.json`);
}

async function isProcessAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readDrainMarker() {
  try {
    const marker = JSON.parse(await readFile(drainPath, 'utf8')) as Partial<RuntimeDrainMarker>;
    if (!marker.operationId || !Number.isInteger(Number(marker.pid)) || !marker.startedAt) return null;
    return marker as RuntimeDrainMarker;
  } catch {
    return null;
  }
}

async function drainMarkerExists() {
  return Boolean(await stat(drainPath).catch(() => null));
}

async function cleanupStaleDrainMarker() {
  if (!(await drainMarkerExists())) return;
  const marker = await readDrainMarker();
  let startedAt = marker ? Date.parse(marker.startedAt) : NaN;
  if (!Number.isFinite(startedAt)) {
    startedAt = (await stat(drainPath).catch(() => null))?.mtimeMs || NaN;
  }
  const pid = marker ? Number(marker.pid) : 0;
  const reusedCurrentPid = marker?.pid === process.pid && Boolean(marker.instanceId) && marker.instanceId !== runtimeInstanceId;
  if (reusedCurrentPid || (Number.isFinite(startedAt) && Date.now() - startedAt > MARKER_STALE_MS && !await isProcessAlive(pid))) {
    await rm(drainPath, { force: true }).catch(() => undefined);
  }
}

async function cleanupStaleRequests() {
  const entries = await readdir(requestDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map(async (entry) => {
    const file = path.join(requestDir, entry.name);
    try {
      const record = JSON.parse(await readFile(file, 'utf8')) as Partial<RuntimeRequestRecord>;
      const alive = await isProcessAlive(Number(record.pid));
      const lastSeenAt = Date.parse(String(record.lastSeenAt || record.startedAt || ''));
      const reusedCurrentPid = Number(record.pid) === process.pid && Boolean(record.instanceId) && record.instanceId !== runtimeInstanceId;
      // A live process may legitimately own a request for more than two hours
      // (video/image providers can be slow). Never discard a live request just
      // because it is old; only dead or malformed records are stale.
      if (!alive || reusedCurrentPid || !Number.isFinite(lastSeenAt)) await rm(file, { force: true });
    } catch {
      await rm(file, { force: true }).catch(() => undefined);
    }
  }));
}

async function readOperationLock() {
  try {
    return JSON.parse(await readFile(operationLockPath, 'utf8')) as Partial<RuntimeOperationLock>;
  } catch {
    return null;
  }
}

async function cleanupStaleOperationLock() {
  const lock = await readOperationLock();
  const file = await stat(operationLockPath).catch(() => null);
  if (!lock && !file) return false;
  const startedAt = lock ? Date.parse(String(lock.startedAt || '')) : NaN;
  const age = Number.isFinite(startedAt) ? Date.now() - startedAt : file ? Date.now() - file.mtimeMs : 0;
  const reusedCurrentPid = Number(lock?.pid) === process.pid && Boolean(lock?.instanceId) && lock?.instanceId !== runtimeInstanceId;
  if (!reusedCurrentPid && (age <= MARKER_STALE_MS || await isProcessAlive(Number(lock?.pid)))) return false;
  await rm(operationLockPath, { force: true }).catch(() => undefined);
  return true;
}

type RuntimeCoordinationLock = { token: string; pid: number; startedAt: string };

async function readCoordinationLock() {
  try {
    return JSON.parse(await readFile(coordinationLockPath, 'utf8')) as Partial<RuntimeCoordinationLock>;
  } catch {
    return null;
  }
}

async function cleanupStaleCoordinationLock() {
  const lock = await readCoordinationLock();
  const file = await stat(coordinationLockPath).catch(() => null);
  if (!lock && !file) return false;
  const startedAt = lock ? Date.parse(String(lock.startedAt || '')) : NaN;
  const age = Number.isFinite(startedAt) ? Date.now() - startedAt : file ? Date.now() - file.mtimeMs : 0;
  if (age <= COORDINATION_LOCK_TIMEOUT_MS || await isProcessAlive(Number(lock?.pid))) return false;
  await rm(coordinationLockPath, { force: true }).catch(() => undefined);
  return true;
}

async function withRuntimeCoordination<T>(operation: () => Promise<T>) {
  await mkdir(dataDir, { recursive: true });
  const deadline = Date.now() + COORDINATION_LOCK_TIMEOUT_MS;
  const token = randomUUID();
  while (true) {
    try {
      const handle = await open(coordinationLockPath, 'wx');
      let writeError: unknown = null;
      try {
        await handle.writeFile(JSON.stringify({ token, pid: process.pid, startedAt: new Date().toISOString() }));
      } catch (error) {
        writeError = error;
      }
      await handle.close();
      if (writeError) {
        await rm(coordinationLockPath, { force: true }).catch(() => undefined);
        throw writeError;
      }
      break;
    } catch {
      await cleanupStaleCoordinationLock();
      if (Date.now() >= deadline) throw new Error('runtime coordination lock timeout');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  try {
    return await operation();
  } finally {
    const lock = await readCoordinationLock();
    if (lock?.token === token) await rm(coordinationLockPath, { force: true }).catch(() => undefined);
  }
}

export function runtimeOperationLockPath() {
  return operationLockPath;
}

export async function acquireRuntimeOperationLock(
  kind: RuntimeOperationLock['kind'],
  operationId: string,
  jobId?: string,
) {
  await cleanupStaleOperationLock();
  await mkdir(path.dirname(operationLockPath), { recursive: true });
  const token = randomUUID();
  let handle;
  try {
    handle = await open(operationLockPath, 'wx');
  } catch {
    if (await cleanupStaleOperationLock()) {
      try {
        handle = await open(operationLockPath, 'wx');
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }
  const lock: RuntimeOperationLock = {
    kind,
    operationId,
    token,
    instanceId: runtimeInstanceId,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    ...(jobId ? { jobId } : {}),
  };
  try {
    await handle.writeFile(JSON.stringify(lock));
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(operationLockPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();
  return { token, lock };
}

export async function operationLockMatches(token: string) {
  const lock = await readOperationLock();
  return Boolean(lock?.token && lock.token === token);
}

export async function removeOwnedRuntimeOperationLock(token: string) {
  if (!(await operationLockMatches(token))) return false;
  await rm(operationLockPath, { force: true }).catch(() => undefined);
  return true;
}

export async function getRuntimeDrainStatus(): Promise<RuntimeDrainStatus> {
  await cleanupStaleDrainMarker();
  await cleanupStaleRequests();
  const entries = await readdir(requestDir, { withFileTypes: true }).catch(() => []);
  const requestIds = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.slice(0, -'.json'.length));
  return { draining: await drainMarkerExists(), activeRequests: requestIds.length, requestIds };
}

export async function beginRuntimeRequest(kind: string): Promise<() => Promise<void>> {
  const { record, requestFile } = await withRuntimeCoordination(async () => {
    await cleanupStaleDrainMarker();
    if (await drainMarkerExists()) throw new RuntimeDrainingError();
    await mkdir(requestDir, { recursive: true });
    const id = randomUUID();
    const nextRecord: RuntimeRequestRecord = { id, instanceId: runtimeInstanceId, pid: process.pid, kind, startedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() };
    const file = await open(requestPath(id), 'wx');
    try {
      await file.writeFile(JSON.stringify(nextRecord));
    } finally {
      await file.close();
    }
    return { record: nextRecord, requestFile: requestPath(id) };
  });

  let released = false;
  const heartbeat = setInterval(() => {
    if (released) return;
    void writeFile(requestFile, JSON.stringify({ ...record, lastSeenAt: new Date().toISOString() })).catch(() => undefined);
  }, 30_000);
  heartbeat.unref?.();
  return async () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    await rm(requestFile, { force: true }).catch(() => undefined);
  };
}

export async function withRuntimeRequest<T>(kind: string, operation: () => Promise<T>) {
  const release = await beginRuntimeRequest(kind);
  try {
    return await operation();
  } finally {
    await release();
  }
}

export async function beginRuntimeDrain(operationId: string = randomUUID()) {
  let created = false;
  try {
    created = await withRuntimeCoordination(async () => {
      await cleanupStaleDrainMarker();
      await mkdir(dataDir, { recursive: true });
      try {
      await writeFile(drainPath, JSON.stringify({ operationId, instanceId: runtimeInstanceId, pid: process.pid, startedAt: new Date().toISOString() }), { flag: 'wx' });
        return true;
      } catch {
        return false;
      }
    });
  } catch {
    return null;
  }
  if (!created) return null;
  return getRuntimeDrainStatus();
}

export async function cancelRuntimeDrain(operationId?: string) {
  if (operationId) {
    const marker = await readDrainMarker();
    if (marker?.operationId && marker.operationId !== operationId) return;
  }
  await rm(drainPath, { force: true }).catch(() => undefined);
}

export async function waitForRuntimeIdle(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getRuntimeDrainStatus();
    if (status.activeRequests === 0) return status;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return getRuntimeDrainStatus();
}
