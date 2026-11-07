export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startTaskReconciler } = await import('./apps/worker/task-reconciler');
  startTaskReconciler();
}
