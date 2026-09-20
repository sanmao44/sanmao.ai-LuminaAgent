export type ToolOutcome = { name: string; key?: string; ok: boolean; error?: string };

/** A model's prose cannot override failed execution evidence. */
export function toolOutcomeText(text: string, outcomes: readonly ToolOutcome[]) {
  const latest = new Map<string, ToolOutcome>();
  for (const outcome of outcomes) latest.set(outcome.key || outcome.name, outcome);
  const failures = [...latest.values()].filter((outcome) => !outcome.ok);
  if (!failures.length) return text;
  return `任务尚未全部完成：${failures.map((outcome) => `${outcome.name}：${outcome.error || '调用失败'}`).join('；').slice(0, 1000)}。`;
}
