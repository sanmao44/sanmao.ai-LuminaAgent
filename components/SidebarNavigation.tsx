import type { ComponentType } from 'react';

type IconProps = { name: string; size?: number };

type SidebarNavigationProps = {
  section: string;
  sidebarOpen: boolean;
  managementNavOpen: boolean;
  historyNotice: boolean;
  logErrorNotice: boolean;
  Icon: ComponentType<IconProps>;
  onSection: (section: string) => void;
  onRecordClick: () => void;
  onToggleManagement: () => void;
};

/** Sidebar navigation boundary; chat history and footer actions remain separate. */
export default function SidebarNavigation({
  section,
  sidebarOpen,
  managementNavOpen,
  historyNotice,
  logErrorNotice,
  Icon,
  onSection,
  onRecordClick,
  onToggleManagement,
}: SidebarNavigationProps) {
  return (
    <>
      <div className="nav-caption image-tools-caption">创作</div>
      <nav className="main-nav image-tools-nav">
        <button aria-label="角度控制台" data-tooltip="角度控制台" className={section === 'angle' ? 'active' : ''} onClick={() => onSection('angle')}>
          <Icon name="adjust" /><span>角度控制台</span>
        </button>
        <button aria-label={historyNotice ? '创作记录，有新的作品' : logErrorNotice ? '创作记录，有失败任务' : '创作记录'} data-tooltip="创作记录" className={`${section === 'history' || section === 'logs' ? 'active' : ''} history-priority`} onClick={onRecordClick}>
          <Icon name="history" /><span>创作记录</span>
          {(historyNotice || logErrorNotice) && <i className={logErrorNotice ? 'nav-notice-dot error' : 'nav-notice-dot success'} aria-hidden="true" />}
        </button>
      </nav>
      <button type="button" className={`nav-caption nav-section-toggle ${managementNavOpen ? 'open' : ''}`} onClick={onToggleManagement} aria-expanded={managementNavOpen} aria-controls="sidebar-management-nav">
        <span>管理与设置</span><Icon name="chevron" size={14} />
      </button>
      {(!sidebarOpen || managementNavOpen) && (
        <nav id="sidebar-management-nav" className="main-nav management-nav">
          <button aria-label="模型库" data-tooltip="模型库" className={section === 'models' ? 'active' : ''} onClick={() => onSection('models')}><Icon name="model" /><span>模型库</span></button>
          <button aria-label="接口服务商" data-tooltip="接口服务商" className={section === 'providers' ? 'active' : ''} onClick={() => onSection('providers')}><Icon name="plug" /><span>接口服务商</span></button>
          <button aria-label="设置" data-tooltip="设置" className={section === 'settings' ? 'active' : ''} onClick={() => onSection('settings')}><Icon name="settings" /><span>设置</span></button>
        </nav>
      )}
    </>
  );
}
