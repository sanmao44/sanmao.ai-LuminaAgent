export function workspaceTopbarModes(section: string) {
  return {
    imageActive: section === 'generate' || section === 'angle',
    videoActive: section === 'video',
    agentActive: section === 'agent',
  };
}

export type WorkspaceTaskSummary = {
  total: number;
  pending: number;
  error: number;
};

export type WorkspaceSyncIndicatorStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'conflict';

export function workspaceTaskSummaryLabel(summary: WorkspaceTaskSummary) {
  if (summary.error > 0) return `${summary.error} 项需处理`;
  if (summary.pending > 0) return `${summary.pending} 项进行中`;
  if (summary.total > 0) return `${summary.total} 项已完成`;
  return '暂无任务';
}

export function workspaceTaskSummaryTone(summary: WorkspaceTaskSummary) {
  if (summary.error > 0) return 'attention';
  if (summary.pending > 0) return 'working';
  return 'ready';
}

export function workspaceTopbarStatusTone(summary: WorkspaceTaskSummary, syncStatus: WorkspaceSyncIndicatorStatus) {
  if (syncStatus === 'offline' || syncStatus === 'error' || syncStatus === 'conflict') return 'attention';
  if (syncStatus === 'syncing') return 'working';
  return workspaceTaskSummaryTone(summary);
}
