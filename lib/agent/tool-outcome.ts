export type ToolOutcome = {
  name: string;
  key?: string;
  ok: boolean;
  error?: string;
  filesystemTextRead?: { serverId: string; kind: 'missing' | 'invalid-range' | 'content'; path?: string };
  filesystemEditRecovery?: { kind: 'blocked-write'; path: string } | { kind: 'preview'; path: string; diff: string };
};

/** A content repair replaces the result for the same requested file targets. */
export function toolOutcomeKey(name: string, rawArguments?: string, result?: { ok?: unknown; files?: unknown }) {
  const fallback = `${name}:${String(rawArguments)}`;
  if (name !== 'file_generate') return fallback;
  try {
    const args: unknown = JSON.parse(rawArguments || '{}');
    if (!args || typeof args !== 'object' || !('files' in args) || !Array.isArray(args.files) || !args.files.length) return fallback;
    // The file capability can return a partial batch. That cannot resolve an
    // earlier failure for every requested target in the batch.
    if (result?.ok === true && (!Array.isArray(result.files) || result.files.length !== args.files.length)) return fallback;
    const filenames: string[] = [];
    for (const file of args.files as unknown[]) {
      if (!file || typeof file !== 'object') return fallback;
      const filename = 'filename' in file && typeof file.filename === 'string' ? file.filename
        : 'name' in file && typeof file.name === 'string' ? file.name : '';
      if (!filename.trim()) return fallback;
      filenames.push(filename.trim());
    }
    return `${name}:files:${JSON.stringify(filenames.sort())}`;
  } catch { return fallback; }
}

function matchingFilesystemPreview(outcomes: readonly ToolOutcome[], blockedWrite: NonNullable<ToolOutcome['filesystemEditRecovery']>) {
  if (blockedWrite.kind !== 'blocked-write') return undefined;
  return outcomes.find((entry) => entry.ok
    && entry.filesystemEditRecovery?.kind === 'preview'
    && entry.filesystemEditRecovery.path === blockedWrite.path
    && Boolean(entry.filesystemEditRecovery.diff));
}

function diffFence(diff: string) {
  let longestBacktickRun = 0;
  for (const [run] of diff.matchAll(/`+/g)) longestBacktickRun = Math.max(longestBacktickRun, run.length);
  return String.fromCharCode(96).repeat(Math.max(3, longestBacktickRun + 1));
}

/** Return an authoritative preview when a direct write was blocked for the same file. */
export function filesystemEditPreviewRecoveryText(outcomes: readonly ToolOutcome[]) {
  const latest = new Map<string, ToolOutcome>();
  outcomes.forEach((outcome) => latest.set(outcome.key || outcome.name, outcome));
  const finalOutcomes = [...latest.values()];
  const previews = new Map<string, string>();
  for (const blocked of finalOutcomes) {
    const recovery = blocked.filesystemEditRecovery;
    const preview = recovery?.kind === 'blocked-write' ? matchingFilesystemPreview(finalOutcomes, recovery) : undefined;
    const previewRecovery = preview?.filesystemEditRecovery;
    if (recovery?.kind === 'blocked-write' && previewRecovery?.kind === 'preview') previews.set(recovery.path, previewRecovery.diff);
  }
  if (!previews.size) return '';
  const details = [...previews].map(([path, diff]) => {
    const fence = diffFence(diff);
    return `文件 ${JSON.stringify(path)} 的实际差异：\n\n${fence}diff\n${diff}\n${fence}`;
  }).join('\n\n');
  return `已生成只读文件差异预览，原文件没有修改。直接写入调用已按“先核对差异”要求拦截。\n\n${details}`;
}

/** A content repair replaces the result for the same requested file targets. */
export function toolOutcomeKey(name: string, rawArguments?: string, result?: { ok?: unknown; files?: unknown }) {
  const fallback = `${name}:${String(rawArguments)}`;
  if (name !== 'file_generate') return fallback;
  try {
    const args: unknown = JSON.parse(rawArguments || '{}');
    if (!args || typeof args !== 'object' || !('files' in args) || !Array.isArray(args.files) || !args.files.length) return fallback;
    // The file capability can return a partial batch. That cannot resolve an
    // earlier failure for every requested target in the batch.
    if (result?.ok === true && (!Array.isArray(result.files) || result.files.length !== args.files.length)) return fallback;
    const filenames: string[] = [];
    for (const file of args.files as unknown[]) {
      if (!file || typeof file !== 'object') return fallback;
      const filename = 'filename' in file && typeof file.filename === 'string' ? file.filename
        : 'name' in file && typeof file.name === 'string' ? file.name : '';
      if (!filename.trim()) return fallback;
      filenames.push(filename.trim());
    }
    return `${name}:files:${JSON.stringify(filenames.sort())}`;
  } catch { return fallback; }
}

/** A model's prose cannot override failed execution evidence. */
export function toolOutcomeText(text: string, outcomes: readonly ToolOutcome[], readSettlement?: 'answer' | 'stopped') {
  const latest = new Map<string, { outcome: ToolOutcome; index: number }>();
  outcomes.forEach((outcome, index) => latest.set(outcome.key || outcome.name, { outcome, index }));
  const finalOutcomes = [...latest.values()];
  const failures = finalOutcomes.filter(({ outcome, index }) => {
    if (outcome.ok) return false;
    const editRecovery = outcome.filesystemEditRecovery;
    if (editRecovery?.kind === 'blocked-write' && matchingFilesystemPreview(finalOutcomes.map((entry) => entry.outcome), editRecovery)) return false;
    const read = outcome.filesystemTextRead;
    if (!readSettlement || !read || read.kind === 'content') return true;
    // A missed path can lead to the correct file. An invalid line range is
    // only resolved by a content read of the same file by the same service.
    if (readSettlement === 'stopped') return false;
    return !finalOutcomes.some((entry) => entry.index > index && entry.outcome.ok
      && entry.outcome.filesystemTextRead?.kind === 'content'
      && entry.outcome.filesystemTextRead.serverId === read.serverId
      && (read.kind === 'missing' || (read.path && entry.outcome.filesystemTextRead.path === read.path)));
  }).map(({ outcome }) => outcome);
  if (!failures.length) return text;
  const lastFailure = outcomes.findLastIndex((outcome) => failures.includes(outcome));
  const laterSuccesses = outcomes.slice(lastFailure + 1).filter((outcome) => outcome.ok);
  if (laterSuccesses.length) {
    return `执行中曾遇到错误：${failures.map((outcome) => `${outcome.name}：${outcome.error || '调用失败'}`).join('；').slice(0, 700)}。\n\n后续调用已返回成功：${[...new Set(laterSuccesses.map((outcome) => outcome.name))].join('、')}。以上是各次调用结果，不能据此断定全部目标完成；最终效果仍需核验。`;
  }
  return `任务尚未全部完成：${failures.map((outcome) => `${outcome.name}：${outcome.error || '调用失败'}`).join('；').slice(0, 1000)}。`;
}
