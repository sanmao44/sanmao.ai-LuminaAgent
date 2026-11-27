import type { CreativeReviewEvidence, CreativeReviewMediaKind, CreativeReviewStatus } from '@/packages/contracts/creative-review';
import type { CreativeVisualReviewFrame, CreativeVisualReviewer } from '@/packages/contracts/creative-review-visual';

const MAX_BRIEF_CHARS = 4000;
const MAX_GENERATION_PROMPT_CHARS = 4000;
const MAX_FRAMES = 3;
const MAX_FRAME_DATA_URL_CHARS = 1024 * 1024;
const MAX_EVIDENCE_CHARS = 500;

function unknownEvidence(dimension: string, reason: string): CreativeReviewEvidence {
  return {
    dimension,
    status: 'unknown',
    criterion: '画面主体、构图与风格符合原始创作需求',
    reason,
    source: 'vision',
  };
}

function boundedText(value: unknown, limit = MAX_EVIDENCE_CHARS) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function boundedEvidenceValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string') return boundedText(value) || undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  return typeof value === 'boolean' ? value : undefined;
}

function isReviewStatus(value: unknown): value is CreativeReviewStatus {
  return value === 'pass' || value === 'fail' || value === 'unknown';
}

function safeFrames(frames: readonly CreativeVisualReviewFrame[]) {
  if (frames.length < 1 || frames.length > MAX_FRAMES) return false;
  return frames.every((frame) => typeof frame?.dataUrl === 'string'
    && frame.dataUrl.length > 0
    && frame.dataUrl.length <= MAX_FRAME_DATA_URL_CHARS
    && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/u.test(frame.dataUrl)
    && typeof frame.location === 'string'
    && frame.location.length <= 120);
}

/** Invoke the explicitly injected reviewer once, only with bounded local image frames. */
export async function reviewCreativeBrief(input: {
  mediaKind: CreativeReviewMediaKind;
  dimension: string;
  brief?: string;
  generationPrompt?: string;
  visualReviewer?: CreativeVisualReviewer;
  signal?: AbortSignal;
  loadFrames: () => Promise<readonly CreativeVisualReviewFrame[]>;
}): Promise<CreativeReviewEvidence> {
  const dimension = boundedText(input.dimension, 80) || 'brief_alignment';
  if (!input.visualReviewer) return unknownEvidence(dimension, '本次没有启用经标注数据校准的视觉评审器；不能确认画面是否符合需求。');
  const brief = boundedText(input.brief, MAX_BRIEF_CHARS);
  if (!brief) return unknownEvidence(dimension, '没有保留到原始创作需求，无法判断画面是否符合 brief。');
  if (input.signal?.aborted) return unknownEvidence(dimension, '评审在抽取或分析画面前已取消；本次结论为 unknown。');

  try {
    const frames = await input.loadFrames();
    if (!safeFrames(frames)) return unknownEvidence(dimension, '本地画面帧数量、格式或大小超出评审边界；本次结论为 unknown。');
    if (input.signal?.aborted) return unknownEvidence(dimension, '抽取画面期间评审已取消；本次结论为 unknown。');
    const result = await input.visualReviewer({
      mediaKind: input.mediaKind,
      brief,
      ...(input.generationPrompt ? { generationPrompt: boundedText(input.generationPrompt, MAX_GENERATION_PROMPT_CHARS) } : {}),
      frames,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!result || !isReviewStatus(result.status)) return unknownEvidence(dimension, '视觉评审器未返回可识别的 pass/fail/unknown 判定。');
    const criterion = boundedText(result.criterion, 200);
    const observed = boundedEvidenceValue(result.observed);
    const expected = boundedEvidenceValue(result.expected) ?? brief;
    const reason = boundedText(result.reason);
    if (!criterion || !reason || (result.status !== 'unknown' && observed === undefined)) {
      return unknownEvidence(dimension, '视觉评审器的判定缺少可复核的检查标准、实测值或理由；本次不接受其 pass/fail 结论。');
    }
    const location = frames.map((frame) => boundedText(frame.location, 120)).filter(Boolean).join('；');
    return {
      dimension,
      status: result.status,
      criterion,
      ...(observed !== undefined ? { observed } : { observed: '尚未得出可靠的画面观察' }),
      expected,
      reason,
      source: 'vision',
      ...(location ? { location } : {}),
    };
  } catch {
    return unknownEvidence(dimension, '视觉评审未能在本地评审边界内完成；本次结论为 unknown。');
  }
}
