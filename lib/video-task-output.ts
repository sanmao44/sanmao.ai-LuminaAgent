export type VideoTaskOutput = {
  videoUrls?: readonly unknown[];
  remoteVideoUrls?: readonly unknown[];
};

export type VideoTaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

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
