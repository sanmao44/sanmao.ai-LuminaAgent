import type { ChangeEvent, ComponentType, KeyboardEvent } from 'react';

type IconProps = { name: string; size?: number };

export type ChatHistorySession = {
  id: string;
  title: string;
  updatedAt: number;
  messages: Array<{ content: string }>;
  persona?: string;
};

type SidebarChatHistoryProps = {
  visible: boolean;
  sessions: ChatHistorySession[];
  filteredSessions: ChatHistorySession[];
  personaChatCount: number;
  personaOnly: boolean;
  search: string;
  selectionMode: boolean;
  selectedIds: Set<string>;
  allSelected: boolean;
  activeChatId: string | null;
  busyChatIds: string[];
  renamingChatId: string | null;
  renamingChatTitle: string;
  Icon: ComponentType<IconProps>;
  formatTime: (timestamp: number) => string;
  historyGroupLabel: (timestamp: number) => string;
  personaBadgeLabel: (persona?: string) => string;
  onTogglePersonaFilter: () => void;
  onSearchChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearSearch: () => void;
  onToggleSelectionMode: () => void;
  onOpenSession: (session: ChatHistorySession) => void;
  onBeginRename: (session: ChatHistorySession) => void;
  onRenameTitleChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onCommitRename: (session: ChatHistorySession) => void;
  onCancelRename: () => void;
  onToggleSessionSelection: (id: string) => void;
  onDeleteSession: (session: ChatHistorySession) => void;
  onToggleAll: () => void;
  onDeleteSelected: () => void;
};

/** Assistant history boundary; persistence and session actions stay in Page. */
export default function SidebarChatHistory({
  visible,
  sessions,
  filteredSessions,
  personaChatCount,
  personaOnly,
  search,
  selectionMode,
  selectedIds,
  allSelected,
  activeChatId,
  busyChatIds,
  renamingChatId,
  renamingChatTitle,
  Icon,
  formatTime,
  historyGroupLabel,
  personaBadgeLabel,
  onTogglePersonaFilter,
  onSearchChange,
  onClearSearch,
  onToggleSelectionMode,
  onOpenSession,
  onBeginRename,
  onRenameTitleChange,
  onCommitRename,
  onCancelRename,
  onToggleSessionSelection,
  onDeleteSession,
  onToggleAll,
  onDeleteSelected,
}: SidebarChatHistoryProps) {
  if (!visible) return null;

  return (
    <>
      <div className="chat-history-head">
        <span>助手历史</span>
        <div>
          {personaChatCount > 0 && (
            <button
              type="button"
              className={`chat-history-persona-filter ${personaOnly ? 'active' : ''}`}
              onClick={onTogglePersonaFilter}
              title={personaOnly ? '显示全部历史对话' : `只看带角色设定的对话（${personaChatCount} 段）`}
              aria-pressed={personaOnly ? 'true' : 'false'}
            >
              角色 {personaChatCount}
            </button>
          )}
          <b>{sessions.length || ''}</b>
          {sessions.length > 0 && (
            <button
              type="button"
              className={`chat-history-batch ${selectionMode ? 'active' : ''}`}
              onClick={onToggleSelectionMode}
              title={selectionMode ? '退出批量管理' : '管理历史对话'}
              aria-label={selectionMode ? '退出批量管理' : '管理历史对话'}
            >
              {selectionMode ? '完成' : '···'}
            </button>
          )}
        </div>
      </div>
      <div className="chat-history-search">
        <Icon name="search" size={14} />
        <input value={search} onChange={onSearchChange} placeholder="快速查找历史对话" />
        {search && <button type="button" onClick={onClearSearch}>清空</button>}
      </div>
      <div className="chat-history-list">
        {filteredSessions.length ? filteredSessions.map((session, index) => {
          const busy = busyChatIds.includes(session.id);
          const renaming = renamingChatId === session.id;
          const historyGroup = historyGroupLabel(session.updatedAt);
          const previousHistoryGroup = index > 0 ? historyGroupLabel(filteredSessions[index - 1].updatedAt) : '';
          const personaLabel = personaBadgeLabel(session.persona);
          return (
            <div key={session.id}>
              {historyGroup !== previousHistoryGroup && <div className="chat-history-group">{historyGroup}</div>}
              <div className={`chat-history-item ${activeChatId === session.id ? 'active' : ''} ${selectionMode ? 'selecting' : ''} ${renaming ? 'renaming' : ''}`}>
                {renaming ? (
                  <input
                    className="chat-history-rename"
                    value={renamingChatTitle}
                    maxLength={48}
                    autoFocus
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={onRenameTitleChange}
                    onBlur={() => void onCommitRename(session)}
                    onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.stopPropagation();
                        void onCommitRename(session);
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        onCancelRename();
                      }
                    }}
                  />
                ) : (
                  <button
                    className="chat-history-open"
                    title={personaLabel ? `角色设定：${personaLabel}（单击打开，双击重命名）` : '单击打开，双击重命名'}
                    onClick={() => selectionMode ? onToggleSessionSelection(session.id) : onOpenSession(session)}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      onBeginRename(session);
                    }}
                  >
                    <span>{session.title}</span>
                    <small className={busy ? 'busy' : ''}>
                      {personaLabel && <em className="chat-history-persona-tag">角色</em>}
                      {busy ? '正在回答…' : formatTime(session.updatedAt)}
                    </small>
                  </button>
                )}
                {selectionMode && (
                  <label className="chat-history-check" title={busy ? '正在回答，暂不能删除' : '选择这段对话'}>
                    <input type="checkbox" checked={selectedIds.has(session.id)} disabled={busy} onChange={() => onToggleSessionSelection(session.id)} />
                    <span />
                  </label>
                )}
                {!selectionMode && !renaming && (
                  <button className="chat-history-delete" title={busy ? '正在回答，暂不能删除' : '删除这段对话'} disabled={busy} onClick={() => onDeleteSession(session)}>
                    <Icon name="trash" size={13} />
                  </button>
                )}
              </div>
            </div>
          );
        }) : (
          <div className="chat-history-empty">
            {sessions.length ? personaOnly ? '没有找到带角色设定的对话' : '没有找到匹配的历史对话' : '对话会自动保存在这里'}
          </div>
        )}
      </div>
      {selectionMode && (
        <div className="chat-history-selection-bar">
          <button type="button" className="chat-history-select-all" onClick={onToggleAll}>{allSelected ? '取消全选' : '全选'}</button>
          <span>已选 {selectedIds.size} 段</span>
          <button type="button" className="chat-history-selection-delete" disabled={!selectedIds.size} onClick={() => void onDeleteSelected()}>
            <Icon name="trash" size={13} />
            删除所选
          </button>
        </div>
      )}
    </>
  );
}
