export type VideoTaskOutput = {
  videoUrls?: readonly unknown[];
  remoteVideoUrls?: readonly unknown[];
};

export type VideoTaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export type VideoTaskErrorPresentation = {
  summary: string;
  detail: string;
};

function sanitizeVideoTaskError(value: string) {
  return value
    .replace(/(["']?\bauthorization["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\r\n]+)/gi, '$1[已隐藏]')
    .replace(/[A-Za-z]:\\[^\"'<>|?*\r\n]+/g, '[本机路径]')
    .replace(/\/(?:Users|home|var|tmp|mnt|opt|workspace)\/[^\s\"'<>]+/g, '[本机路径]')
    .replace(/([?&](?:api[_-]?key|(?:access[_-]?|refresh[_-]?)?token|client[_-]?secret|secret|password|key)=)[^&\s]+/gi, '$1[已隐藏]')
    .replace(/(\b(?:api[_-]?key|(?:access[_-]?|refresh[_-]?)?token|client[_-]?secret|secret|password)\b["']?\s*[:=]\s*["']?)[^\s,"'&}]+/gi, '$1[已隐藏]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [已隐藏]')
    .trim()
    .slice(0, 600);
}

/** Converts provider and filesystem errors into user-safe, actionable copy. */
export function videoTaskErrorPresentation(
  error: unknown,
  options: { hasRemoteOutput?: boolean; localArchiveFailed?: boolean; isTracking?: boolean } = {},
): VideoTaskErrorPresentation | null {
  const raw = String(error || '').trim();
  if (!raw) return null;
  const localArchiveFailed = options.localArchiveFailed || options.hasRemoteOutput;
  const transient = /(?:timeout|timed out|超时|network|fetch|econn|eai_again|429|408|425|502|503|504|temporar|暂时|网络)/i.test(raw);
  const summary = localArchiveFailed
    ? '视频已生成，但本机保存失败，可再次保存'
    : options.isTracking
      ? '任务状态暂时无法更新，正在继续查询'
      : transient
      ? '服务商或网络暂时不可用，可稍后重试'
      : '视频生成失败，可恢复参数后重新提交';
  return { summary, detail: sanitizeVideoTaskError(raw) };
}

/** Returns usable task outputs, preferring local archives over provider URLs. */
export function videoTaskOutputUrls(task: VideoTaskOutput) {
  const normalize = (urls: readonly unknown[] | undefined) => (urls || [])
    .map((url) => String(url || '').trim())
    .filter((url, index, values) => Boolean(url) && values.indexOf(url) === index);
  const localUrls = normalize(task.videoUrls);
  return localUrls.length ? localUrls : normalize(task.remoteVideoUrls);
}

export function videoTaskOutputUrl(task: VideoTaskOutput) {
  return videoTaskOutputUrls(task)[0] || '';
}

/** A provider result is terminal success even when an older task record says otherwise. */
export function videoTaskStatus(task: VideoTaskOutput & { status: VideoTaskStatus }) {
  return videoTaskOutputUrls(task).length ? 'done' as const : task.status;
}
