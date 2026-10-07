import type { ComponentType } from 'react';
import type { AgentMcpToolUse } from '@/lib/agent-client';

type AgentMcpDetailDockProps = {
  tools: AgentMcpToolUse[];
  Icon: ComponentType<{ name: string; size?: number }>;
  onClose: () => void;
};

/** MCP execution summary below the composer; active message selection stays page-owned. */
export default function AgentMcpDetailDock({ tools, Icon, onClose }: AgentMcpDetailDockProps) {
  return (
    <section className="agent-mcp-detail-dock" aria-label="外部工具调用记录">
      <div className="message-mcp-detail-panel">
        <div className="message-mcp-detail-head">
          <span>本轮外部工具调用 {tools.length} 次</span>
          <button type="button" className="message-mcp-detail-close" title="关闭调用记录" aria-label="关闭调用记录" onClick={onClose}>
            <Icon name="close" size={13} />
          </button>
        </div>
        <ul className="message-mcp-detail-list">
          {tools.map((tool, index) => (
            <li className={tool.ok ? 'is-ok' : 'is-failed'} key={`mcp-${index}`}>
              <b>{tool.server}</b>
              <code>{tool.name}</code>
              <span className="message-mcp-detail-tag">{tool.readOnly ? '只读' : '写入'}</span>
              <span className="message-mcp-detail-state">{tool.ok ? '已完成' : '失败'}</span>
            </li>
          ))}
        </ul>
        <small className="message-mcp-detail-note">写入类操作要先经你确认才会执行；被拒绝的调用不计入这里。</small>
      </div>
    </section>
  );
}
