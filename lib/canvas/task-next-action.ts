import type { GenerationLog } from '@/lib/generation-log';
import { generationLogDisplayStatus, generationLogKind } from './activity-log';
import { restorableCanvasTaskLogs } from './task-context-recovery';

export type CanvasTaskNextAction = {
  kind: 'check' | 'restore' | 'running' | 'ready';
  count: number;
  filter: 'pending' | 'error' | 'recoverable' | null;
  title: string;
  detail: string;
  buttonLabel: string;
};

/** Summarize the most useful next step without changing task ownership or state. */
export function deriveCanvasTaskNextAction(logs: readonly GenerationLog[]): CanvasTaskNextAction {
  const unconfirmedLogs = logs.filter((log) =>
    generationLogDisplayStatus(log) === 'pending'
    && log.errorCode === 'provider_result_unconfirmed',
  );
  const needsCheck = unconfirmedLogs.length;
  if (needsCheck) {
    const hasAudio = unconfirmedLogs.some((log) => generationLogKind(log) === 'audio');
    return {
      kind: 'check',
      count: needsCheck,
      filter: 'pending',
      title: `有 ${needsCheck} 个结果待核对`,
      detail: hasAudio
        ? '服务商可能已接收配音请求；先检查音频节点和记录，再决定是否重试。'
        : '只读取原任务记录，确认前不会重复提交。',
      buttonLabel: '查看待确认',
    };
  }

  const restorable = restorableCanvasTaskLogs(logs).length;
  if (restorable) {
    return {
      kind: 'restore',
      count: restorable,
      filter: 'recoverable',
      title: `有 ${restorable} 个失败任务可恢复`,
      detail: '带回已保存参数成为可编辑草稿，检查后再提交。',
      buttonLabel: '查看可恢复',
    };
  }

  const running = logs.filter((log) => log.status === 'pending').length;
  if (running) {
    return {
      kind: 'running',
      count: running,
      filter: 'pending',
      title: `${running} 个任务在后台处理中`,
      detail: '可以继续编辑画布，结果完成后会自动归档。',
      buttonLabel: '查看进行中',
    };
  }

  return {
    kind: 'ready',
    count: 0,
    filter: null,
    title: '任务链路已就绪',
    detail: '没有需要处理的异常任务。',
    buttonLabel: '查看全部',
  };
}
