import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveStoredFileWithFallback } from './image-storage';
import { resolveStoredVideoFile } from './video-storage';
import { getDefaultAudioStoragePath, resolveStoredAudioFile } from './audio-storage';

export const AGNES_PUBLIC_MEDIA_URL_REQUIRED = 'AGNES_PUBLIC_MEDIA_URL_REQUIRED';
export const AGNES_PUBLIC_MEDIA_URL_INVALID = 'AGNES_PUBLIC_MEDIA_URL_INVALID';
export const AGNES_MEDIA_RELAY_REQUIRED = 'AGNES_MEDIA_RELAY_REQUIRED';
export const AGNES_MEDIA_RELAY_UNAVAILABLE = 'AGNES_MEDIA_RELAY_UNAVAILABLE';
export const AGNES_MEDIA_RELAY_REJECTED = 'AGNES_MEDIA_RELAY_REJECTED';
export const AGNES_MEDIA_TTL_MS = 30 * 60 * 1000;
// Generic names are used by the provider-agnostic relay. The Agnes names
// above remain exported for compatibility with existing local state and
// integrations.
export const PUBLIC_MEDIA_URL_REQUIRED = AGNES_PUBLIC_MEDIA_URL_REQUIRED;
export const PUBLIC_MEDIA_URL_INVALID = AGNES_PUBLIC_MEDIA_URL_INVALID;
export const MEDIA_RELAY_REQUIRED = AGNES_MEDIA_RELAY_REQUIRED;
export const MEDIA_RELAY_UNAVAILABLE = AGNES_MEDIA_RELAY_UNAVAILABLE;
export const MEDIA_RELAY_REJECTED = AGNES_MEDIA_RELAY_REJECTED;
export const PUBLIC_MEDIA_TTL_MS = AGNES_MEDIA_TTL_MS;
const MEDIA_KINDS = new Set(['image', 'video', 'audio']);
const MIME_PATTERN = /^(image|video|audio)\/[a-z0-9.+-]+$/i;
let manifestMutationChain: Promise<unknown> = Promise.resolve();

type MediaManifestEntry = {
  id: string;
  filename: string;
  mime: string;
  kind: 'image' | 'video' | 'audio';
  expiresAt: number;
};

type MediaManifest = Record<string, MediaManifestEntry>;

export class PublicMediaError extends Error {
  code: string;
  constructor(message: string, code = AGNES_PUBLIC_MEDIA_URL_REQUIRED) {
    super(message);
    this.name = 'PublicMediaError';
    this.code = code;
  }
}

// Compatibility class for callers that imported the old Agnes-specific name.
export class AgnesMediaError extends PublicMediaError {}

function dataDir() { return process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data'); }
function mediaDir() { return path.join(dataDir(), 'agnes-media'); }
function manifestPath() { return path.join(mediaDir(), 'manifest.json'); }
function secretPath() { return path.join(mediaDir(), 'signing.key'); }

async function configuredStorageRoot(kind: 'image' | 'video' | 'audio') {
  const environmentRoot = kind === 'image'
    ? process.env.SANMAO_IMAGE_STORAGE_PATH
    : kind === 'video'
      ? process.env.SANMAO_VIDEO_STORAGE_PATH
      : process.env.SANMAO_AUDIO_STORAGE_PATH;
  if (environmentRoot?.trim()) return environmentRoot.trim();
  if (kind === 'audio') return getDefaultAudioStoragePath();
  try {
    const state = JSON.parse(await readFile(path.join(dataDir(), 'state.json'), 'utf8')) as { settings?: Record<string, unknown> };
    const configured = state.settings?.[
      kind === 'image' ? 'imageStoragePath' : kind === 'video' ? 'videoStoragePath' : 'audioStoragePath'
    ];
    return typeof configured === 'string' ? configured.trim() : '';
  } catch { return ''; }
}

function cleanMime(value: string) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function extensionForMime(mime: string) {
  const value = cleanMime(mime);
  if (value === 'image/jpeg') return 'jpg';
  if (value === 'image/svg+xml') return 'svg';
  if (value === 'image/webp') return 'webp';
  if (value === 'video/webm') return 'webm';
  if (value === 'video/quicktime') return 'mov';
  if (value === 'audio/mpeg') return 'mp3';
  if (value === 'audio/wav' || value === 'audio/x-wav') return 'wav';
  if (value === 'audio/ogg') return 'ogg';
  return value.split('/')[1]?.replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'bin';
}

function parseDataUrl(value: string) {
  const match = String(value || '').match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  const mime = cleanMime(match[1]);
  try {
    const data = match[2] ? Buffer.from(match[3].replace(/\s/g, ''), 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8');
    return { mime, data };
  } catch { return null; }
}

function publicBaseUrl() {
  return String(process.env.SANMAO_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
}

function runningRelayUrl() {
  if (process.env.SANMAO_RELAY_MODE !== '1') return '';
  try {
    const file = path.join(dataDir(), 'free-relay', 'public-url.txt');
    const value = readFileSync(file, 'utf8').trim().replace(/\/+$/, '');
    return isUsablePublicBaseUrl(value) ? value : '';
  } catch { return ''; }
}

function mediaRelayUrl() {
  if (process.env.SANMAO_RELAY_MODE === '1') return runningRelayUrl();
  return String(process.env.SANMAO_MEDIA_RELAY_URL || process.env.SANMAO_DEFAULT_MEDIA_RELAY_URL || '').trim().replace(/\/+$/, '');
}

function relayPublicBaseUrl() {
  if (process.env.SANMAO_RELAY_MODE === '1') return runningRelayUrl();
  return String(process.env.SANMAO_RELAY_PUBLIC_BASE_URL || process.env.SANMAO_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
}

function isPrivateOrLocalHostname(hostname: string) {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost' || value.endsWith('.local') || value === '::1' || value === '0.0.0.0') return true;
  if (/^127\./.test(value) || /^10\./.test(value) || /^192\.168\./.test(value) || /^169\.254\./.test(value)) return true;
  const ipv4 = value.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return false;
  const [, first, second] = ipv4.map(Number);
  return first === 172 && second >= 16 && second <= 31;
}

function isLocalHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && isPrivateOrLocalHostname(parsed.hostname);
  } catch { return false; }
}

function isUsablePublicBaseUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !isPrivateOrLocalHostname(parsed.hostname);
  } catch { return false; }
}

function ensureAutomaticRelayBypass(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (!hostname.endsWith('.trycloudflare.com')) return;
    // The launcher may enable a local system proxy for upstream model calls.
    // Quick-tunnel health and uploads must bypass that proxy: many proxy
    // clients do not support trycloudflare's edge handshake reliably.
    for (const key of ['NO_PROXY', 'no_proxy']) {
      const current = String(process.env[key] || '');
      const entries = current.split(',').map((entry) => entry.trim()).filter(Boolean);
      if (!entries.some((entry) => entry === 'trycloudflare.com' || entry === '.trycloudflare.com')) {
        entries.push('trycloudflare.com', '.trycloudflare.com');
        process.env[key] = entries.join(',');
      }
    }
  } catch {}
}

function assertUsablePublicBaseUrl(value: string, code = AGNES_PUBLIC_MEDIA_URL_INVALID) {
  if (!isUsablePublicBaseUrl(value)) {
    throw new PublicMediaError('图片中转服务地址无效：必须是外网可访问的 HTTPS 地址。', code);
  }
  return value;
}

async function readManifest(): Promise<MediaManifest> {
  try {
    const value = JSON.parse(await readFile(manifestPath(), 'utf8'));
    return value && typeof value === 'object' ? value as MediaManifest : {};
  } catch { return {}; }
}

async function writeManifest(manifest: MediaManifest) {
  await mkdir(mediaDir(), { recursive: true });
  const temporary = `${manifestPath()}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, manifestPath());
}

async function mutateManifest<T>(fn: (manifest: MediaManifest) => Promise<T> | T) {
  const operation = manifestMutationChain.then(async () => {
    const manifest = await readManifest();
    const result = await fn(manifest);
    await writeManifest(manifest);
    return result;
  });
  manifestMutationChain = operation.then(() => undefined, () => undefined);
  return operation;
}

async function signingKey() {
  const configured = String(process.env.SANMAO_MEDIA_SIGNING_KEY || process.env.SANMAO_MASTER_KEY || '').trim();
  if (configured) return configured;
  await mkdir(mediaDir(), { recursive: true });
  try { return (await readFile(secretPath(), 'utf8')).trim(); } catch {}
  const key = randomUUID() + randomUUID();
  try { await writeFile(secretPath(), `${key}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); } catch {}
  return (await readFile(secretPath(), 'utf8')).trim() || key;
}

function signature(payload: string, key: string) {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

function tokenFor(entry: MediaManifestEntry, key: string) {
  const payload = `${entry.id}.${entry.expiresAt}`;
  return `${payload}.${signature(payload, key)}`;
}

function kindForMime(mime: string): 'image' | 'video' | 'audio' | null {
  const kind = cleanMime(mime).split('/', 1)[0];
  return MEDIA_KINDS.has(kind) ? kind as 'image' | 'video' | 'audio' : null;
}

function safeMediaFile(filename: unknown) {
  if (typeof filename !== 'string' || !filename || path.basename(filename) !== filename) return null;
  const root = path.resolve(mediaDir());
  const file = path.resolve(root, filename);
  return file.startsWith(`${root}${path.sep}`) ? file : null;
}

async function localReferencePath(value: string, kind: 'image' | 'video' | 'audio') {
  let parsed: URL;
  try { parsed = new URL(value, 'http://sanmao.local'); } catch { return null; }
  const name = parsed.searchParams.get('name') || '';
  if (!name || name.includes('\0')) return null;
  if (parsed.pathname === '/api/storage/file' && kind === 'image') {
    return resolveStoredFileWithFallback(await configuredStorageRoot(kind), name);
  }
  if (parsed.pathname === '/api/storage/video' && kind === 'video') {
    const root = path.resolve((await configuredStorageRoot(kind)) || path.join(dataDir(), 'videos'));
    return resolveStoredVideoFile(root, name);
  }
  if (parsed.pathname === '/api/storage/audio' && kind === 'audio') {
    return resolveStoredAudioFile((await configuredStorageRoot(kind)) || getDefaultAudioStoragePath(), name);
  }
  return null;
}

async function loadLocalReference(value: string, kind: 'image' | 'video' | 'audio') {
  const file = await localReferencePath(value, kind);
  if (!file || !existsSync(file)) return null;
  const data = await readFile(file);
  const extension = path.extname(file).toLowerCase();
  const mime = kind === 'image'
    ? extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png'
    : kind === 'video'
      ? extension === '.webm' ? 'video/webm' : extension === '.mov' ? 'video/quicktime' : 'video/mp4'
      : extension === '.wav' ? 'audio/wav' : extension === '.ogg' ? 'audio/ogg' : 'audio/mpeg';
  return { data, mime };
}

export async function cleanupExpiredMedia(now = Date.now()) {
  return mutateManifest(async (manifest) => {
    const remaining: MediaManifest = {};
    for (const [id, entry] of Object.entries(manifest)) {
      if (!entry || entry.expiresAt <= now || entry.id !== id) {
        const file = safeMediaFile(entry?.filename);
        if (file) await rm(file, { force: true }).catch(() => undefined);
      } else remaining[id] = entry;
    }
    const removed = Object.keys(manifest).length - Object.keys(remaining).length;
    for (const id of Object.keys(manifest)) if (!remaining[id]) delete manifest[id];
    return { removed, remaining: Object.keys(remaining).length };
  });
}

export const cleanupExpiredAgnesMedia = cleanupExpiredMedia;

export async function storeSignedMedia(data: Buffer, mime: string, kind: 'image' | 'video' | 'audio', options: { ttlMs?: number; publicBase?: string; pathPrefix?: string } = {}) {
  const clean = cleanMime(mime);
  if (!MIME_PATTERN.test(clean) || kindForMime(clean) !== kind) throw new PublicMediaError('只允许上传与媒体类型匹配的图片、视频或音频文件。', 'AGNES_MEDIA_TYPE_NOT_ALLOWED');
  const base = assertUsablePublicBaseUrl(String(options.publicBase || relayPublicBaseUrl()).trim().replace(/\/+$/, ''));
  const id = randomUUID();
  const expiresAt = Date.now() + Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Number(options.ttlMs) || AGNES_MEDIA_TTL_MS));
  const filename = `${id}.${extensionForMime(clean)}`;
  await mkdir(mediaDir(), { recursive: true });
  await writeFile(path.join(mediaDir(), filename), data, { flag: 'wx', mode: 0o600 });
  const entry: MediaManifestEntry = { id, filename, mime: clean, kind, expiresAt };
  await mutateManifest((manifest) => { manifest[id] = entry; });
  const key = await signingKey();
  const token = tokenFor(entry, key);
  await cleanupExpiredMedia();
  const prefix = String(options.pathPrefix || '/api/media').replace(/\/+$/, '');
  return { url: `${base}${prefix}/${encodeURIComponent(token)}`, expiresAt, bytes: data.byteLength, mime: clean, kind };
}

export const storeSignedAgnesMedia = storeSignedMedia;

async function uploadToPublicMediaRelay(data: Buffer, mime: string, kind: 'image' | 'video' | 'audio') {
  const relay = mediaRelayUrl();
  if (!relay) return null;
  const uploadToken = String(process.env.SANMAO_MEDIA_RELAY_UPLOAD_TOKEN || '').trim();
  // A watcher may replace the tunnel while an upload is in flight. Re-read
  // public-url.txt for each retry so the request follows the recovered URL.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = attempt === 0 ? relay : mediaRelayUrl();
    if (!candidate) {
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
      continue;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const endpoint = assertUsablePublicBaseUrl(candidate, AGNES_MEDIA_RELAY_UNAVAILABLE);
      ensureAutomaticRelayBypass(endpoint);
      const form = new FormData();
      const blobBytes = new Uint8Array(data.byteLength);
      blobBytes.set(data);
      form.append('file', new Blob([blobBytes.buffer], { type: mime }), `agnes-input.${extensionForMime(mime)}`);
      form.append('kind', kind);
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 8_000);
      const response = await fetch(`${endpoint}/api/relay/media`, {
        method: 'POST',
        ...(uploadToken ? { headers: { 'x-sanmao-relay-token': uploadToken } } : {}),
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      timeout = undefined;
      const payload = await response.json().catch(() => ({})) as { url?: unknown; expiresAt?: unknown; error?: unknown };
      if (!response.ok || typeof payload.url !== 'string') {
        const message = typeof payload.error === 'string' ? payload.error : response.status === 429 ? '上传过于频繁，请稍后重试' : '图片不符合中转服务要求';
        if (response.status >= 400 && response.status < 500) throw new PublicMediaError(`图片暂时无法提交：${message}。`, MEDIA_RELAY_REJECTED);
        throw new Error(message);
      }
      const url = payload.url.trim();
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new Error('中转服务返回的图片地址无效'); }
      if (!isUsablePublicBaseUrl(url) || parsed.origin !== new URL(endpoint).origin) throw new Error('中转服务返回的图片地址不安全');
      return { url, expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : undefined };
    } catch (error) {
      if (timeout) clearTimeout(timeout);
      if (error instanceof PublicMediaError) throw error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
        continue;
      }
      // Leave the loop so the stale quick-tunnel URL can be invalidated
      // before returning the user-facing relay error below.
      if (process.env.SANMAO_RELAY_MODE === '1') {
        try {
          const file = path.join(dataDir(), 'free-relay', 'public-url.txt');
          if (readFileSync(file, 'utf8').trim().replace(/\/+$/, '') === relay) rmSync(file, { force: true });
        } catch {}
      }
      break;
    }
  }
  throw new PublicMediaError('图片暂时无法提交：自动中转服务不可用，请稍后重试；也可以在高级设置中配置自己的公网图片地址。', MEDIA_RELAY_UNAVAILABLE);
}

export function getPublicMediaTransportStatus() {
  const relay = mediaRelayUrl();
  const publicBase = publicBaseUrl();
  return {
    mode: relay ? 'relay' : publicBase ? 'self-hosted' : 'unavailable',
    relayConfigured: Boolean(relay),
    publicBaseConfigured: Boolean(publicBase),
  } as const;
}

/**
 * Return transport status with a short live probe for the automatically
 * managed relay. A quick-tunnel URL can remain on disk after cloudflared has
 * lost its edge connection, so configuration alone is not a health signal.
 */
export async function getPublicMediaTransportStatusLive() {
  const status = getPublicMediaTransportStatus();
  const relay = mediaRelayUrl();
  if (!relay) return status;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  let reachable = false;
  try {
    ensureAutomaticRelayBypass(relay);
    const response = await fetch(`${relay}/api/health`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.ok) {
      const payload = await response.json().catch(() => null) as { service?: unknown; ok?: unknown } | null;
      reachable = payload?.service === 'sanmao-ai-studio' && payload?.ok === true;
    }
  } catch {}
  clearTimeout(timeout);
  return {
    ...status,
    mode: reachable ? 'relay' : 'unavailable',
    relayConfigured: true,
    publicUrl: relay,
    reachable,
  } as const;
}

export const getAgnesMediaTransportStatus = getPublicMediaTransportStatus;

export async function preparePublicMediaUrl(value: string, kind: 'image' | 'video' | 'audio', ttlMs = AGNES_MEDIA_TTL_MS) {
  const input = String(value || '').trim();
  if (!input) return input;
  let loaded: { data: Buffer; mime: string } | null = null;
  if (/^https?:\/\//i.test(input) && !isLocalHttpUrl(input)) return input;
  loaded = parseDataUrl(input);
  if (!loaded) loaded = await loadLocalReference(input, kind);
  if (!loaded) throw new PublicMediaError('当前服务商需要可公开访问的媒体地址；请提供有效的本地媒体或公网 URL。');
  const mime = cleanMime(loaded.mime);
  if (!MIME_PATTERN.test(mime) || kindForMime(mime) !== kind) throw new PublicMediaError('当前服务商只接受与媒体类型匹配的图片、视频或音频文件。', 'AGNES_MEDIA_TYPE_NOT_ALLOWED');
  if (mediaRelayUrl() && kind === 'image') {
    const uploaded = await uploadToPublicMediaRelay(loaded.data, mime, kind);
    if (uploaded) return uploaded.url;
  }
  const base = publicBaseUrl();
  if (!base) throw new PublicMediaError('图片暂时无法提交：应用的自动中转服务尚未连接。请稍后重试，或在高级设置中配置自己的公网图片地址。', MEDIA_RELAY_REQUIRED);
  assertUsablePublicBaseUrl(base);
  const stored = await storeSignedMedia(loaded.data, mime, kind, { ttlMs, publicBase: base, pathPrefix: '/api/media' });
  return stored.url;
}

// Kept as a compatibility alias for existing Agnes integrations and backups.
export const prepareAgnesMediaUrl = preparePublicMediaUrl;

export async function preparePublicMediaUrls(values: string[], kind: 'image' | 'video' | 'audio') {
  return Promise.all(values.map((value) => preparePublicMediaUrl(value, kind)));
}

export const prepareAgnesMediaUrls = preparePublicMediaUrls;

export async function readSignedMedia(token: string) {
  await cleanupExpiredMedia();
  let decoded = '';
  try { decoded = decodeURIComponent(String(token || '')); } catch { return null; }
  const parts = decoded.split('.');
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return null;
  const [id, expiresRaw, provided] = parts;
  const expiresAt = Number(expiresRaw);
  if (!id || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return null;
  const key = await signingKey();
  const expected = signature(`${id}.${expiresAt}`, key);
  const a = Buffer.from(provided); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const manifest = await readManifest();
  const entry = manifest[id];
  if (!entry || entry.id !== id || entry.expiresAt !== expiresAt || entry.expiresAt <= Date.now() || !MEDIA_KINDS.has(entry.kind) || !MIME_PATTERN.test(entry.mime)) return null;
  const file = safeMediaFile(entry.filename);
  if (!file) return null;
  try { return { data: await readFile(file), mime: entry.mime, expiresAt: entry.expiresAt }; } catch { return null; }
}

export const readSignedAgnesMedia = readSignedMedia;

export async function prepareAgnesChatMessages<T extends { content: unknown }>(messages: T[]) {
  return Promise.all(messages.map(async (message) => {
    if (!Array.isArray(message.content)) return message;
    const content = await Promise.all(message.content.map(async (part: any) => {
      if (part?.type === 'image_url' && typeof part?.image_url?.url === 'string') {
        return { ...part, image_url: { ...part.image_url, url: await prepareAgnesMediaUrl(part.image_url.url, 'image') } };
      }
      if (part?.type === 'video_url' && typeof part?.video_url?.url === 'string') {
        return { ...part, video_url: { ...part.video_url, url: await prepareAgnesMediaUrl(part.video_url.url, 'video') } };
      }
      return part;
    }));
    return { ...message, content };
  }));
}
