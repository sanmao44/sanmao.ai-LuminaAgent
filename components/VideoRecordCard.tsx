'use client';

import type { VideoTask } from '@/lib/video-task-store';

type Props = {
  task: VideoTask;
  onNotify: (message: string) => void;
  onDelete: () => void | Promise<void>;
};

function statusLabel(status: VideoTask['status']) {
  return status === 'done' ? '已完成' : status === 'failed' ? '失败' : status === 'running' ? '生成中' : '排队中';
}

function operationLabel(operation: VideoTask['operation']) {
  return operation === 'edit' ? '视频编辑' : operation === 'extend' ? '视频扩展' : '视频生成';
}

export default function VideoRecordCard({ task, onNotify, onDelete }: Props) {
  const url = task.videoUrls?.[0] || task.remoteVideoUrls?.[0] || '';
  const canDelete = task.status === 'done' || task.status === 'failed';
  const handleDelete = () => {
    if (!canDelete) {
      onNotify('视频正在生成，完成或失败后才能删除');
      return;
    }
    void onDelete();
  };
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
      <div className="creative-video-actions">
        {url && <><a href={url} download target="_blank" rel="noreferrer">下载视频</a><button type="button" onClick={() => void navigator.clipboard?.writeText(url).then(() => onNotify('视频地址已复制'))}>复制地址</button></>}
        <button type="button" className="creative-video-delete" onClick={handleDelete} aria-label="删除视频任务">删除</button>
      </div>
    </div>
  </article>;
}
