import { canvasGenerationLogRecoveryStatus, recoverCanvasTask } from './task-recovery';
import type { CanvasDocument, CanvasNodeParams } from './types';

export type CanvasTaskRecordSnapshot = {
  status?: string;
  errorCode?: string;
  error?: string;
  imageUrls?: readonly unknown[];
};

export type CanvasTaskRecordRecoveryResult =
  | { kind: 'recovered'; imageCount: number }
  | { kind: 'pending' }
  | { kind: 'missing_output' }
  | { kind: 'terminal' }
  | { kind: 'save_failed'; taskState: 'recovered' | 'pending' }
  | { kind: 'stale' };

export async function applyCanvasTaskRecordRecovery(input: {
  record: CanvasTaskRecordSnapshot;
  nodeId: string;
  taskId: string;
  imageParams: CanvasNodeParams;
  updateDocument(updater: (document: CanvasDocument) => CanvasDocument): boolean | void | Promise<boolean | void>;
  waitForPersistence?: () => Promise<boolean>;
  queueCheckpoint(): void;
}): Promise<CanvasTaskRecordRecoveryResult> {
  const urls = [...new Set((input.record.imageUrls || [])
    .map((url) => String(url || '').trim())
    .filter(Boolean))];
  const status = urls.length ? 'success' : canvasGenerationLogRecoveryStatus(input.record);

  if (input.record.status === 'success' && !urls.length) return { kind: 'missing_output' };
  if (status !== 'success' && status !== 'pending') return { kind: 'terminal' };

  let changed = false;
  const saved = await input.updateDocument((document) => {
    const next = recoverCanvasTask(document, {
      nodeId: input.nodeId,
      taskId: input.taskId,
      status,
      urls,
      error: input.record.error,
      imageParams: input.imageParams,
    });
    changed = next !== document;
    return next;
  });
  const persisted = input.waitForPersistence ? await input.waitForPersistence() : true;
  if (!persisted) return { kind: 'save_failed', taskState: status === 'success' ? 'recovered' : 'pending' };
  if (saved === false) return { kind: 'save_failed', taskState: status === 'success' ? 'recovered' : 'pending' };
  if (!changed) return { kind: 'stale' };

  if (status === 'success') {
    input.queueCheckpoint();
    return { kind: 'recovered', imageCount: urls.length };
  }
  return { kind: 'pending' };
}
