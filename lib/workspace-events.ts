export const WORKSPACE_CHANGE_EVENT = 'sanmao-workspace-change';

let workspaceRestoreDepth = 0;
let workspaceAsyncRestoreDepth = 0;
let workspaceMutationGeneration = 0;
const workspaceDrafts = new Set<symbol>();
const defaultWorkspaceDraft = Symbol('workspace-draft');

export function getWorkspaceMutationGeneration() {
  return workspaceMutationGeneration;
}

export function hasWorkspaceDraftPending() {
  return workspaceDrafts.size > 0;
}

/** Signal an actual local edit, including edits not yet written by autosave. */
export function emitWorkspaceMutation() {
  if (typeof window === 'undefined' || workspaceRestoreDepth > 0) return;
  workspaceMutationGeneration += 1;
  window.dispatchEvent(new Event(WORKSPACE_CHANGE_EVENT));
}

/** Core subscribers set true on each edit; autosave clears only after success. */
export function setWorkspaceDraftPending(pending: boolean, owner = defaultWorkspaceDraft) {
  if (typeof window === 'undefined' || workspaceRestoreDepth > 0) return;
  if (!pending && !workspaceDrafts.has(owner)) return;
  if (pending) workspaceDrafts.add(owner);
  else workspaceDrafts.delete(owner);
  emitWorkspaceMutation();
}

/** Each mounted editor clears only its own successfully persisted draft. */
export function registerWorkspaceDraft() {
  const owner = Symbol('workspace-draft');
  let disposed = false;
  return {
    markDirty: () => { if (!disposed) setWorkspaceDraftPending(true, owner); },
    markSaved: () => { if (!disposed) setWorkspaceDraftPending(false, owner); },
    dispose: () => {
      if (disposed) return;
      setWorkspaceDraftPending(false, owner);
      disposed = true;
    },
  };
}

export function emitWorkspaceChange() {
  if (workspaceAsyncRestoreDepth > 0) return;
  emitWorkspaceMutation();
}

export function isWorkspaceRestoreInProgress() {
  // Only synchronous replacement is hydration. User edits while repository
  // restores await I/O must still reach emitWorkspaceMutation / draft tracking.
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
  workspaceAsyncRestoreDepth += 1;
  try {
    return await operation();
  } finally {
    workspaceAsyncRestoreDepth = Math.max(0, workspaceAsyncRestoreDepth - 1);
  }
}
