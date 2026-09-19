import { isTrustedAppRequest } from '@/lib/auth';
import { decideCapabilities, normalizeCloneOptions } from '@/lib/clone/plan';
import { runCloneJob } from '@/lib/clone/pipeline';
import { cloneJobSummary, createCloneJob, listCloneJobs } from '@/lib/clone/store';
import type { CloneReference } from '@/lib/clone/types';
import { getRuntimeImageGenerationModel, getRuntimeModel, getRuntimeVideoModel } from '@/lib/store';
import { resolveSpeechRuntime } from '@/lib/clone/speech';
import { beginRuntimeRequest, RuntimeDrainingError } from '@/lib/runtime-operation';

export const runtime = 'nodejs';
export const maxDuration = 3600;

function readReference(raw: unknown): CloneReference {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const url = String(source.url || '').trim();
  if (!url) throw new Error('请先选择一条参考视频。');
  return {
    ...(source.nodeId ? { nodeId: String(source.nodeId) } : {}),
    name: String(source.name || '参考视频').slice(0, 80),
    url,
    seconds: Math.max(0, Number(source.seconds) || 0),
  };
}

export async function GET(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const jobs = await listCloneJobs(30);
  return Response.json({ ok: true, jobs: jobs.map(cloneJobSummary) });
}

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  let releaseRuntimeRequest = async () => {};
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('clone');
    const body = await request.json();
    const reference = readReference(body.reference);
    const options = normalizeCloneOptions({ ...(body.options || {}), brief: body.brief ?? body.options?.brief });
    const [chatRuntime, imageRuntime, videoRuntime, speechRuntime] = await Promise.all([
      getRuntimeModel(body.chatModel || null, 'chat'),
      getRuntimeImageGenerationModel(body.imageModel || null),
      getRuntimeVideoModel(body.videoModel || null),
      resolveSpeechRuntime(body.speechModel || null),
    ]);
    const { capabilities, warnings } = decideCapabilities({
      hasVisionModel: Boolean(chatRuntime?.model.capabilities.includes('vision')),
      hasSpeechModel: Boolean(speechRuntime),
      hasImageModel: Boolean(imageRuntime),
      hasVideoModel: Boolean(videoRuntime),
    });
    if (!imageRuntime) {
      return Response.json({ error: '没有可用的生图模型：请先在「模型库」启用一个生图模型，再回来一键出片。' }, { status: 400 });
    }
    const requestedSpeech = typeof body.speechModel === 'string' ? body.speechModel.trim() : '';
    if (requestedSpeech && requestedSpeech !== 'auto' && !speechRuntime) {
      return Response.json({ error: '指定的配音模型不可用：请在「模型库」把它归类为「配音」并启用，或改用自动选择。' }, { status: 400 });
    }
    const created = await createCloneJob({
      reference,
      options,
      capabilities,
      warnings,
      models: {
        chat: chatRuntime?.model.displayName || '',
        image: imageRuntime.model.displayName,
        video: videoRuntime?.model.displayName,
        speech: speechRuntime?.model.displayName,
      },
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim().slice(0, 80) : undefined,
    });
    // 后台跑，立刻把任务交给前端轮询；与生成任务的持久化后台写法一致。
    void runCloneJob(created.task.id).catch(() => undefined);
    return Response.json({ ok: true, job: created.task, capabilities, warnings }, { status: created.created ? 202 : 200 });
  } catch (error) {
    if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message, retryable: true }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : '创建克隆任务失败。' }, { status: 400 });
  } finally {
    await releaseRuntimeRequest();
  }
}
