import type { ReactNode } from 'react';
import { workspaceShellClassName } from './workspace-shell-model';

type WorkspaceShellProps = {
  section: string;
  sidebarOpen: boolean;
  children: ReactNode;
};

/** Page composition boundary for the shared navigation and workspace shell. */
export default function WorkspaceShell({ section, sidebarOpen, children }: WorkspaceShellProps) {
  return <main className={workspaceShellClassName(section, sidebarOpen)}>{children}</main>;
}
