import { startTaskReconciler } from './apps/worker/task-reconciler';

export function register() {
  startTaskReconciler();
}
