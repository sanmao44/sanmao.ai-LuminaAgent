import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import packageInfo from '../package.json';
import { getRuntimeDrainStatus } from './runtime-operation';

const root = process.cwd();
const buildIdPath = path.join(root, '.next', 'BUILD_ID');
const builtFingerprintPath = path.join(root, '.next', '.sanmao-source-fingerprint');
const restartStatusPath = path.join(root, '.data', 'runtime-restart', 'status.json');

const trackedDirectories = ['app', 'components', 'lib', 'public'];
const trackedFiles = ['next.config.ts', 'next.config.js', 'tsconfig.json', 'package.json', 'package-lock.json'];
const dependencyFiles = ['package.json', 'package-lock.json'];
const FINGERPRINT_CACHE_MS = 3_000;
let fingerprintCache: { at: number; value: string } | null = null;

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function sourceFiles() {
  const files: string[] = [];
  for (const directory of trackedDirectories) files.push(...await collectFiles(path.join(root, directory)));
  for (const file of trackedFiles) files.push(path.join(root, file));
  const envFiles = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of envFiles) if (entry.isFile() && entry.name.startsWith('.env')) files.push(path.join(root, entry.name));
  return files.filter((file) => !file.includes(`${path.sep}.next${path.sep}`) && !file.includes(`${path.sep}node_modules${path.sep}`)).sort();
}

export async function calculateSourceFingerprint() {
  if (fingerprintCache && Date.now() - fingerprintCache.at < FINGERPRINT_CACHE_MS) return fingerprintCache.value;
  const hash = createHash('sha256');
  for (const file of await sourceFiles()) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    hash.update(relative);
    hash.update('\0');
    try { hash.update(await readFile(file)); } catch { hash.update('missing'); }
    hash.update('\0');
  }
  const value = hash.digest('hex');
  fingerprintCache = { at: Date.now(), value };
  return value;
}

async function readTrimmed(file: string) {
  try { return (await readFile(file, 'utf8')).trim(); } catch { return ''; }
}

async function readRestartStatus() {
  try { return JSON.parse(await readFile(restartStatusPath, 'utf8')) as Record<string, unknown>; } catch { return null; }
}

async function dependenciesChangedSinceBuild() {
  const build = await stat(buildIdPath).catch(() => null);
  if (!build) return false;
  const files = await Promise.all(dependencyFiles.map((file) => stat(path.join(root, file)).catch(() => null)));
  return files.some((file) => file && file.mtimeMs >= build.mtimeMs);
}

export async function getRuntimeStatus() {
  const [buildId, builtFingerprint, sourceFingerprint, drain, restartStatus, dependenciesChanged] = await Promise.all([
    readTrimmed(buildIdPath),
    readTrimmed(builtFingerprintPath),
    calculateSourceFingerprint(),
    getRuntimeDrainStatus(),
    readRestartStatus(),
    dependenciesChangedSinceBuild(),
  ]);
  return {
    ok: true,
    version: packageInfo.version,
    buildId,
    builtFingerprint,
    sourceFingerprint,
    sourceStale: !builtFingerprint || builtFingerprint !== sourceFingerprint,
    dependenciesChanged,
    pid: process.pid,
    networkMode: process.env.SANMAO_NETWORK_MODE === 'lan' ? 'lan' : 'local',
    lifecycleEnabled: process.env.SANMAO_LIFECYCLE === '1',
    ...drain,
    restartStatus,
  };
}

export function runtimeOperationLockPath() {
  return path.join(root, '.data', 'update-staging', 'update.lock');
}

export function runtimeRestartStatusPath() {
  return restartStatusPath;
}
