import { isTrustedAppRequest } from '@/lib/auth';
import { createVideoGeneration } from '@/lib/video-task-service';
import type { VideoGenerationInput } from '@/lib/types';
import { normalizeGenerationSource } from '@/lib/generation-source';
import { beginRuntimeRequest, RuntimeDrainingError } from '@/lib/runtime-operation';

export const runtime = 'nodejs';
export const maxDuration = 1800;

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  let releaseRuntimeRequest = async () => {};
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('video-generate');
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
      videoMode: raw.videoMode || raw.mode,
      width: raw.width,
      height: raw.height,
      numFrames: raw.numFrames ?? raw.num_frames,
      frameRate: raw.frameRate ?? raw.frame_rate,
      videoSize: raw.videoSize ?? raw.size,
      referenceVideoStartSeconds: raw.referenceVideoStartSeconds ?? raw.start_seconds,
      referenceVideoEndSeconds: raw.referenceVideoEndSeconds ?? raw.end_seconds,
      requireAudio: raw.requireAudio ?? raw.require_audio,
    };
    const key = request.headers.get('Idempotency-Key') || String(body.idempotencyKey || '');
    const task = await createVideoGeneration({ modelId: String(body.model || 'auto'), input, idempotencyKey: key, source: normalizeGenerationSource(body.source, 'workspace') });
    return Response.json({ ok: true, task }, { status: task?.status === 'failed' ? 502 : 202 });
  } catch (error) {
    if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message, retryable: true }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : '视频生成失败' }, { status: 400 });
  } finally {
    await releaseRuntimeRequest();
  }
}
