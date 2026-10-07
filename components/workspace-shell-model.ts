export function workspaceShellClassName(section: string, sidebarOpen: boolean) {
  return [
    'app-shell',
    section === 'angle' ? 'angle-app-shell' : '',
    section === 'video' ? 'video-app-shell' : '',
    sidebarOpen ? 'sidebar-is-open' : '',
  ].filter(Boolean).join(' ');
}
