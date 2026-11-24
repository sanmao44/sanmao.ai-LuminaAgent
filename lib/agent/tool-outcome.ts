export type ToolOutcome = { name: string; key?: string; ok: boolean; error?: string };

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
export function toolOutcomeText(text: string, outcomes: readonly ToolOutcome[]) {
  const latest = new Map<string, ToolOutcome>();
  for (const outcome of outcomes) latest.set(outcome.key || outcome.name, outcome);
  const failures = [...latest.values()].filter((outcome) => !outcome.ok);
  if (!failures.length) return text;
  const lastFailure = outcomes.findLastIndex((outcome) => !outcome.ok);
  const laterSuccesses = outcomes.slice(lastFailure + 1).filter((outcome) => outcome.ok);
  if (laterSuccesses.length) {
    return `执行中曾遇到错误：${failures.map((outcome) => `${outcome.name}：${outcome.error || '调用失败'}`).join('；').slice(0, 700)}。\n\n后续调用已返回成功：${[...new Set(laterSuccesses.map((outcome) => outcome.name))].join('、')}。以上是各次调用结果，不能据此断定全部目标完成；最终效果仍需核验。`;
  }
  return `任务尚未全部完成：${failures.map((outcome) => `${outcome.name}：${outcome.error || '调用失败'}`).join('；').slice(0, 1000)}。`;
}
