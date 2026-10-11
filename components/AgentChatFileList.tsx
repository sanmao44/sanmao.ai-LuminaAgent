import type { ComponentType } from 'react';
import type { ChatFile } from '@/lib/client-history';

type ChatFileItem = ChatFile & { sourceSize?: number };

type AgentChatFileListProps = {
  files: ChatFileItem[];
  Icon: ComponentType<{ name: string; size?: number }>;
  onDownload: (file: ChatFileItem) => void;
  onPreview?: (file: ChatFileItem) => void;
  onRemove?: (file: ChatFileItem) => void;
  isPreviewable: (file: ChatFileItem) => boolean;
  fileTypeLabel: (file: ChatFileItem) => string;
  formatSize: (size?: number) => string;
};

function isVideoFile(file: ChatFileItem) {
  const mimeType = String(file.mimeType || '').split(';', 1)[0].trim().toLowerCase();
  return mimeType.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name);
}

/** Chat attachment cards; file state, eligibility and operations remain page-owned. */
export default function AgentChatFileList({ files, Icon, onDownload, onPreview, onRemove, isPreviewable, fileTypeLabel, formatSize }: AgentChatFileListProps) {
  if (!files.length) return null;
  return (
    <div className="message-files">
      {files.map((file) => (
        <article
          className={`message-file${isVideoFile(file) ? ' message-file-video' : ''}`}
          key={file.id}
          role={onPreview && isPreviewable(file) ? 'button' : undefined}
          tabIndex={onPreview && isPreviewable(file) ? 0 : undefined}
          onClick={onPreview && isPreviewable(file) ? () => onPreview(file) : undefined}
          onKeyDown={onPreview && isPreviewable(file) ? (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onPreview(file);
          } : undefined}
        >
          <div className="message-file-icon"><Icon name={isVideoFile(file) ? 'video' : 'folder'} size={18} /></div>
          <div className="message-file-info">
            <strong title={file.name}>{file.name}</strong>
            <small>{fileTypeLabel(file)}{file.mimeType.replace(/;.*$/, '')} · {formatSize(file.sourceSize || file.size)}</small>
          </div>
          <div className="message-file-actions">
            {onPreview && isPreviewable(file) ? <button type="button" className="message-file-preview" onClick={(event) => { event.stopPropagation(); onPreview(file); }} title={isVideoFile(file) ? '播放视频' : '预览文件'}><Icon name={isVideoFile(file) ? 'video' : 'preview'} size={14} />{isVideoFile(file) ? '播放预览' : '预览'}</button> : null}
            {!file.sourceSize ? <button type="button" className="message-file-download" onClick={(event) => { event.stopPropagation(); onDownload(file); }} title="下载到本机"><Icon name="download" size={14} />下载</button> : null}
          </div>
          {onRemove ? <button type="button" className="message-file-remove" onClick={(event) => { event.stopPropagation(); onRemove(file); }} title="移除文件"><Icon name="close" size={13} /></button> : null}
        </article>
      ))}
    </div>
  );
}
