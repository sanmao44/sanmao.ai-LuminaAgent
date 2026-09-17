export const GENERATE_TASKS_STORAGE_KEY = 'sanmao-generate-tasks';
export const GENERATE_TASKS_STORAGE_LIMIT = 12;
/** 生成任务历史占用 localStorage 的字符预算，避免挤占画布等其它数据的保存空间。 */
export const GENERATE_TASKS_STORAGE_BUDGET = 1200000;
/** 单个任务的参考图超过该字符数时不再写入存储。 */
export const GENERATE_TASK_REFERENCE_BUDGET = 2500000;

type UnknownRecord = Record<string, unknown>;

type StorageTarget = {
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function referenceChars(task: UnknownRecord) {
  const request = isRecord(task.request) ? task.request : null;
  if (!request) return 0;
  const references = Array.isArray(request.references) ? request.references : [];
  const referenceTotal = references.reduce<number>((total, item) => total + (isRecord(item) && typeof item.dataUrl === 'string' ? item.dataUrl.length : 0), 0);
  const mask = isRecord(request.mask) && typeof request.mask.dataUrl === 'string' ? request.mask.dataUrl.length : 0;
  return referenceTotal + mask;
}

function compactTask(task: unknown, keepReferences: boolean) {
  const source = isRecord(task) ? task : {};
  const itemIds = Array.isArray(source.itemIds) && source.itemIds.length
    ? source.itemIds
    : (Array.isArray(source.items) ? source.items.map((item) => (isRecord(item) ? item.id : undefined)).filter((id) => id !== undefined) : []);
  let request = isRecord(source.request) ? { ...source.request } : undefined;
  if (request && (!keepReferences || referenceChars(source) > GENERATE_TASK_REFERENCE_BUDGET)) {
    request = { ...request, references: [], mask: null, referencesOmitted: true };
  }
  return { ...source, items: [], itemIds, request };
}

/** 序列化生成任务历史，用于写入 localStorage 前的体积判断。 */
export function generateTasksStoragePayload(tasks: readonly unknown[], limit = GENERATE_TASKS_STORAGE_LIMIT, referenceTasks = GENERATE_TASKS_STORAGE_LIMIT) {
  return JSON.stringify(tasks.slice(0, limit).map((task, index) => compactTask(task, index < referenceTasks)));
}

/**
 * 按保真度从高到低尝试写入生成任务历史：先只给最近的任务保留参考图，再丢弃全部参考图，最后减少保留条数。
 * 全部候选都放不下时清空该键，避免它占满 localStorage 让画布无法保存。
 */
export function persistGenerateTasks(tasks: readonly unknown[], storage?: StorageTarget | null) {
  const target = storage ?? (typeof window === 'undefined' ? null : window.localStorage);
  if (!target) return false;
  const candidates: Array<[number, number]> = [
    [GENERATE_TASKS_STORAGE_LIMIT, GENERATE_TASKS_STORAGE_LIMIT],
    [GENERATE_TASKS_STORAGE_LIMIT, 2],
    [GENERATE_TASKS_STORAGE_LIMIT, 1],
    [GENERATE_TASKS_STORAGE_LIMIT, 0],
    [6, 0],
    [3, 0],
    [1, 0],
  ];
  for (let index = 0; index < candidates.length; index += 1) {
    const [limit, referenceTasks] = candidates[index];
    const payload = generateTasksStoragePayload(tasks, limit, referenceTasks);
    if (payload.length > GENERATE_TASKS_STORAGE_BUDGET && index < candidates.length - 1) continue;
    try {
      target.setItem(GENERATE_TASKS_STORAGE_KEY, payload);
      return true;
    } catch {}
  }
  try { target.removeItem?.(GENERATE_TASKS_STORAGE_KEY); } catch {}
  return false;
}
