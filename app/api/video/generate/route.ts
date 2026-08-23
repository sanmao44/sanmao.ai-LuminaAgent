import { isTrustedAppRequest } from '@/lib/auth';
import { createVideoGeneration } from '@/lib/video-task-service';
import type { VideoGenerationInput } from '@/lib/types';
import { normalizeGenerationSource } from '@/lib/generation-source';

export const runtime = 'nodejs';
export const maxDuration = 1800;

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  try {
    const body = await request.json();
    const raw = body.input && typeof body.input === 'object' ? body.input : body;
    const input: VideoGenerationInput = {
      prompt: String(raw.prompt || ''),
      operation: raw.operation,
      seconds: raw.seconds,
      aspectRatio: raw.aspectRatio || raw.aspect_ratio,
      resolution: raw.resolution,
      firstFrame: raw.firstFrame || raw.first_frame,
      lastFrame: raw.lastFrame || raw.last_frame,
      referenceImages: raw.referenceImages || raw.reference_image_urls,
      referenceVideos: raw.referenceVideos || raw.reference_videos,
      referenceVideo: raw.referenceVideo || raw.video,
      audios: raw.audios || raw.audio_urls,
      audio: raw.audio,
    };
    const key = request.headers.get('Idempotency-Key') || String(body.idempotencyKey || '');
    const task = await createVideoGeneration({ modelId: String(body.model || 'auto'), input, idempotencyKey: key, source: normalizeGenerationSource(body.source, 'workspace') });
    return Response.json({ ok: true, task }, { status: task?.status === 'failed' ? 502 : 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '视频生成失败' }, { status: 400 });
  }
}
