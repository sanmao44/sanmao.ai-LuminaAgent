import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveStoredFileWithFallback } from './image-storage';
import { resolveStoredVideoFile } from './video-storage';

export const AGNES_PUBLIC_MEDIA_URL_REQUIRED = 'AGNES_PUBLIC_MEDIA_URL_REQUIRED';
export const AGNES_PUBLIC_MEDIA_URL_INVALID = 'AGNES_PUBLIC_MEDIA_URL_INVALID';
const DEFAULT_TTL_MS = 15 * 60 * 1000;
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

export class AgnesMediaError extends Error {
  code: string;
  constructor(message: string, code = AGNES_PUBLIC_MEDIA_URL_REQUIRED) {
    super(message);
    this.name = 'AgnesMediaError';
    this.code = code;
  }
}

function dataDir() { return process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data'); }
function mediaDir() { return path.join(dataDir(), 'agnes-media'); }
function manifestPath() { return path.join(mediaDir(), 'manifest.json'); }
function secretPath() { return path.join(mediaDir(), 'signing.key'); }

async function configuredStorageRoot(kind: 'image' | 'video' | 'audio') {
  const environmentRoot = kind === 'image'
    ? process.env.SANMAO_IMAGE_STORAGE_PATH
    : kind === 'video'
      ? process.env.SANMAO_VIDEO_STORAGE_PATH
      : '';
  if (environmentRoot?.trim()) return environmentRoot.trim();
  if (kind === 'audio') return '';
  try {
    const state = JSON.parse(await readFile(path.join(dataDir(), 'state.json'), 'utf8')) as { settings?: Record<string, unknown> };
    const configured = state.settings?.[kind === 'image' ? 'imageStoragePath' : 'videoStoragePath'];
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

function isPrivateOrLocalHostname(hostname: string) {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost' || value.endsWith('.local') || value === '::1' || value === '0.0.0.0') return true;
  if (/^127\./.test(value) || /^10\./.test(value) || /^192\.168\./.test(value) || /^169\.254\./.test(value)) return true;
  const ipv4 = value.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return false;
  const [, first, second] = ipv4.map(Number);
  return first === 172 && second >= 16 && second <= 31;
}

function isUsablePublicBaseUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !isPrivateOrLocalHostname(parsed.hostname);
  } catch { return false; }
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

export async function cleanupExpiredAgnesMedia(now = Date.now()) {
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

export async function prepareAgnesMediaUrl(value: string, kind: 'image' | 'video' | 'audio', ttlMs = DEFAULT_TTL_MS) {
  const input = String(value || '').trim();
  if (!input) return input;
  if (/^https?:\/\//i.test(input)) return input;
  let loaded = parseDataUrl(input);
  if (!loaded) loaded = await loadLocalReference(input, kind);
  if (!loaded) throw new AgnesMediaError('Agnes 需要可公开访问的媒体地址；请提供有效的本地媒体或公网 URL。');
  const mime = cleanMime(loaded.mime);
  if (!MIME_PATTERN.test(mime) || kindForMime(mime) !== kind) throw new AgnesMediaError('Agnes 只接受与媒体类型匹配的图片、视频或音频文件。', 'AGNES_MEDIA_TYPE_NOT_ALLOWED');
  const base = publicBaseUrl();
  if (!base) throw new AgnesMediaError('Agnes 图生视频需要服务商可访问的公网媒体地址；当前本地素材未配置 SANMAO_PUBLIC_BASE_URL。请使用公网图片 URL，或设置为外网可访问的 HTTPS 地址后重启应用（localhost、127.0.0.1 和 192.168.x.x 均不可用）。纯文本请求不受影响。');
  if (!isUsablePublicBaseUrl(base)) throw new AgnesMediaError('SANMAO_PUBLIC_BASE_URL 无效：必须是外网可访问的 HTTPS 地址，不能使用 localhost、127.0.0.1、192.168.x.x、10.x.x.x 或普通 HTTP 地址。修改后请重启应用。', AGNES_PUBLIC_MEDIA_URL_INVALID);
  const id = randomUUID();
  const expiresAt = Date.now() + Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Number(ttlMs) || DEFAULT_TTL_MS));
  const filename = `${id}.${extensionForMime(mime)}`;
  await mkdir(mediaDir(), { recursive: true });
  await writeFile(path.join(mediaDir(), filename), loaded.data, { flag: 'wx', mode: 0o600 });
  const entry: MediaManifestEntry = { id, filename, mime, kind, expiresAt };
  await mutateManifest((manifest) => { manifest[id] = entry; });
  const key = await signingKey();
  const token = tokenFor(entry, key);
  await cleanupExpiredAgnesMedia();
  return `${base}/api/media/${encodeURIComponent(token)}`;
}

export async function prepareAgnesMediaUrls(values: string[], kind: 'image' | 'video' | 'audio') {
  return Promise.all(values.map((value) => prepareAgnesMediaUrl(value, kind)));
}

export async function readSignedAgnesMedia(token: string) {
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

export async function prepareAgnesChatMessages<T extends { content: unknown }>(messages: T[]) {
  return Promise.all(messages.map(async (message) => {
    if (!Array.isArray(message.content)) return message;
    const content = await Promise.all(message.content.map(async (part: any) => {
      if (part?.type !== 'image_url' || typeof part?.image_url?.url !== 'string') return part;
      return { ...part, image_url: { ...part.image_url, url: await prepareAgnesMediaUrl(part.image_url.url, 'image') } };
    }));
    return { ...message, content };
  }));
}
