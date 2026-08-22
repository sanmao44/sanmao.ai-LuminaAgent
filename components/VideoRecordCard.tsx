'use client';

import type { VideoTask } from '@/lib/video-task-store';

type Props = {
  task: VideoTask;
  onNotify: (message: string) => void;
};

function statusLabel(status: VideoTask['status']) {
  return status === 'done' ? '已完成' : status === 'failed' ? '失败' : status === 'running' ? '生成中' : '排队中';
}

function operationLabel(operation: VideoTask['operation']) {
  return operation === 'edit' ? '视频编辑' : operation === 'extend' ? '视频扩展' : '视频生成';
}

export default function VideoRecordCard({ task, onNotify }: Props) {
  const url = task.videoUrls?.[0] || task.remoteVideoUrls?.[0] || '';
  return <article className={`creative-video-card ${task.status}`}>
    <div className="creative-video-preview">
      {url ? <video src={url} controls playsInline preload="metadata" /> : <div className="creative-video-placeholder"><span>▶</span><small>{task.status === 'failed' ? '视频生成失败' : '视频生成中'}</small></div>}
      <span className="creative-media-badge">视频</span>
    </div>
    <div className="creative-video-body">
      <div className="creative-video-meta"><span className={`creative-status-pill ${task.status}`}>{statusLabel(task.status)}</span><time>{new Date(task.createdAt).toLocaleString('zh-CN', { hour12: false })}</time></div>
      <strong>{task.input?.prompt || '未命名视频任务'}</strong>
      <small>{operationLabel(task.operation)} · {task.modelName || '自动选择模型'}{typeof task.costUsd === 'number' ? ` · $${task.costUsd.toFixed(4)}` : ''}</small>
      {task.error && <p className="creative-video-error">{task.error}</p>}
      {url && <div className="creative-video-actions"><a href={url} download target="_blank" rel="noreferrer">下载视频</a><button type="button" onClick={() => void navigator.clipboard?.writeText(url).then(() => onNotify('视频地址已复制'))}>复制地址</button></div>}
    </div>
  </article>;
}
