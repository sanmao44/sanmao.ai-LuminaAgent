import type { CreativeReviewEvidence } from '@/packages/contracts/creative-review';

export const BLACK_FRAME_MIN_DURATION_SECONDS = 0.5;
export const BLACK_FRAME_PIXEL_THRESHOLD = 0.1;
export const BLACK_FRAME_PICTURE_THRESHOLD = 0.98;
export const FREEZE_MIN_DURATION_SECONDS = 2;
export const FREEZE_NOISE_THRESHOLD_DB = -50;
export const MAX_REPORTED_SIGNAL_INTERVALS = 8;

export const VIDEO_SIGNAL_DIAGNOSTIC_FILTERS = [
  'blackdetect=d=' + BLACK_FRAME_MIN_DURATION_SECONDS
    + ':pix_th=' + BLACK_FRAME_PIXEL_THRESHOLD
    + ':pic_th=' + BLACK_FRAME_PICTURE_THRESHOLD,
  'freezedetect=n=' + FREEZE_NOISE_THRESHOLD_DB + 'dB:d=' + FREEZE_MIN_DURATION_SECONDS,
].join(',');

export type VideoSignalInterval = {
  start: number;
  end?: number;
  duration?: number;
};

function finiteNumber(value: string | undefined) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function parseBlackIntervals(stderr: string): VideoSignalInterval[] {
  return [...stderr.matchAll(/black_start:\s*(\d+(?:\.\d+)?)\s+black_end:\s*(\d+(?:\.\d+)?)\s+black_duration:\s*(\d+(?:\.\d+)?)/gu)]
    .map((match) => ({
      start: finiteNumber(match[1]),
      end: finiteNumber(match[2]),
      duration: finiteNumber(match[3]),
    }))
    .filter((item): item is VideoSignalInterval & { end: number; duration: number } =>
      item.start !== null && item.end !== null && item.duration !== null && item.end >= item.start && item.duration > 0);
}

function parseFreezeIntervals(stderr: string): VideoSignalInterval[] {
  const starts = [...stderr.matchAll(/lavfi\.freezedetect\.freeze_start:\s*(\d+(?:\.\d+)?)/gu)];
  const ends = [...stderr.matchAll(/lavfi\.freezedetect\.freeze_end:\s*(\d+(?:\.\d+)?)/gu)];
  const durations = [...stderr.matchAll(/lavfi\.freezedetect\.freeze_duration:\s*(\d+(?:\.\d+)?)/gu)];
  return starts.flatMap((match, index) => {
    const start = finiteNumber(match[1]);
    if (start === null) return [];
    const end = finiteNumber(ends[index]?.[1]);
    const duration = finiteNumber(durations[index]?.[1]) ?? (end !== null ? Math.max(0, end - start) : undefined);
    return [{ start, ...(end !== null ? { end } : {}), ...(duration !== undefined ? { duration } : {}) }];
  });
}

function formatTime(value: number) {
  return value.toFixed(3) + ' s';
}

function formatIntervals(intervals: VideoSignalInterval[]) {
  const shown = intervals.slice(0, MAX_REPORTED_SIGNAL_INTERVALS).map((interval) => {
    if (interval.end !== undefined) return formatTime(interval.start) + '–' + formatTime(interval.end);
    if (interval.duration !== undefined) return formatTime(interval.start) + ' 起点，持续 ' + formatTime(interval.duration);
    return formatTime(interval.start) + ' 起点，结束时间未报告';
  });
  const omitted = Math.max(0, intervals.length - shown.length);
  return shown.join('；') + (omitted ? '；另有 ' + omitted + ' 处未展开' : '');
}

function signalEvidence(input: {
  dimension: string;
  label: string;
  threshold: string;
  intervals: VideoSignalInterval[];
  complete: boolean;
  truncated: boolean;
  unavailableReason?: string;
}): CreativeReviewEvidence {
  const { intervals } = input;
  const available = !input.unavailableReason;
  const observed = !available
    ? '检测器不可用'
    : intervals.length > 0
      ? (input.complete ? '检测到 ' : '部分扫描发现 ') + intervals.length + ' 个候选区间：' + formatIntervals(intervals)
      : input.complete ? '未检测到达到阈值的候选区间' : '未取得完整扫描结果';
  const reason = !available
    ? input.unavailableReason || '检测器不可用，未形成候选结论。'
    : intervals.length > 0
      ? (input.truncated ? '检测日志达到上限，' : '') + '发现可能的' + input.label + '候选区间；片头片尾、转场、静态镜头或设计风格可能是预期内容，需要人工复核。该信号尚未用真实产物校准，不直接判为不合格。'
      : input.complete
        ? '在完整解码中未检测到达到阈值的' + input.label + '候选区间；低于阈值的短片段及创作意图仍无法判断，因此不据此判通过。'
        : 'FFmpeg 未完成完整扫描' + (input.truncated ? '，且诊断日志被截断' : '') + '；没有候选记录不能证明不存在' + input.label + '。';
  return {
    dimension: input.dimension,
    status: 'unknown',
    criterion: input.threshold + '；仅生成候选提示，不自动判定交付质量',
    observed,
    expected: input.threshold,
    reason,
    source: 'rule',
    ...(intervals.length > 0 ? { location: formatIntervals(intervals) } : {}),
  };
}

export function isVideoSignalFilterSetupError(stderr: string) {
  return /no such filter|error initializing filter|error opening filters|error reinitializing filters|failed to configure (?:input|output) pad on parsed_(?:blackdetect|freezedetect)|option .+ not found/iu.test(stderr);
}

export function buildVideoSignalEvidence(input: {
  stderr: string;
  complete: boolean;
  truncated: boolean;
  unavailableReason?: string;
}): CreativeReviewEvidence[] {
  const blackThreshold = '黑帧候选阈值：连续时长 ≥' + BLACK_FRAME_MIN_DURATION_SECONDS.toFixed(2)
    + ' s；亮度阈值 pix_th=' + BLACK_FRAME_PIXEL_THRESHOLD.toFixed(2)
    + '；至少 ' + (BLACK_FRAME_PICTURE_THRESHOLD * 100).toFixed(0) + '% 像素满足阈值';
  const freezeThreshold = '静止候选阈值：连续时长 ≥' + FREEZE_MIN_DURATION_SECONDS.toFixed(2)
    + ' s；帧间噪声阈值 ' + FREEZE_NOISE_THRESHOLD_DB + ' dB';
  return [
    signalEvidence({
      dimension: 'black_frame_hints',
      label: '黑帧',
      threshold: blackThreshold,
      intervals: parseBlackIntervals(input.stderr),
      ...input,
    }),
    signalEvidence({
      dimension: 'freeze_hints',
      label: '冻结画面',
      threshold: freezeThreshold,
      intervals: parseFreezeIntervals(input.stderr),
      ...input,
    }),
  ];
}
