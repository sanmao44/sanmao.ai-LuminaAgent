export const ONE_TAKE_MIN_DURATION = 1;
export const ONE_TAKE_MAX_DURATION = 60;
export const ONE_TAKE_DEFAULT_DURATION = 15;

export function isValidOneTakeDuration(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= ONE_TAKE_MIN_DURATION
    && value <= ONE_TAKE_MAX_DURATION;
}

export function normalizeOneTakeDuration(
  value: unknown,
  fallback = ONE_TAKE_DEFAULT_DURATION,
) {
  const safeFallback = isValidOneTakeDuration(fallback)
    ? fallback
    : ONE_TAKE_DEFAULT_DURATION;
  return isValidOneTakeDuration(value) ? value : safeFallback;
}

export type OneTakeVideoDurationLimits = {
  minSeconds?: number;
  maxSeconds?: number;
  fixedSeconds?: number;
  allowedSeconds?: number[];
};

/**
 * Resolve a requested one-take duration to the closest duration the video
 * panel can actually submit for the selected model.
 */
export function nearestOneTakeVideoDuration(
  value: unknown,
  limits: OneTakeVideoDurationLimits = {},
) {
  const requested = normalizeOneTakeDuration(value);
  const rawMinimum = limits.minSeconds;
  const rawMaximum = limits.maxSeconds;
  const minimum = Math.max(
    ONE_TAKE_MIN_DURATION,
    typeof rawMinimum === "number" && Number.isInteger(rawMinimum)
      ? rawMinimum
      : ONE_TAKE_MIN_DURATION,
  );
  const maximum = Math.min(
    ONE_TAKE_MAX_DURATION,
    typeof rawMaximum === "number" && Number.isInteger(rawMaximum)
      ? rawMaximum
      : ONE_TAKE_MAX_DURATION,
  );
  const values = limits.fixedSeconds !== undefined
    ? [limits.fixedSeconds]
    : limits.allowedSeconds?.length
      ? limits.allowedSeconds
      : Array.from({ length: Math.max(0, maximum - minimum + 1) }, (_, index) => minimum + index);
  const supported = values.filter(
    (candidate): candidate is number =>
      isValidOneTakeDuration(candidate) && candidate >= minimum && candidate <= maximum,
  );
  if (!supported.length) return Math.min(maximum, Math.max(minimum, requested));
  return supported.reduce((closest, candidate) =>
    Math.abs(candidate - requested) < Math.abs(closest - requested) ? candidate : closest,
  );
}

export function buildOneTakeVideoRequest(durationSeconds: number) {
  const duration = normalizeOneTakeDuration(durationSeconds);
  return `请按我上传参考图的顺序，将 Image 1、Image 2、Image 3……串联成一段 ${duration} 秒、一镜到底的 Seedance 2.0 视频生成 Prompt。只输出最终可直接使用的 VIDEO PROMPT。`;
}
