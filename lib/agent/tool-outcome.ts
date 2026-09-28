export type ToolOutcome = { name: string; key?: string; ok: boolean; error?: string };

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
