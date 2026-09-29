import type { ComponentType } from 'react';
import AgentMemoryEditor from '@/components/AgentMemoryEditor';
import AgentPersonaEditor from '@/components/AgentPersonaEditor';
import SkillManager from '@/components/SkillManager';
import SkillIcon from '@/components/SkillIcon';
import McpManager from '@/components/McpManager';
import McpIcon from '@/components/McpIcon';

type AgentContextDockProps = {
  activeChatId: string | null;
  activeAgentBusy: boolean;
  memorySummary: string;
  persona: string;
  agentPersonaDraft: string;
  hasMessages: boolean;
  shareSelectionMode: boolean;
  shareBusy: boolean;
  selectedShareGroups: number;
  selectableShareGroups: number;
  allShareGroupsSelected: boolean;
  selectedShareMessages: number;
  hasPendingMessages: boolean;
  Icon: ComponentType<{ name: string; size?: number }>;
  onSaveMemory: (summary: string) => Promise<void>;
  onSavePersona: (persona: string) => Promise<void>;
  onBeginShareSelection: () => void;
  onToggleAllShareGroups: () => void;
  onClearShareGroupSelection: () => void;
  onResetShareSelection: () => void;
  onShareConversation: () => void;
};

/** Agent context tools boundary; data persistence and share orchestration stay in Page. */
export default function AgentContextDock({
  activeChatId,
  activeAgentBusy,
  memorySummary,
  persona,
  agentPersonaDraft,
  hasMessages,
  shareSelectionMode,
  shareBusy,
  selectedShareGroups,
  selectableShareGroups,
  allShareGroupsSelected,
  selectedShareMessages,
  hasPendingMessages,
  Icon,
  onSaveMemory,
  onSavePersona,
  onBeginShareSelection,
  onToggleAllShareGroups,
  onClearShareGroupSelection,
  onResetShareSelection,
  onShareConversation,
}: AgentContextDockProps) {
  return (
    <div className="agent-memory-dock">
      <div className="agent-context-tools">
        {activeChatId && (
          <AgentMemoryEditor
            summary={memorySummary}
            disabled={activeAgentBusy}
            icon={<Icon name="brain" size={16} />}
            onSave={onSaveMemory}
          />
        )}
        <AgentPersonaEditor
          persona={activeChatId ? persona : agentPersonaDraft}
          disabled={activeAgentBusy}
          icon={<Icon name="user" size={16} />}
          onSave={onSavePersona}
        />
        <SkillManager disabled={activeAgentBusy} icon={<SkillIcon size={16} />} />
        <McpManager disabled={activeAgentBusy} icon={<McpIcon size={16} />} />
        {hasMessages && !shareSelectionMode && (
          <button
            type="button"
            className="conversation-share-entry"
            disabled={shareBusy || !selectableShareGroups}
            onClick={onBeginShareSelection}
            title={!selectableShareGroups ? '当前还没有可分享的已完成问答组' : '选择要分享的问答组'}
          >
            <Icon name="share" size={14} />
            <span>分享</span>
          </button>
        )}
        {hasMessages && shareSelectionMode && (
          <div className="conversation-share-controls" role="toolbar" aria-label="分享内容选择">
            <span className="conversation-share-count">{selectedShareGroups}/{selectableShareGroups}</span>
            <button type="button" className="conversation-share-control" disabled={!selectableShareGroups} onClick={onToggleAllShareGroups}>{allShareGroupsSelected ? '取消全选' : '全选'}</button>
            <button type="button" className="conversation-share-control" disabled={!selectedShareGroups} onClick={onClearShareGroupSelection}>清空</button>
            <button type="button" className="conversation-share-control" onClick={onResetShareSelection}>取消</button>
            <button
              type="button"
              className="conversation-share-control primary"
              disabled={shareBusy || !selectedShareMessages || activeAgentBusy || hasPendingMessages}
              onClick={onShareConversation}
              title={!selectedShareMessages ? '请先选择要分享的问答组' : activeAgentBusy || hasPendingMessages ? '请等待当前回答完成后分享' : '预览选中的对话长图'}
            >
              {shareBusy ? '生成中…' : '预览'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
