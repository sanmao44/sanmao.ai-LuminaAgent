import type { ComponentType } from 'react';

type AgentMessageToolsProps = {
  role: 'assistant' | 'user';
  retrying: boolean;
  retryLabel: string;
  retryTitle: string;
  retryActivity?: string;
  videoPushTitle?: string;
  Icon: ComponentType<{ name: string; size?: number }>;
  onCopy: () => void;
  onFollowUp: () => void;
  onRetry: () => void;
  onPushImage: () => void;
  onPushVideo: () => void;
  onDelete: () => void;
};

/** Message actions presentation; message state and all operations remain page-owned. */
export default function AgentMessageTools({
  role,
  retrying,
  retryLabel,
  retryTitle,
  retryActivity,
  videoPushTitle,
  Icon,
  onCopy,
  onFollowUp,
  onRetry,
  onPushImage,
  onPushVideo,
  onDelete,
}: AgentMessageToolsProps) {
  return (
    <div className={`message-tools ${role === 'user' ? 'user-message-tools' : ''}`}>
      <button type="button" title="复制消息" aria-label="复制消息" onClick={onCopy}>
        <Icon name="copy" size={14} />
        复制
      </button>
      {role === 'assistant' && (
        <>
          <button type="button" className="message-followup" title="围绕此消息追问" onClick={onFollowUp}>
            <Icon name="agent" size={14} />
            围绕此条追问
          </button>
          <button type="button" className="message-retry" disabled={retrying} title={retryTitle} onClick={onRetry}>
            <Icon name="retry" size={14} />
            {retryLabel}
          </button>
          {retryActivity ? <span className="message-retry-activity">{retryActivity}</span> : null}
          <button type="button" onClick={onPushImage}>
            <Icon name="image" size={14} />
            整段推送生图
          </button>
          {videoPushTitle ? (
            <button type="button" className="message-video-push" title={videoPushTitle} onClick={onPushVideo}>
              <Icon name="video" size={14} />
              推送到视频
            </button>
          ) : null}
        </>
      )}
      <button type="button" className="message-delete" title="批量删除消息" aria-label="批量删除消息" onClick={onDelete}>
        <Icon name="trash" size={14} />
        <span>删除</span>
      </button>
    </div>
  );
}
