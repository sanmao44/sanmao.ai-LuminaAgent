export type TaskResultOutcome = 'success' | 'failure';

export type TaskResultRecord = Readonly<{
  id?: unknown;
  taskId?: unknown;
  status?: unknown;
  errorCode?: unknown;
  cancelled?: unknown;
}>;

/** Convert persisted and legacy task statuses into the two audible outcomes. */
export function taskResultOutcome(record: TaskResultRecord): TaskResultOutcome | null {
  const status = String(record.status || '').trim().toLowerCase();
  if (status === 'success' || status === 'succeeded' || status === 'done') return 'success';
  if (status === 'error' || status === 'failed') {
    const errorCode = String(record.errorCode || '').trim().toLowerCase();
    if (record.cancelled === true || errorCode === 'cancelled' || errorCode === 'canceled') return null;
    return 'failure';
  }
  return null;
}

/** Build the current terminal-result snapshot, keyed by the stable task id. */
export function taskResultOutcomes(records: readonly TaskResultRecord[]) {
  const outcomes = new Map<string, TaskResultOutcome>();
  for (const record of records) {
    const id = String(record.id ?? record.taskId ?? '').trim();
    const outcome = taskResultOutcome(record);
    if (id && outcome) outcomes.set(id, outcome);
  }
  return outcomes;
}

/** Return only terminal results that changed since the previous snapshot. */
export function changedTaskResultOutcomes(
  previous: ReadonlyMap<string, TaskResultOutcome>,
  current: ReadonlyMap<string, TaskResultOutcome>,
) {
  return [...current.entries()]
    .filter(([id, outcome]) => previous.get(id) !== outcome)
    .map(([id, outcome]) => ({ id, outcome }));
}
