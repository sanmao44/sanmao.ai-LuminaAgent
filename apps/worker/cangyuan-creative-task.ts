import type { Cangyuan3DOptions, CangyuanMediaKind, CangyuanMediaTask, CangyuanMusicOptions } from '../../packages/contracts/cangyuan-media';
import { createCangyuanCreativeTask as createServiceTask, getCangyuanCreativeTask as getServiceTask, listCangyuanCreativeTasks as listServiceTasks } from '../../lib/cangyuan-media-task-service';
import { runTaskLifecycle } from './task-lifecycle';

type CreateOptions =
  | { kind: 'music'; modelId: string; idempotencyKey?: string; input: { prompt?: string } & CangyuanMusicOptions }
  | { kind: '3d'; modelId: string; idempotencyKey?: string; input: { prompt: string } & Cangyuan3DOptions };

export function createCangyuanCreativeGeneration(options: CreateOptions) {
  return runTaskLifecycle(options.kind, options.idempotencyKey || 'request', () => createServiceTask(options));
}

export async function getCangyuanCreativeGeneration(id: string, kind: CangyuanMediaKind, refresh = true) {
  return runTaskLifecycle(kind, id, async () => {
    const task = await getServiceTask(id, refresh);
    return task?.kind === kind ? task : null;
  });
}

export async function listCangyuanCreativeGenerations(kind: CangyuanMediaKind, limit = 50): Promise<CangyuanMediaTask[]> {
  return runTaskLifecycle(kind, 'list', () => listServiceTasks(kind, limit));
}
