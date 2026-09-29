import type { ComponentType } from 'react';
import Link from 'next/link';
import { workspaceTopbarModes } from './workspace-topbar-model';

type IconProps = { name: string; size?: number };

type WorkspaceTopbarProps = {
  section: string;
  sidebarOpen: boolean;
  theme: 'light' | 'dark';
  Icon: ComponentType<IconProps>;
  onOpenSidebar: () => void;
  onGoAgent: () => void;
  onGoGenerate: () => void;
  onGoVideo: () => void;
  onToggleTheme: () => void;
  onCanvasClick: () => void;
};

/** Shared page navigation bar. Feature state stays in the page composition root. */
export default function WorkspaceTopbar({
  section,
  sidebarOpen,
  theme,
  Icon,
  onOpenSidebar,
  onGoAgent,
  onGoGenerate,
  onGoVideo,
  onToggleTheme,
  onCanvasClick,
}: WorkspaceTopbarProps) {
  const { imageActive, videoActive, agentActive } = workspaceTopbarModes(section);
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button type="button" className="mobile-sidebar-toggle" aria-label="打开导航" aria-expanded={sidebarOpen} onClick={onOpenSidebar}>
          <Icon name="menu" size={18} />
        </button>
        <button type="button" className="topbar-brand" onClick={onGoAgent}>
          <span className="topbar-brand-mark"><img src="/brand-mark.png" alt="" /></span>
          <strong>SANMAO.AI</strong>
        </button>
      </div>
      <nav className="top-mode-nav" aria-label="创作类型">
        <button type="button" className={imageActive ? 'active' : ''} aria-pressed={imageActive} onClick={onGoGenerate}>
          <Icon name="image" size={15} /><span>图片</span>
        </button>
        <button type="button" className={videoActive ? 'active' : ''} aria-label="视频工作台" aria-pressed={videoActive} onClick={onGoVideo}>
          <Icon name="video" size={15} /><span>视频</span>
        </button>
        <button type="button" className="coming-soon-mode" aria-label="音频，即将上线" disabled title="音频工作台即将上线">
          <Icon name="audio" size={15} /><span>音频</span><small className="mode-status">即将上线</small>
        </button>
        <button type="button" className={agentActive ? 'active' : ''} aria-pressed={agentActive} onClick={onGoAgent}>
          <Icon name="agent" size={15} /><span>Agent</span>
        </button>
      </nav>
      <div className="top-actions">
        <Link href="/canvas" className="super-canvas-entry" aria-label="超级画布" data-tooltip="超级画布 · 无限画布" onClick={onCanvasClick}>
          <Icon name="canvas" size={16} /><span>超级画布</span><small className="super-canvas-entry-badge">NEW</small>
        </Link>
        <button type="button" className="theme-toggle" aria-label={theme === 'light' ? '切换深色主题' : '切换浅色主题'} onClick={onToggleTheme}>
          <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} /><span>{theme === 'light' ? '深色' : '浅色'}</span>
        </button>
      </div>
    </header>
  );
}
