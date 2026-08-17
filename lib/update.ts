import { existsSync } from 'node:fs';
import { join } from 'node:path';
import packageInfo from '../package.json';

export type UpdateManifest = {
  schemaVersion: number;
  latestVersion: string;
  releaseUrl: string;
  projectUrl?: string;
  packageUrl?: string;
  sha256?: string;
  publishedAt?: string;
  notes?: string[];
};

export type UpdateStatus = {
  configured: boolean;
  currentVersion: string;
  latestVersion?: string;
  hasUpdate: boolean;
  releaseUrl?: string;
  projectUrl?: string;
  packageUrl?: string;
  sha256?: string;
  canApply: boolean;
  publishedAt?: string;
  notes?: string[];
  checkedAt: string;
  error?: string;
};

const currentVersion = String(packageInfo.version || '0.0.0');
const defaultManifestUrl = 'https://raw.githubusercontent.com/sanmao44/sanmao.ai-LuminaAgent/main/update.json';
const cacheTtlMs = 6 * 60 * 60 * 1000;
let cached: { expiresAt: number; status: UpdateStatus } | null = null;

function versionParts(value: string) {
  const match = value.trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : [0, 0, 0];
}

export function compareVersions(left: string, right: string) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function configuredManifestUrl() {
  return process.env.SANMAO_UPDATE_MANIFEST_URL?.trim() || defaultManifestUrl;
}

function hasLocalUpdater() {
  if (process.env.SANMAO_DISABLE_LOCAL_UPDATE === '1') return false;
  const script = process.platform === 'win32' ? 'apply-update.ps1' : 'apply-update.sh';
  return existsSync(join(process.cwd(), 'scripts', script));
}

function baseStatus(checkedAt = new Date().toISOString()): UpdateStatus {
  return {
    configured: Boolean(configuredManifestUrl()),
    currentVersion,
    hasUpdate: false,
    canApply: false,
    checkedAt,
  };
}

function validHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function validPackageUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && ['github.com', 'codeload.github.com'].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function validSha256(value: string) {
  return /^[a-f0-9]{64}$/i.test(value);
}

export async function getUpdateStatus(force = false): Promise<UpdateStatus> {
  const url = configuredManifestUrl();
  if (!url) return baseStatus();
  if (!force && cached && cached.expiresAt > Date.now()) return cached.status;

  const checkedAt = new Date().toISOString();
  try {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('更新清单地址必须使用 HTTP 或 HTTPS');
    const response = await fetch(parsedUrl, {
      cache: 'no-store',
      headers: { Accept: 'application/json', 'User-Agent': 'SANMAO.AI update checker' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`更新清单返回 HTTP ${response.status}`);

    const raw = await response.json() as Partial<UpdateManifest>;
    const latestVersion = String(raw.latestVersion || '').trim();
    const releaseUrl = String(raw.releaseUrl || '').trim();
    const projectUrl = typeof raw.projectUrl === 'string' && validHttpUrl(raw.projectUrl) ? raw.projectUrl.trim() : undefined;
    const packageUrl = typeof raw.packageUrl === 'string' && validPackageUrl(raw.packageUrl) ? raw.packageUrl.trim() : undefined;
    const sha256 = typeof raw.sha256 === 'string' && validSha256(raw.sha256) ? raw.sha256.trim().toLowerCase() : undefined;

    if (!latestVersion || !validHttpUrl(releaseUrl)) throw new Error('更新清单格式无效');
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
    const status: UpdateStatus = {
      configured: true,
      currentVersion,
      latestVersion,
      hasUpdate,
      releaseUrl,
      projectUrl,
      packageUrl,
      sha256,
      canApply: hasUpdate && Boolean(packageUrl && sha256 && hasLocalUpdater()),
      publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : undefined,
      notes: Array.isArray(raw.notes) ? raw.notes.filter((note): note is string => typeof note === 'string').slice(0, 8) : [],
      checkedAt,
    };
    cached = { expiresAt: Date.now() + cacheTtlMs, status };
    return status;
  } catch (error) {
    const status = {
      ...baseStatus(checkedAt),
      configured: true,
      error: error instanceof Error ? error.message : '更新检查失败',
    };
    cached = { expiresAt: Date.now() + 10 * 60 * 1000, status };
    return status;
  }
}
