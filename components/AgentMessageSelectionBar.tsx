import type { ComponentType } from 'react';

type AgentMessageSelectionBarProps = {
  selectedCount: number;
  Icon: ComponentType<{ name: string; size?: number }>;
  onCancel: () => void;
  onDeleteSelected: () => void;
};

/** Message selection toolbar; selection state and deletion remain page-owned. */
export default function AgentMessageSelectionBar({ selectedCount, Icon, onCancel, onDeleteSelected }: AgentMessageSelectionBarProps) {
  return (
    <div className="agent-message-selection-bar">
      <span>已选择 <b>{selectedCount}</b> 条对话内容</span>
      <div>
        <button type="button" onClick={onCancel}>取消</button>
        <button type="button" className="danger" disabled={!selectedCount} onClick={onDeleteSelected}>
          <Icon name="trash" size={14} />
          删除所选
        </button>
      </div>
    </div>
  );
}
