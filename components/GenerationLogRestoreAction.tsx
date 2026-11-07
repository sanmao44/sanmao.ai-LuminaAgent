'use client';

import { useEffect, useRef, useState } from 'react';
import type { GenerationLog } from '@/lib/generation-log';
import type { VideoTask } from '@/lib/video-task-store';
import { generationLogMatchesTask, generationMediaKind } from '@/lib/generation-log-presentation';
import { getVideoTask } from '@/lib/video-task-client';

type Props = {
  log: GenerationLog;
  videoTasks: readonly VideoTask[];
  canRestoreImage: boolean;
  onRestoreImage: () => void;
  onRestoreVideo: (task: VideoTask) => void;
};

/** Transient restore interaction only; task state remains owned by the Worker. */
export default function GenerationLogRestoreAction({ log, videoTasks, canRestoreImage, onRestoreImage, onRestoreVideo }: Props) {
  const isVideo = generationMediaKind(log) === 'video';
  const requestRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => { requestRef.current?.abort(); }, []);

  if (!isVideo && !canRestoreImage) return null;

  async function restore() {
    if (!isVideo) return onRestoreImage();
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setError('');
    try {
      const task = videoTasks.find((item) => generationLogMatchesTask(log, item))
        // Video logs are created with the local task ID. Provider IDs are not repository keys.
        ?? await getVideoTask(log.id, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!task) {
        setError('原视频任务记录已不存在，请复制提示词后到视频工作台重新设置参数。');
        return;
      }
      onRestoreVideo(task);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '读取视频参数失败，请稍后重试。');
      }
    } finally {
      if (!controller.signal.aborted) {
        requestRef.current = null;
        setBusy(false);
      }
    }
  }

  return <div className="log-detail-actions">
    {error && <p className="log-restore-error" role="alert">{error}</p>}
    <button type="button" className="primary-action compact" disabled={busy} aria-busy={busy} onClick={() => void restore()}>
      {busy ? '正在读取视频参数…' : isVideo ? '恢复到视频工作台' : '恢复基础参数'}
    </button>
  </div>;
}
