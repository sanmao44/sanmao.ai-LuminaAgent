import { timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { PUBLIC_MEDIA_TTL_MS, storeSignedMedia } from '@/lib/signed-media';

export const runtime = 'nodejs';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 128 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 10;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function relayEnabled() {
  return process.env.SANMAO_RELAY_MODE === '1';
}

function uploadTokenMatches(request: Request) {
  const expected = String(process.env.SANMAO_MEDIA_RELAY_UPLOAD_TOKEN || '').trim();
  if (!expected) return true;
  const actual = request.headers.get('x-sanmao-relay-token') || '';
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
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

export async function POST(request: Request) {
  if (!relayEnabled()) return Response.json({ error: '媒体中转服务未启用' }, { status: 404 });
  if (!uploadTokenMatches(request)) return Response.json({ error: '上传授权无效' }, { status: 401 });
  const rate = consumeRateLimit(clientKey(request));
  if (!rate.allowed) return Response.json({ error: `上传过于频繁，请约 ${rate.retryAfterSeconds} 秒后重试` }, { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } });
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) return Response.json({ error: '图片不能超过 4 MiB' }, { status: 413 });

  try {
    const form = await request.formData();
    const file = form.get('file');
    const kind = String(form.get('kind') || 'image');
    if (kind !== 'image' || !(file instanceof File)) return Response.json({ error: '当前中转服务只接收图片' }, { status: 415 });
    if (file.size > MAX_IMAGE_BYTES) return Response.json({ error: '图片不能超过 4 MiB' }, { status: 413 });
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return Response.json({ error: '图片不能超过 4 MiB' }, { status: 413 });
    const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
    const mime = detectedMime(metadata.format);
    if (!mime) return Response.json({ error: '只支持 JPG、PNG、WebP 或 GIF 图片' }, { status: 415 });
    const stored = await storeSignedMedia(bytes, mime, 'image', { ttlMs: PUBLIC_MEDIA_TTL_MS, pathPrefix: '/api/relay/media' });
    return Response.json({ ok: true, url: stored.url, expiresAt: new Date(stored.expiresAt).toISOString(), bytes: stored.bytes }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '图片中转失败' }, { status: 400 });
  }
}
