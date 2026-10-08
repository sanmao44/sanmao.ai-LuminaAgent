import type { SkillRouteCandidate, SkillRouteDecision, SkillRouteOptions } from '../contracts/skill';

const EXPLICIT_SKILL_PATTERN = /(?:^|\s)(?:用|使用|请用|请使用)\s*(?:「([^「」\n]{1,80})」|([^\s，。！？!?：:]{1,80}))\s*技能\s*[:：]?/i;
const QUESTION_PATTERN = /(?:为什么|怎么|如何|什么是|是否|能不能|可以吗|吗[？?]?$|[？?]$)/i;
const CREATIVE_REQUEST_PATTERN = /(?:用|使用|请用|请使用|按照|按|以|模仿|采用|遵循|帮我|给我|我要|写|撰写|改写|润色|仿写|生成|创作|评论|回答|描述|赞美|批评|排查|调试|修复|部署|实现|制作|执行|完成|整理|分析|翻译|总结)/i;
const GENERIC_WORDS = new Set(['用', '使用', '请用', '请使用', '技能', '这个', '那个', '内容', '进行', '一下', '帮我', '给我']);

function clean(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function cjkBigrams(value: string) {
  const grams: string[] = [];
  for (const run of value.match(/[\u3400-\u9fff\uf900-\ufaff]{2,}/g) || []) {
    for (let index = 0; index + 2 <= run.length; index += 1) grams.push(run.slice(index, index + 2));
  }
  return grams;
}

function explicitSkillName(input: string) {
  const match = EXPLICIT_SKILL_PATTERN.exec(input);
  return (match?.[1] || match?.[2] || '').trim().toLowerCase();
}

function candidateTerms(candidate: SkillRouteCandidate) {
  return [candidate.id, candidate.name, ...(candidate.tags || [])]
    .map(clean)
    .filter((term) => term.length >= 2 && !GENERIC_WORDS.has(term));
}

function scoreCandidate(input: string, candidate: SkillRouteCandidate) {
  const text = clean(input);
  const terms = candidateTerms(candidate);
  let score = 0;
  let matchedTerms = 0;
  for (const term of terms) {
    if (text.includes(term)) {
      score += term === clean(candidate.id) || term === clean(candidate.name) ? 10 : 7;
      matchedTerms += 1;
      continue;
    }
    const grams = cjkBigrams(term).filter((gram) => text.includes(gram));
    if (grams.length) {
      score += Math.min(grams.length, 3) * 2;
      matchedTerms += 1;
    }
  }
  const description = clean(candidate.description);
  if (description && text.includes(description)) score += 5;
  return { score, matchedTerms };
}

function none(reason: string, explicit = false): SkillRouteDecision {
  return { enabled: false, matched: false, explicit, confidence: 'none', skillId: '', skillName: '', reason };
}

/**
 * Select an installed skill from metadata only.
 *
 * Explicit picker directives always win. Automatic matching requires both a
 * meaningful metadata hit and an execution-shaped request; a bare question
 * such as “鲁迅会怎么说” therefore does not silently activate a skill.
 */
export function routeSkillRequest(input: string, candidates: readonly SkillRouteCandidate[], options: SkillRouteOptions = {}): SkillRouteDecision {
  const text = clean(input);
  const available = candidates.filter((candidate) => candidate.enabled !== false);
  if (!available.length) return none('没有已启用的技能。');

  const explicitSkillId = clean(options.explicitSkillId);
  if (explicitSkillId) {
    const exact = available.find((candidate) => clean(candidate.id) === explicitSkillId);
    if (exact) return { enabled: true, matched: true, explicit: true, confidence: 'high', skillId: exact.id, skillName: exact.name, reason: `用户通过技能选择器指定了“${exact.name}”。` };
    return { enabled: true, matched: false, explicit: true, confidence: 'high', skillId: explicitSkillId, skillName: explicitSkillId, reason: `用户选择的技能“${explicitSkillId}”当前不可用，交由技能工具进一步解析。` };
  }

  if (!text) return none('请求为空。');

  const explicit = explicitSkillName(input);
  if (explicit) {
    const exact = available.find((candidate) => [candidate.id, candidate.name, ...(candidate.tags || [])].some((value) => clean(value) === explicit));
    if (exact) return { enabled: true, matched: true, explicit: true, confidence: 'high', skillId: exact.id, skillName: exact.name, reason: `用户显式选择了技能“${exact.name}”。` };
    return { enabled: true, matched: false, explicit: true, confidence: 'high', skillId: explicit, skillName: explicit, reason: `用户显式指定技能“${explicit}”，交由技能工具进一步解析。` };
  }

  if (QUESTION_PATTERN.test(text) || !CREATIVE_REQUEST_PATTERN.test(text)) return none('当前请求不是明确的技能执行请求。');
  const ranked = available
    .map((candidate) => ({ candidate, ...scoreCandidate(text, candidate) }))
    .filter((row) => row.score >= 7 && row.matchedTerms > 0)
    .sort((left, right) => right.score - left.score || right.matchedTerms - left.matchedTerms);
  const top = ranked[0];
  if (!top) return none('没有技能元数据与当前请求形成足够强的匹配。');
  const second = ranked[1];
  if (second && top.score - second.score < 3) return none('多个技能匹配度接近，暂不自动锁定。');
  return {
    enabled: true,
    matched: true,
    explicit: false,
    confidence: top.score >= 12 ? 'high' : 'medium',
    skillId: top.candidate.id,
    skillName: top.candidate.name,
    reason: `根据技能名称、标签和用户请求自动匹配“${top.candidate.name}”。`,
  };
}
