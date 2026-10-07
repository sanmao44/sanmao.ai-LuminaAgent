export const WORKSPACE_CHANGE_EVENT = 'sanmao-workspace-change';

let workspaceRestoreDepth = 0;

export function emitWorkspaceChange() {
  if (typeof window === 'undefined' || workspaceRestoreDepth > 0) return;
  window.dispatchEvent(new Event(WORKSPACE_CHANGE_EVENT));
}

export function isWorkspaceRestoreInProgress() {
  return workspaceRestoreDepth > 0;
}

export function withWorkspaceRestoreSuppressed<T>(operation: () => T): T {
  workspaceRestoreDepth += 1;
  try {
    return operation();
  } finally {
    workspaceRestoreDepth = Math.max(0, workspaceRestoreDepth - 1);
  }
}

export async function withWorkspaceRestoreSuppressedAsync<T>(operation: () => Promise<T>): Promise<T> {
  workspaceRestoreDepth += 1;
  try {
    return await operation();
  } finally {
    workspaceRestoreDepth = Math.max(0, workspaceRestoreDepth - 1);
  }
}
