import type { ComponentType } from 'react';
import { sidebarToggleLabel } from './sidebar-brand-header-model';

type IconProps = { name: string; size?: number };

type SidebarBrandHeaderProps = {
  sidebarOpen: boolean;
  Icon: ComponentType<IconProps>;
  onToggle: () => void;
  onBrandClick: () => void;
};

/** Stable sidebar chrome; chat history and feature navigation remain page-owned. */
export default function SidebarBrandHeader({ sidebarOpen, Icon, onToggle, onBrandClick }: SidebarBrandHeaderProps) {
  return (
    <div className="sidebar-head">
      <button type="button" className="sidebar-toggle" aria-label={sidebarToggleLabel(sidebarOpen)} aria-expanded={sidebarOpen} onClick={onToggle}>
        <Icon name={sidebarOpen ? 'close' : 'menu'} size={18} />
      </button>
      <button className="sidebar-brand" onClick={onBrandClick}>
        <span className="brand-mark"><img src="/brand-mark.png" alt="" /></span>
        <span>SANMAO.AI</span>
      </button>
    </div>
  );
}
