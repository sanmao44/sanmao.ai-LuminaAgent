'use client';

import { useEffect, useState } from 'react';
import type { VideoTask } from '@/lib/video-task-store';

type Props = {
  task: VideoTask;
  onNotify: (message: string) => void;
  onDelete: () => void | Promise<void>;
  onRestore?: () => void | Promise<void>;
};

function statusLabel(status: VideoTask['status']) {
  return status === 'done' ? '已完成' : status === 'failed' ? '失败' : status === 'running' ? '生成中' : '排队中';
}

function operationLabel(operation: VideoTask['operation']) {
  return operation === 'edit' ? '视频编辑' : operation === 'extend' ? '视频扩展' : '视频生成';
}

function inputModeLabel(input: VideoTask['input']) {
  if (!input) return '参数未保存';
  if (input.referenceVideo || input.referenceVideos?.length) return '参考视频';
  if (input.firstFrame && input.lastFrame) return '首尾帧';
  if (input.firstFrame) return '首帧';
  if (input.referenceImages?.length) return `参考图 ${input.referenceImages.length} 张`;
  return '纯文本';
}

function durationLabel(input: VideoTask['input']) {
  if (!input) return '默认';
  if (Number(input.numFrames) > 0 && Number(input.frameRate) > 0) {
    return `约 ${(Number(input.numFrames) / Number(input.frameRate)).toFixed(1)} 秒 · ${input.numFrames} 帧 / ${input.frameRate} FPS`;
  }
  return input.seconds ? `${input.seconds} 秒` : '默认时长';
}

export default function VideoRecordCard({ task, onNotify, onDelete, onRestore }: Props) {
  const [parametersOpen, setParametersOpen] = useState(false);
  const url = task.videoUrls?.[0] || task.remoteVideoUrls?.[0] || '';
  const canDelete = task.status === 'done' || task.status === 'failed';
  const canRestore = task.status === 'done' || task.status === 'failed';
  const input = task.input;

  useEffect(() => {
    if (!parametersOpen) return;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setParametersOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [parametersOpen]);

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
        <button type="button" className="creative-video-view-parameters" onClick={() => setParametersOpen(true)} title="查看这条任务的生成参数" aria-label="查看这条任务的生成参数"><span className="creative-action-icon" aria-hidden="true">⌕</span><span>查看参数</span></button>
        {canRestore && onRestore && <button type="button" className="creative-video-restore" onClick={() => void onRestore()} title="恢复这条任务的生成参数" aria-label="恢复这条任务的生成参数"><span className="creative-action-icon" aria-hidden="true">↺</span><span>恢复参数</span></button>}
        {url && <a className="creative-video-download" href={url} download target="_blank" rel="noreferrer" title="下载生成的视频" aria-label="下载生成的视频"><span className="creative-action-icon" aria-hidden="true">↓</span></a>}
        <button type="button" className="creative-video-delete" onClick={handleDelete} title={canDelete ? '删除视频任务' : '视频生成完成或失败后可删除'} aria-label="删除视频任务"><span className="creative-action-icon" aria-hidden="true">⌫</span><span>删除</span></button>
      </div>
    </div>
    {parametersOpen && <div className="video-task-dialog creative-video-parameters-dialog" role="dialog" aria-modal="true" aria-label="视频参数" onClick={() => setParametersOpen(false)}><div className="video-task-dialog-inner" onClick={(event) => event.stopPropagation()}><div className="video-task-dialog-head"><div><span>视频参数</span><strong>{statusLabel(task.status)}</strong></div><button type="button" className="video-media-dialog-close" aria-label="关闭视频参数" onClick={() => setParametersOpen(false)}>×</button></div><div className="video-task-dialog-content"><label>提示词<pre>{input?.prompt || '未命名视频任务'}</pre></label><div className="video-task-dialog-meta creative-video-parameter-grid"><span>模型<b>{task.modelName || '自动选择模型'}</b></span><span>操作<b>{operationLabel(task.operation)}</b></span><span>输入方式<b>{inputModeLabel(input)}</b></span><span>时长<b>{durationLabel(input)}</b></span><span>比例<b>{input?.aspectRatio || 'Auto'}</b></span><span>分辨率<b>{input?.resolution || input?.videoSize || '默认清晰度'}</b></span><span>参考素材<b>{inputModeLabel(input)}</b></span>{input?.width && input?.height && <span>尺寸<b>{input.width} × {input.height}</b></span>}</div>{task.error && <p className="creative-video-error">{task.error}</p>}</div></div></div>}
  </article>;
}
