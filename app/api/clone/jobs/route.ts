import { isTrustedAppRequest } from '@/lib/auth';
import { OFFLINE_SPEECH_LABEL, offlineSpeechSupported } from '@/lib/clone/offline-speech';
import { decideCapabilities, normalizeCloneOptions } from '@/lib/clone/plan';
import { reapStaleCloneJobs, runCloneJob } from '@/lib/clone/pipeline';
import { cloneJobSummary, createCloneJob, listCloneJobs } from '@/lib/clone/store';
import type { CloneReference } from '@/lib/clone/types';
import { getRuntimeImageGenerationModel, getRuntimeVideoModel, getRuntimeVisionModel } from '@/lib/store';
import { resolveSpeechRuntime } from '@/lib/clone/speech';
import { beginRuntimeRequest, RuntimeDrainingError } from '@/lib/runtime-operation';

export const runtime = 'nodejs';
export const maxDuration = 3600;

/** 取用户显式选择的模型 id；「自动」和空值都不写，交给执行层按默认挑。 */
function readModelId(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text !== 'auto' ? text : undefined;
}

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
  // 画布每 5 秒拉一次这个列表：顺手把中断的任务标成失败，用户才有「继续任务」可点。
  await reapStaleCloneJobs();
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
      // 拆解要真的看图：没显式选模型时优先带 vision 的对话模型，否则画面拆解会无谓降级。
      getRuntimeVisionModel(body.chatModel || null),
      getRuntimeImageGenerationModel(body.imageModel || null),
      getRuntimeVideoModel(body.videoModel || null),
      resolveSpeechRuntime(body.speechModel || null),
    ]);
    const { capabilities, warnings } = decideCapabilities({
      hasVisionModel: Boolean(chatRuntime?.model.capabilities.includes('vision')),
      hasSpeechModel: Boolean(speechRuntime),
      hasImageModel: Boolean(imageRuntime),
      hasVideoModel: Boolean(videoRuntime),
      offlineSpeech: offlineSpeechSupported(),
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
        // 走离线兜底时没有模型名，用标签顶上，用户在任务详情里能看出这次是本地合成的。
        speech: speechRuntime?.model.displayName || (capabilities.offlineSpeech ? OFFLINE_SPEECH_LABEL : undefined),
      },
      // 只存展示名不够：管线要按用户选的模型执行，否则高级设置形同虚设。
      modelIds: {
        chat: readModelId(body.chatModel),
        image: readModelId(body.imageModel),
        video: readModelId(body.videoModel),
        speech: readModelId(body.speechModel),
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
