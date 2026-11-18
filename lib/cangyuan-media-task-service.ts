import { randomUUID } from 'node:crypto';
import type { TaskRepository } from './repositories/types';
import { validateCangyuan3DInput, validateCangyuanMusicInput, type Cangyuan3DOptions, type CangyuanMediaKind, type CangyuanMediaTask, type CangyuanMediaTaskInput, type CangyuanMediaTaskStatus, type CangyuanMusicOptions } from '../packages/contracts/cangyuan-media';
import { cangyuanMediaBaseUrl } from './cangyuan-provider';
import { authHeaders, runtimeBaseUrl, type RuntimeProvider } from './providers';
import { getProviderWithKey, getRuntimeModel } from './store';
import { cangyuanCreativeTaskRepository } from './cangyuan-media-task-store';
import { buildCangyuanThreeDPayload, isRetryableCangyuanProviderError, pollCangyuanMediaTask, submitCangyuanMediaTask, type CangyuanMediaClient, type CangyuanProviderTask } from './cangyuan-media-provider';
import { cangyuanMediaTaskPollIntervalMs } from './cangyuan-media-task-polling';

export type CreateCangyuanCreativeTaskInput =
  | { kind: 'music'; modelId: string; input: { prompt?: string } & CangyuanMusicOptions; idempotencyKey?: string }
  | { kind: '3d'; modelId: string; input: { prompt?: string } & Cangyuan3DOptions; idempotencyKey?: string };

type CangyuanMediaTaskRepository = Pick<TaskRepository<CangyuanMediaTask>, 'find' | 'findByIdempotencyKey' | 'insert' | 'page' | 'mutate'>;
type CangyuanResolvedModel = NonNullable<Awaited<ReturnType<typeof getRuntimeModel>>>;
type CangyuanResolvedProvider = NonNullable<Awaited<ReturnType<typeof getProviderWithKey>>>;

export type CangyuanMediaTaskServiceDependencies = {
  repository: CangyuanMediaTaskRepository;
  resolveModel: typeof getRuntimeModel;
  resolveProvider: typeof getProviderWithKey;
  createClient: (provider: RuntimeProvider) => CangyuanMediaClient;
  provider: {
    buildThreeDPayload: typeof buildCangyuanThreeDPayload;
    submit: typeof submitCangyuanMediaTask;
    poll: typeof pollCangyuanMediaTask;
    isRetryable: typeof isRetryableCangyuanProviderError;
  };
  now?: () => number;
  newId?: () => string;
};

export function createCangyuanMediaTaskService(dependencies: CangyuanMediaTaskServiceDependencies) {
  const refreshing = new Map<string, Promise<CangyuanMediaTask | null>>();
  const now = dependencies.now || Date.now;
  const newId = dependencies.newId || randomUUID;

  async function create(options: CreateCangyuanCreativeTaskInput): Promise<CangyuanMediaTask> {
    const modelKind = options.kind === 'music' ? 'audio' : '3d';
    const runtime = await dependencies.resolveModel(options.modelId, modelKind);
    if (!runtime) throw new Error('请选择已启用的音乐或三维模型');
    if (runtime.provider.type !== 'openai-compatible') throw new Error('请选择兼容接口的服务商模型');
    if (runtime.provider.creativeTaskProtocol !== 'cangyuan-creative-v1') throw new Error('请为服务商启用音乐与三维任务接口，再选择模型');
    const requiredCapability = options.kind === 'music' ? 'music-generate' : '3d-generate';
    if (!runtime.model.capabilities.includes(requiredCapability)) {
      throw new Error(`所选模型不支持${options.kind === 'music' ? '音乐' : '三维'}生成能力`);
    }

    const idempotencyKey = `cangyuan:${options.kind}:${runtime.provider.id}:${options.idempotencyKey?.trim() || newId()}`;
    const existing = await dependencies.repository.findByIdempotencyKey(idempotencyKey);
    if (existing) return existing;

    const common = {
      id: newId(),
      providerId: runtime.provider.id,
      providerModel: runtime.model.rawId,
      modelId: runtime.model.id,
      modelName: runtime.model.displayName,
      status: 'pending' as const,
      outputs: [],
      idempotencyKey,
      createdAt: new Date(now()).toISOString(),
      pollCount: 0,
    };

    let task: CangyuanMediaTask;
    let input: CangyuanMediaTaskInput;
    if (options.kind === 'music') {
      input = validateCangyuanMusicInput(runtime.model.rawId, options.input);
      task = { ...common, kind: 'music', input };
    } else {
      const threeInput = validate3DInput(runtime.model.rawId, options.input);
      input = threeInput;
      dependencies.provider.buildThreeDPayload(runtime.model.rawId, threeInput);
      task = { ...common, kind: '3d', input: threeInput };
    }

    const inserted = await dependencies.repository.insert(task);
    if (!inserted.created) return inserted.task;

    try {
      const result = await dependencies.provider.submit(
        dependencies.createClient(runtime.provider),
        options.kind,
        runtime.model.rawId,
        input,
      );
      return await applySubmissionResult(task, result, updateActive, now) || task;
    } catch (error) {
      const uncertain = dependencies.provider.isRetryable(error);
      return await updateActive(task.id, {
        status: 'failed',
        error: uncertain
          ? '提交结果未能确认，服务商可能已接收并计费。请先核对任务状态，再决定是否重新提交。'
          : errorMessage(error),
        submissionUncertain: uncertain,
        completedAt: new Date(now()).toISOString(),
      }) || task;
    }
  }

  async function get(id: string, refresh = true): Promise<CangyuanMediaTask | null> {
    const task = await dependencies.repository.find(id);
    if (!task || !refresh || !isActive(task.status)) return task;
    if (task.nextPollAt && task.nextPollAt > now()) return task;
    const inFlight = refreshing.get(id);
    if (inFlight) return inFlight;
    const operation = refreshTask(task).finally(() => refreshing.delete(id));
    refreshing.set(id, operation);
    return operation;
  }

  async function list(kind: CangyuanMediaKind, limit = 50): Promise<CangyuanMediaTask[]> {
    const page = await dependencies.repository.page({
      page: 1,
      pageSize: Math.max(1, Math.min(100, Math.round(limit))),
      maxPageSize: 100,
      matches: (task) => task.kind === kind,
    });
    return [...page.tasks];
  }

  async function updateActive(id: string, patch: Partial<CangyuanMediaTask>) {
    const updated = await dependencies.repository.mutate((tasks) => {
      const index = tasks.findIndex((item) => item.id === id);
      if (index < 0 || !isActive(tasks[index].status)) return null;
      Object.assign(tasks[index], patch, { id });
      return tasks[index];
    });
    return updated || await dependencies.repository.find(id);
  }

  async function refreshTask(task: CangyuanMediaTask): Promise<CangyuanMediaTask | null> {
    if (!task.providerTaskId) return task;
    const provider = await dependencies.resolveProvider(task.providerId);
    if (!provider || provider.type !== 'openai-compatible' || provider.creativeTaskProtocol !== 'cangyuan-creative-v1') {
      return updateActive(task.id, { status: 'failed', error: '任务对应的服务商配置已删除或音乐与三维任务接口已停用', completedAt: new Date(now()).toISOString() });
    }
    try {
      const result = await dependencies.provider.poll(dependencies.createClient(provider), task.kind, task.providerTaskId);
      const missingOutput = result.status === 'succeeded' && !result.outputs.some((output) => Boolean(output.url || output.text));
      const status = missingOutput ? 'failed' : result.status;
      return updateActive(task.id, {
        status,
        providerStatus: result.providerStatus,
        outputs: result.outputs.length ? withThreeDOutputFormats(task, result.outputs) : task.outputs,
        pollCount: task.pollCount + 1,
        ...(status === 'running' && !task.startedAt ? { startedAt: new Date(now()).toISOString() } : {}),
        ...(status === 'succeeded' || status === 'failed' ? { completedAt: new Date(now()).toISOString() } : {}),
        ...(status === 'failed' ? { error: missingOutput ? '服务商已完成任务，但没有返回可用的媒体下载地址' : result.error } : { error: undefined }),
        nextPollAt: isActive(status) ? now() + cangyuanMediaTaskPollIntervalMs(task.kind) : undefined,
      });
    } catch (error) {
      if (!dependencies.provider.isRetryable(error)) {
        return updateActive(task.id, { status: 'failed', error: errorMessage(error), completedAt: new Date(now()).toISOString() });
      }
      const pollCount = task.pollCount + 1;
      const backoff = Math.min(60_000, cangyuanMediaTaskPollIntervalMs(task.kind) * 2 ** Math.min(4, Math.max(0, pollCount - 1)));
      return updateActive(task.id, { pollCount, nextPollAt: now() + backoff });
    }
  }

  return { create, get, list };
}

const defaultService = createCangyuanMediaTaskService({
  repository: cangyuanCreativeTaskRepository,
  resolveModel: getRuntimeModel,
  resolveProvider: getProviderWithKey,
  createClient: (provider) => ({ baseUrl: cangyuanMediaBaseUrl(provider) || runtimeBaseUrl(provider), headers: authHeaders(provider) }),
  provider: {
    buildThreeDPayload: buildCangyuanThreeDPayload,
    submit: submitCangyuanMediaTask,
    poll: pollCangyuanMediaTask,
    isRetryable: isRetryableCangyuanProviderError,
  },
});

export const createCangyuanCreativeTask = defaultService.create;
export const getCangyuanCreativeTask = defaultService.get;
export const listCangyuanCreativeTasks = defaultService.list;

async function applySubmissionResult(
  task: CangyuanMediaTask,
  result: CangyuanProviderTask,
  updateActive: (id: string, patch: Partial<CangyuanMediaTask>) => Promise<CangyuanMediaTask | null>,
  now: () => number,
) {
  const missingOutput = result.status === 'succeeded' && !result.outputs.some((output) => Boolean(output.url || output.text));
  const missingTaskId = !result.id && (result.status === 'pending' || result.status === 'running');
  const status = missingOutput || missingTaskId ? 'failed' : result.status;
  return updateActive(task.id, {
    providerTaskId: result.id,
    providerStatus: result.providerStatus,
    outputs: withThreeDOutputFormats(task, result.outputs),
    status,
    ...(status === 'running' || status === 'succeeded' ? { startedAt: new Date(now()).toISOString() } : {}),
    ...(status === 'succeeded' || status === 'failed' ? { completedAt: new Date(now()).toISOString() } : {}),
    ...(status === 'failed' ? { error: missingOutput ? '服务商已完成任务，但没有返回可用的媒体下载地址' : missingTaskId ? '服务商响应未提供任务编号。请先核对任务状态，再决定是否重试。' : result.error } : {}),
    ...(missingTaskId ? { submissionUncertain: true } : {}),
    nextPollAt: status === 'pending' || status === 'running' ? now() + cangyuanMediaTaskPollIntervalMs(task.kind) : undefined,
  });
}

function validate3DInput(modelId: string, input: { prompt?: string } & Cangyuan3DOptions) {
  return validateCangyuan3DInput(modelId, input);
}

function withThreeDOutputFormats(task: CangyuanMediaTask, outputs: CangyuanMediaTask['outputs']) {
  if (task.kind !== '3d') return outputs;
  const isQuad = task.input.quad === true;
  return outputs.map((output) => ({
    ...output,
    artifactType: isQuad ? 'fbx' as const : output.artifactType || 'glb' as const,
  }));
}

function isActive(status: CangyuanMediaTaskStatus) {
  return status === 'pending' || status === 'running';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '媒体任务处理失败';
}
