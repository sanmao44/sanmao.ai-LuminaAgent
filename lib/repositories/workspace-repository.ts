'use client';

import {
  bootstrapWorkspace,
  collectWorkspaceSnapshot,
  restoreWorkspaceSnapshot,
} from '../workspace';
import type { WorkspaceRepository } from './types';

/**
 * Client storage is deliberately hidden behind this boundary. The current
 * implementation still uses IndexedDB/localStorage plus /api/workspace; a
 * future SQLite or native adapter does not change callers.
 */
export const workspaceRepository: WorkspaceRepository = {
  bootstrap: bootstrapWorkspace,
  collect: collectWorkspaceSnapshot,
  restore: restoreWorkspaceSnapshot,
};
