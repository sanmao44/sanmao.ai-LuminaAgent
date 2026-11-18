import { timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { MultipartBodyTooLargeError, readBoundedMultipartFormData } from '@/apps/api/multipart-upload-http';
import { PUBLIC_MEDIA_TTL_MS, storeSignedMedia } from '@/lib/signed-media';
import { beginRuntimeRequest, RuntimeDrainingError } from '@/lib/runtime-operation';

export const runtime = 'nodejs';

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = Math.max(MAX_IMAGE_BYTES, MAX_AUDIO_BYTES, MAX_VIDEO_BYTES) + 128 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 10;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function relayEnabled() {
  return process.env.SANMAO_RELAY_MODE === '1';
}

function uploadTokenStatus(request: Request): 'unconfigured' | 'invalid' | 'valid' {
  const expected = String(process.env.SANMAO_MEDIA_RELAY_UPLOAD_TOKEN || '').trim();
  if (!expected) return 'unconfigured';
  const actual = request.headers.get('x-sanmao-relay-token') || '';
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? 'valid' : 'invalid';
}

function clientKey(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}

function consumeRateLimit(key: string) {
  const now = Date.now();
  for (const [bucketKey, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(bucketKey);
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= RATE_LIMIT) return { allowed: false, retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) };
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function detectedMime(format: string | undefined) {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  if (format === 'gif') return 'image/gif';
  return '';
}

function audioMimeMatches(bytes: Buffer, mime: string) {
  const ascii = (start: number, length: number) => bytes.toString('ascii', start, start + length);
  if (mime === 'audio/mpeg') return ascii(0, 3) === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  if (mime === 'audio/wav') return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE';
  if (mime === 'audio/ogg') return ascii(0, 4) === 'OggS';
  if (mime === 'audio/flac') return ascii(0, 4) === 'fLaC';
  if (mime === 'audio/aac') return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
  if (mime === 'audio/mp4') return ascii(4, 4) === 'ftyp';
  return false;
}

function normalizeAudioMime(value: string) {
  const mime = value.split(';', 1)[0].trim().toLowerCase();
  if (mime === 'audio/x-wav') return 'audio/wav';
  if (mime === 'audio/x-m4a' || mime === 'audio/m4a') return 'audio/mp4';
  if (mime === 'audio/x-flac') return 'audio/flac';
  if (mime === 'audio/oga') return 'audio/ogg';
  if (mime === 'audio/x-aac') return 'audio/aac';
  return mime;
}

function normalizeVideoMime(value: string) {
  const mime = value.split(';', 1)[0].trim().toLowerCase();
  return mime === 'video/x-m4v' ? 'video/mp4' : mime;
}

function videoMimeMatches(bytes: Buffer, mime: string) {
  const isIsoBmff = bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp';
  const isWebm = bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  return mime === 'video/webm' ? isWebm
    : mime === 'video/mp4' || mime === 'video/quicktime' ? isIsoBmff
      : false;
}

export async function POST(request: Request) {
  if (!relayEnabled()) return Response.json({ error: '媒体中转服务未启用' }, { status: 404 });
  const uploadAuth = uploadTokenStatus(request);
  if (uploadAuth === 'unconfigured') return Response.json({ error: '媒体中转服务未配置上传访问令牌' }, { status: 503 });
  if (uploadAuth === 'invalid') return Response.json({ error: '上传授权无效' }, { status: 401 });
  const rate = consumeRateLimit(clientKey(request));
  if (!rate.allowed) return Response.json({ error: `上传过于频繁，请约 ${rate.retryAfterSeconds} 秒后重试` }, { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } });
  let releaseRuntimeRequest = async () => {};
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('relay-upload');
    const form = await readBoundedMultipartFormData(request, MAX_REQUEST_BYTES);
    const file = form.get('file');
    const kind = String(form.get('kind') || 'image');
    if (!(file instanceof File) || (kind !== 'image' && kind !== 'audio' && kind !== 'video')) return Response.json({ error: '当前中转服务只接收受支持的图片、音频或视频' }, { status: 415 });
    const maxBytes = kind === 'audio' ? MAX_AUDIO_BYTES : kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    const label = kind === 'audio' ? '音频' : kind === 'video' ? '视频' : '图片';
    if (file.size > maxBytes) return Response.json({ error: `${label}不能超过 ${Math.round(maxBytes / 1024 / 1024)} MiB（本站上传限制）` }, { status: 413 });
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!bytes.length || bytes.length > maxBytes) return Response.json({ error: `${label}不能超过 ${Math.round(maxBytes / 1024 / 1024)} MiB（本站上传限制）` }, { status: 413 });
    let mime: string;
    if (kind === 'audio') {
      mime = normalizeAudioMime(file.type);
      if (!audioMimeMatches(bytes, mime)) return Response.json({ error: '音频内容与声明格式不一致或格式不受支持' }, { status: 415 });
    } else if (kind === 'video') {
      mime = normalizeVideoMime(file.type);
      if (!videoMimeMatches(bytes, mime)) return Response.json({ error: '视频内容与声明格式不一致或格式不受支持' }, { status: 415 });
    } else {
      const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
      mime = detectedMime(metadata.format);
      if (!mime) return Response.json({ error: '只支持 JPG、PNG、WebP 或 GIF 图片' }, { status: 415 });
    }
    const stored = await storeSignedMedia(bytes, mime, kind, { ttlMs: PUBLIC_MEDIA_TTL_MS, pathPrefix: '/api/relay/media' });
    return Response.json({ ok: true, url: stored.url, expiresAt: new Date(stored.expiresAt).toISOString(), bytes: stored.bytes }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MultipartBodyTooLargeError) return Response.json({ error: '上传请求超过本站媒体上传限制' }, { status: 413 });
    if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message, retryable: true }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : '图片中转失败' }, { status: 400 });
  } finally {
    await releaseRuntimeRequest();
  }
}
