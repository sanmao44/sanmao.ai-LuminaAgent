export type VideoTaskOutput = {
  videoUrls?: readonly unknown[];
  remoteVideoUrls?: readonly unknown[];
};

export type VideoTaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

/** Returns usable task outputs with locally archived URLs taking precedence. */
export function videoTaskOutputUrls(task: VideoTaskOutput) {
  return [...(task.videoUrls || []), ...(task.remoteVideoUrls || [])]
    .map((url) => String(url || '').trim())
    .filter((url, index, urls) => Boolean(url) && urls.indexOf(url) === index);
}

export function videoTaskOutputUrl(task: VideoTaskOutput) {
  return videoTaskOutputUrls(task)[0] || '';
}

/** A provider result is terminal success even when an older task record says otherwise. */
export function videoTaskStatus(task: VideoTaskOutput & { status: VideoTaskStatus }) {
  return videoTaskOutputUrls(task).length ? 'done' as const : task.status;
}
