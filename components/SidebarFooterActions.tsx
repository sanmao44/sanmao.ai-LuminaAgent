import type { ComponentType } from 'react';

type IconProps = { name: string; size?: number };

type SidebarFooterActionsProps = {
  sidebarOpen: boolean;
  imageModelCount: number;
  chatModelCount: number;
  videoModelCount: number;
  Icon: ComponentType<IconProps>;
  onOpenModels: () => void;
  onOpenSupport: () => void;
};

/** Responsive sidebar footer for model status and support entry points. */
export default function SidebarFooterActions({
  sidebarOpen,
  imageModelCount,
  chatModelCount,
  videoModelCount,
  Icon,
  onOpenModels,
  onOpenSupport,
}: SidebarFooterActionsProps) {
  const modelCount = imageModelCount + chatModelCount + videoModelCount;
  const modelTitle = `${imageModelCount} 图片 · ${chatModelCount} 对话 · ${videoModelCount} 视频`;
  const supportButton = (
    <button className="sidebar-support-button" type="button" onClick={onOpenSupport} title="交流与支持" aria-label="打开交流与支持">
      <Icon name="support" size={15} /><span>支持</span>
    </button>
  );
  return (
    <>
      {sidebarOpen && (
        <div className="sidebar-footer-actions">
          <button type="button" className="sidebar-model-status" onClick={onOpenModels} title={modelTitle}>
            <span className={`status-dot ${modelCount ? 'online' : ''}`} />
            <span>{modelCount} 个模型</span>
            <Icon name="chevron" size={13} />
          </button>
          {supportButton}
        </div>
      )}
      <button className="support-rail-button" type="button" onClick={onOpenSupport} aria-label="交流与支持" data-tooltip="交流与支持">
        <span className="support-rail-icon">✦</span><span>交流与支持</span>
      </button>
    </>
  );
}
