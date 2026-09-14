import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import packageInfo from '../package.json';

export type UpdateManifest = {
  schemaVersion: number;
  latestVersion: string;
  releaseUrl: string;
  projectUrl?: string;
  packageUrl?: string;
  mirrorUrls?: string[];
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
  mirrorUrls?: string[];
  sha256?: string;
  applyUnavailableReason?: 'missing-package' | 'missing-checksum' | 'disabled' | 'missing-updater';
  canApply: boolean;
  publishedAt?: string;
  notes?: string[];
  checkedAt: string;
  error?: string;
};

export const currentVersion = String(packageInfo.version || '0.0.0');
const defaultManifestUrl = 'https://raw.githubusercontent.com/sanmao44/sanmao.ai-LuminaAgent/main/update.json';
// cdn.jsdelivr.net serves stale content for the @main branch, so no-VPN users
// rely on the jsDelivr Fastly/Gcore edges and the raw.githubusercontent.com
// acceleration mirrors which stay fresh and are reachable from China.
const defaultManifestMirrors = [
  'https://fastly.jsdelivr.net/gh/sanmao44/sanmao.ai-LuminaAgent@main/update.json',
  'https://gcore.jsdelivr.net/gh/sanmao44/sanmao.ai-LuminaAgent@main/update.json',
  'https://ghfast.top/https://raw.githubusercontent.com/sanmao44/sanmao.ai-LuminaAgent/main/update.json',
  'https://gh-proxy.com/https://raw.githubusercontent.com/sanmao44/sanmao.ai-LuminaAgent/main/update.json',
];
const manifestFetchTimeoutMs = 5_000;
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

function chooseUpdateStatus(current: UpdateStatus, candidate: UpdateStatus) {
  const versionComparison = compareVersions(candidate.latestVersion || '0.0.0', current.latestVersion || '0.0.0');
  if (versionComparison > 0) return candidate;
  if (versionComparison < 0) return current;
  // CDN mirrors can briefly disagree on fields while serving the same version.
  // Prefer the complete, locally applicable manifest instead of letting an
  // empty checksum downgrade the in-app update experience.
  if (!current.canApply && candidate.canApply) return candidate;
  if (!current.packageUrl && candidate.packageUrl) return candidate;
  if (!current.sha256 && candidate.sha256) return candidate;
  return current;
}

function configuredManifestUrl() {
  return process.env.SANMAO_UPDATE_MANIFEST_URL?.trim() || defaultManifestUrl;
}

function configuredManifestMirrors() {
  return (process.env.SANMAO_UPDATE_MANIFEST_MIRRORS || '')
    .split(/[\r\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function validHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function manifestUrlCandidates() {
  const customManifestUrl = process.env.SANMAO_UPDATE_MANIFEST_URL?.trim();
  const candidates = customManifestUrl
    ? [customManifestUrl]
    : [defaultManifestUrl, ...defaultManifestMirrors];
  candidates.push(...configuredManifestMirrors());
  return [...new Set(candidates)].filter(validHttpUrl);
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

function validPackageUrl(value: string) {
  try {
    const parsed = new URL(value);
    // The manifest itself is fetched from the official project URL, while the
    // package may be mirrored by Gitee, OSS, or a private CDN. Keep every
    // mirror HTTPS-only and reject credential-bearing or fragment URLs.
    return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password && !parsed.hash;
  } catch {
    return false;
  }
}

function validSha256(value: string) {
  return /^[a-f0-9]{64}$/i.test(value) && !/^0{64}$/i.test(value);
}

function getApplyUnavailableReason(packageUrl?: string, sha256?: string) {
  if (process.env.SANMAO_DISABLE_LOCAL_UPDATE === '1') return 'disabled' as const;
  if (!packageUrl) return 'missing-package' as const;
  if (!sha256) return 'missing-checksum' as const;
  if (!hasLocalUpdater()) return 'missing-updater' as const;
  return undefined;
}

function statusFromManifest(raw: Partial<UpdateManifest>, checkedAt: string): UpdateStatus {
  const latestVersion = String(raw.latestVersion || '').trim();
  const releaseUrl = String(raw.releaseUrl || '').trim();
  const projectUrl = typeof raw.projectUrl === 'string' && validHttpUrl(raw.projectUrl) ? raw.projectUrl.trim() : undefined;
  const packageUrl = typeof raw.packageUrl === 'string' && validPackageUrl(raw.packageUrl) ? raw.packageUrl.trim() : undefined;
  const mirrorUrls = Array.isArray(raw.mirrorUrls)
    ? [...new Set(raw.mirrorUrls.filter((value): value is string => typeof value === 'string' && validPackageUrl(value)).map((value) => value.trim()))].slice(0, 4)
    : [];
  const sha256 = typeof raw.sha256 === 'string' && validSha256(raw.sha256) ? raw.sha256.trim().toLowerCase() : undefined;

  if (!latestVersion || !validHttpUrl(releaseUrl)) throw new Error('更新清单格式无效');
  const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
  const applyUnavailableReason = hasUpdate ? getApplyUnavailableReason(packageUrl, sha256) : undefined;
  return {
    configured: true,
    currentVersion,
    latestVersion,
    hasUpdate,
    releaseUrl,
    projectUrl,
    packageUrl,
    mirrorUrls,
    sha256,
    applyUnavailableReason,
    canApply: hasUpdate && !applyUnavailableReason,
    publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : undefined,
    notes: Array.isArray(raw.notes) ? raw.notes.filter((note): note is string => typeof note === 'string').slice(0, 8) : [],
    checkedAt,
  };
}

function readLocalManifest(): Partial<UpdateManifest> | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'update.json'), 'utf8')) as Partial<UpdateManifest>;
  } catch {
    return null;
  }
}

async function fetchManifestFromSource(url: string, checkedAt: string): Promise<UpdateStatus> {
  const parsedUrl = new URL(url);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('不支持的更新清单协议');

  const response = await fetch(parsedUrl, {
    cache: 'no-store',
    headers: { Accept: 'application/json', 'User-Agent': 'SANMAO.AI update checker' },
    signal: AbortSignal.timeout(manifestFetchTimeoutMs),
  });
  if (!response.ok) throw new Error(`更新清单返回 HTTP ${response.status}`);

  const raw = await response.json() as Partial<UpdateManifest>;
  return statusFromManifest(raw, checkedAt);
}

export async function getUpdateStatus(force = false): Promise<UpdateStatus> {
  const urls = manifestUrlCandidates();
  if (!urls.length) return baseStatus();
  if (!force && cached && cached.expiresAt > Date.now()) return cached.status;

  const checkedAt = new Date().toISOString();
  try {
    // Query all sensible sources at once, but wait for every response before
    // selecting a result. A CDN can return an older, cached manifest with HTTP
    // 200; accepting the first healthy response would hide a newer release
    // that another source already knows about.
    const results = await Promise.allSettled(urls.map((url) => fetchManifestFromSource(url, checkedAt)));
    const statuses = results
      .filter((result): result is PromiseFulfilledResult<UpdateStatus> => result.status === 'fulfilled')
      .map((result) => result.value);
    if (!statuses.length) throw new Error('所有更新清单源均不可用');
    const status = statuses.reduce(chooseUpdateStatus);
    cached = { expiresAt: Date.now() + cacheTtlMs, status };
    return status;
  } catch (error) {
    const localManifest = readLocalManifest();
    if (localManifest) {
      try {
        const status = statusFromManifest(localManifest, checkedAt);
        cached = { expiresAt: Date.now() + 10 * 60 * 1000, status };
        return status;
      } catch {
        // 本地清单无效时继续返回错误状态，让界面明确提示检查失败。
      }
    }
    const status = {
      ...baseStatus(checkedAt),
      configured: true,
      error: '无法连接 GitHub 更新源，已尝试多个镜像；请检查网络或稍后重试',
    };
    cached = { expiresAt: Date.now() + 10 * 60 * 1000, status };
    return status;
  }
}
