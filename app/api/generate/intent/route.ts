import type {
  CanvasImageIntentPreviewRequest,
  CanvasImageIntentPreview,
} from '@/packages/contracts/creative';
import { resolveCanvasImageRequestIntent } from '@/apps/api/image-intent-composition';
import { isTrustedAppRequest } from '@/lib/auth';
import { MAX_IMAGE_REFERENCES } from '@/packages/contracts/creative';

export const runtime = 'nodejs';

function requestBody(value: unknown): CanvasImageIntentPreviewRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    typeof body.prompt !== 'string' ||
    !Number.isInteger(body.imageReferenceCount) ||
    Number(body.imageReferenceCount) < 0 ||
    Number(body.imageReferenceCount) > MAX_IMAGE_REFERENCES ||
    typeof body.hasMask !== 'boolean'
  ) return null;
  return {
    prompt: body.prompt,
    imageReferenceCount: Number(body.imageReferenceCount),
    hasMask: body.hasMask,
  };
}

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) {
    return Response.json({ error: '请先登录后再继续。' }, { status: 401 });
  }
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: '图片意图预检请求格式无效。' }, { status: 400 });
  }
  const body = requestBody(rawBody);
  if (!body) {
    return Response.json({ error: '图片意图预检参数无效，请检查提示词和参考素材。' }, { status: 400 });
  }

  const resolution = await resolveCanvasImageRequestIntent({
    requestedMode: 'auto',
    isCanvasRequest: true,
    ...body,
    signal: request.signal,
  });
  const preview: CanvasImageIntentPreview = {
    operation: resolution.operation,
    ...(resolution.classifierStatus ? { classifierStatus: resolution.classifierStatus } : {}),
    ...(resolution.classifierModelId ? { classifierModelId: resolution.classifierModelId } : {}),
    ...(resolution.classifierMs !== undefined ? { classifierMs: resolution.classifierMs } : {}),
  };
  return Response.json(preview, { headers: { 'Cache-Control': 'no-store' } });
}
