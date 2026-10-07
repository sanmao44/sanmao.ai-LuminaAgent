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

/** Chat attachment cards; file state, eligibility and operations remain page-owned. */
export default function AgentChatFileList({ files, Icon, onDownload, onPreview, onRemove, isPreviewable, fileTypeLabel, formatSize }: AgentChatFileListProps) {
  if (!files.length) return null;
  return (
    <div className="message-files">
      {files.map((file) => (
        <article className="message-file" key={file.id}>
          <div className="message-file-icon"><Icon name="folder" size={18} /></div>
          <div className="message-file-info">
            <strong title={file.name}>{file.name}</strong>
            <small>{fileTypeLabel(file)}{file.mimeType.replace(/;.*$/, '')} · {formatSize(file.sourceSize || file.size)}</small>
          </div>
          <div className="message-file-actions">
            {onPreview && isPreviewable(file) ? <button type="button" className="message-file-preview" onClick={() => onPreview(file)} title="预览文件"><Icon name="preview" size={14} />预览</button> : null}
            {!file.sourceSize ? <button type="button" className="message-file-download" onClick={() => onDownload(file)}><Icon name="download" size={14} />下载</button> : null}
          </div>
          {onRemove ? <button type="button" className="message-file-remove" onClick={() => onRemove(file)} title="移除文件"><Icon name="close" size={13} /></button> : null}
        </article>
      ))}
    </div>
  );
}
