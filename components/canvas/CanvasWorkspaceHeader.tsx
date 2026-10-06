"use client";

import { useState } from "react";
import AgentOrb, { busyOrbState } from "@/components/AgentOrb";
import type { CanvasProject } from "@/lib/canvas/types";
import type { CreativeProjectVersion } from "@/lib/creative-projects";
import type { WorkspaceSyncStatus } from "@/lib/workspace";

export type CanvasPanel = "assets" | "activity" | "settings" | "shortcuts";

export type CanvasWorkspaceHeaderProps = {
  currentProject?: CanvasProject; projects: CanvasProject[]; activeProjectId: string; projectMenuOpen: boolean; onProjectMenuOpenChange: (open: boolean) => void;
  topbarCollapsed: boolean; onToggleTopbar: () => void; canUndo: boolean; canRedo: boolean; onNavigateHome: () => void; onUndo: () => void; onRedo: () => void;
  snapEnabled: boolean; onToggleSnap: () => void; onOpenFilePicker: () => void; activePanel: CanvasPanel | null; onTogglePanel: (panel: CanvasPanel) => void;
  onToggleAssetLibrary: () => void; agentDockOpen: boolean; agentDockBusy: boolean; onToggleAgentDock: () => void; theme: "light" | "dark"; onToggleTheme: () => void;
  saving: boolean; saveError: boolean; workspaceSyncStatus: WorkspaceSyncStatus; onOpenProject: (projectId: string) => void; onNewProject: () => void; onSaveProjectVersion: () => void;
  projectVersions: CreativeProjectVersion[]; onRestoreProjectVersion: (versionId: string) => void; onDeleteProjectVersion: (versionId: string) => void; onDeleteProject: (projectId: string) => void;
  onSaveProjectName: (name: string) => boolean;
};

export default function CanvasWorkspaceHeader({currentProject, projects, activeProjectId, projectMenuOpen, onProjectMenuOpenChange, topbarCollapsed, onToggleTopbar, canUndo, canRedo, onNavigateHome, onUndo, onRedo, snapEnabled, onToggleSnap, onOpenFilePicker, activePanel, onTogglePanel, onToggleAssetLibrary, agentDockOpen, agentDockBusy, onToggleAgentDock, theme, onToggleTheme, saving, saveError, workspaceSyncStatus, onOpenProject, onNewProject, onSaveProjectVersion, projectVersions, onRestoreProjectVersion, onDeleteProjectVersion, onDeleteProject, onSaveProjectName}: CanvasWorkspaceHeaderProps) {
  const [projectRename, setProjectRename] = useState(false);
  const [projectRenameValue, setProjectRenameValue] = useState("");
  const saveProjectName = () => {
    if (onSaveProjectName(projectRenameValue)) setProjectRename(false);
  };
  return (<>
      <header className={`canvas-topbar ${topbarCollapsed ? "collapsed" : ""}`}>
        <div className="canvas-topbar-main">
          <button
            type="button"
            className={`canvas-brand ${projectMenuOpen ? "open" : ""}`}
            aria-haspopup="menu"
            aria-expanded={projectMenuOpen}
            aria-label={`编辑画布：${currentProject?.name || "无限画布"}，点击切换画布项目`}
            title="编辑画布 · 点击切换或新建画布"
            onClick={(event) => {
              event.stopPropagation();
              onProjectMenuOpenChange(!projectMenuOpen);
            }}
          >
            <span className="canvas-logo-mark">
              <img src="/brand-mark.png" alt="" />
            </span>
            <span className="canvas-brand-copy">
              <b>SANMAO.AI</b>
              <small className="canvas-brand-workspace">
                <span className="canvas-brand-workspace-mark" aria-hidden="true">✦</span>
                <span className="canvas-brand-workspace-label">编辑画布</span>
                <span className="canvas-brand-workspace-divider" aria-hidden="true">·</span>
                <span className="canvas-brand-project-name">{currentProject?.name || "无限画布"}</span>
              </small>
            </span>
            <span className={`canvas-brand-chevron ${projectMenuOpen ? "open" : ""}`} aria-hidden="true">
              <svg className="canvas-brand-chevron-icon" viewBox="0 0 20 20" focusable="false">
                <path d="M5.25 7.5 10 12.25 14.75 7.5" />
                <path d="M6.5 4.25h7" />
              </svg>
            </span>
          </button>
          <button
            type="button"
            className="canvas-soft-button canvas-home-button"
            aria-label="返回主界面"
            onClick={() => onNavigateHome()}
          >
            <span className="canvas-home-icon" aria-hidden="true">
              <svg viewBox="0 0 18 18" focusable="false">
                <path d="M8 4.5 4.5 8 8 11.5" />
                <path d="M4.8 8H13.5" />
              </svg>
            </span>
            <span className="canvas-home-label">主界面</span>
          </button>
          <span className="canvas-separator" />
          <button
            type="button"
            className="canvas-icon-button"
            onClick={onUndo}
            disabled={!canUndo}
          >
            ↶
          </button>
          <button
            type="button"
            className="canvas-icon-button"
            onClick={onRedo}
            disabled={!canRedo}
          >
            ↷
          </button>
          <button
            type="button"
            className={`canvas-soft-button canvas-snap-button ${snapEnabled ? "active" : ""}`}
            aria-pressed={snapEnabled}
            aria-label={`节点吸附${snapEnabled ? "已开启" : "已关闭"}`}
            title={`${snapEnabled ? "关闭" : "开启"}节点吸附：拖动节点时自动对齐边缘和中心线`}
            onClick={onToggleSnap}
          >
            ⌖ 吸附 {snapEnabled ? "开" : "关"}
          </button>
          <span className="canvas-separator" />
          <button
            type="button"
            className="canvas-soft-button canvas-import-button"
            onClick={onOpenFilePicker}
          >
            ＋ 导入素材
          </button>
          {!topbarCollapsed && <button
            type="button"
            className={`canvas-soft-button canvas-shortcuts-button ${activePanel === "shortcuts" ? "active" : ""}`}
            onClick={() => onTogglePanel("shortcuts")}
          >
            ⌨ 快捷键
          </button>}
          {!topbarCollapsed && <button
            type="button"
            className={`canvas-soft-button canvas-settings-button ${activePanel === "settings" ? "active" : ""}`}
            onClick={() => onTogglePanel("settings")}
          >
            ⚙ 设置
          </button>}
          {!topbarCollapsed && <>
          <button
            type="button"
            className={`canvas-soft-button canvas-panel-button canvas-assets-button ${activePanel === "assets" ? "active" : ""}`}
            aria-keyshortcuts="A"
            title="资产库（A）"
            onClick={onToggleAssetLibrary}
          >
            ◈ 资产
          </button>
          <button
            type="button"
            className={`canvas-soft-button canvas-panel-button canvas-activity-button ${activePanel === "activity" ? "active" : ""}`}
            onClick={() => onTogglePanel("activity")}
          >
            ≡ 日志
          </button>
          <button
            type="button"
            className={`canvas-soft-button canvas-panel-button canvas-agent-button ${agentDockOpen ? "active" : ""}${agentDockBusy ? " is-busy" : ""}`}
            aria-pressed={agentDockOpen}
            aria-keyshortcuts="Control+K"
            title={agentDockBusy ? "Agent 正在生成，点开面板查看或停止" : "Agent 助手：右侧面板，可读取选中节点并生成到画布（Ctrl/Cmd + K）"}
            onClick={onToggleAgentDock}
          >
            <AgentOrb state={busyOrbState(agentDockBusy)} size={16} label="" />
            Agent
            {agentDockBusy ? <i aria-hidden="true" /> : null}
          </button>
          </>}
          {!topbarCollapsed && <button
            type="button"
            className="canvas-soft-button canvas-theme-button"
            onClick={onToggleTheme}
            aria-label={theme === "light" ? "切换深色界面" : "切换浅色界面"}
            title={theme === "light" ? "切换深色界面" : "切换浅色界面"}
          >
            {theme === "light" ? "☾ 深色" : "☀ 浅色"}
          </button>}
          <div className="canvas-topbar-spacer" />
          <span
            className={`canvas-save-state ${saving ? "saving" : saveError ? "error" : ""}`}
          >
            <i />
            {saving ? "保存中…" : saveError ? "保存失败" : "已保存"}
          </span>
          <span className={`canvas-workspace-sync-state ${workspaceSyncStatus}`} title="同台电脑跨浏览器工作区同步状态">
            <i />
            {workspaceSyncStatus === "syncing" ? "同步中…" : workspaceSyncStatus === "offline" ? "离线待同步" : workspaceSyncStatus === "conflict" ? "存在冲突，请刷新" : workspaceSyncStatus === "error" ? "同步失败" : workspaceSyncStatus === "synced" ? "已同步" : "准备同步"}
          </span>
        </div>
        <button
          type="button"
          className="canvas-topbar-toggle"
          aria-label={topbarCollapsed ? "展开顶部工具栏" : "收起顶部工具栏"}
          title={topbarCollapsed ? "展开顶部工具栏" : "收起顶部工具栏"}
          onClick={onToggleTopbar}
        >
          <span className="canvas-topbar-toggle-icon" aria-hidden="true">{topbarCollapsed ? "⌄" : "⌃"}</span>
          <span>{topbarCollapsed ? "展开工具栏" : "收起"}</span>
        </button>
      </header>
      {projectMenuOpen && (
        <div className="canvas-project-popover-wrap">
          <div
            className="canvas-project-popover"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="canvas-popover-title">我的画布项目</div>
            {projects.map((project) => (
              <div
                className={`canvas-project-row ${project.id === activeProjectId ? "active" : ""}`}
                key={project.id}
              >
                <button type="button" onClick={() => onOpenProject(project.id)}>
                  <span className="canvas-project-dot">✦</span>
                  <span>
                    <b>{project.name}</b>
                    <small>{new Date(project.updatedAt).toLocaleDateString("zh-CN")}</small>
                  </span>
                </button>
                {project.id === activeProjectId && <i>✓</i>}
              </div>
            ))}
            <div className="canvas-project-versions">
              <div className="canvas-project-versions-head">
                <span>项目版本</span>
                <button type="button" onClick={onSaveProjectVersion} disabled={!currentProject}>保存当前版本</button>
              </div>
              {projectVersions.length ? (
                <div className="canvas-project-version-list">
                  {projectVersions.slice().reverse().map((version) => (
                    <div className="canvas-project-version-row" key={version.id}>
                      <button
                        type="button"
                        className="canvas-project-version-restore"
                        onClick={() => onRestoreProjectVersion(version.id)}
                      >
                        <b>{version.label}</b>
                        <small>{new Date(version.createdAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}</small>
                      </button>
                      <button
                        type="button"
                        className="canvas-project-version-delete"
                        aria-label={`删除 ${version.label}`}
                        title={`删除 ${version.label}`}
                        onClick={() => onDeleteProjectVersion(version.id)}
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    </div>
                  ))}
                </div>
              ) : <small className="canvas-project-versions-empty">保存后可从这里恢复项目版本</small>}
            </div>
            <div className="canvas-popover-actions">
              <button type="button" onClick={onNewProject}>＋ 新建画布</button>
              <button
                type="button"
                onClick={() => {
                  setProjectRenameValue(currentProject?.name || ""); setProjectRename(true);

                }}
              >
                重命名
              </button>
              <button
                type="button"
                className="canvas-popover-danger"
                title="删除当前画布"
                onClick={() => {
                  if (activeProjectId) onDeleteProject(activeProjectId);
                }}
              >
                删除
              </button>
            </div>
            {projectRename && (
              <div className="canvas-rename-row">
                <input
                  value={projectRenameValue}
                  onChange={(event) => setProjectRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveProjectName();
                    if (event.key === "Escape") setProjectRename(false);
                  }}
                  autoFocus
                />
                <button type="button" onClick={saveProjectName}>保存</button>
              </div>
            )}
          </div>
        </div>
      )}
  </>);
}
