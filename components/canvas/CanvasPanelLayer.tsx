"use client";

import type { AssetRecord } from "@/lib/assets";
import type { CanvasActivityLog } from "@/lib/canvas/activity-log";
import type { CanvasConnectionStyle, CanvasDocument, CanvasNodeCreationKind } from "@/lib/canvas/types";
import type { DepthQuality } from "@/lib/canvas/depth-settings";
import type { AutoProjectCheckpointIntervalMinutes } from "@/lib/canvas/auto-project-checkpoint";
import type { GenerationLog } from "@/lib/generation-log";
import type { CanvasVideoRetryResult } from "@/lib/canvas/batch-video-retry";
import type { CanvasUpscaleRetryResult } from "@/lib/canvas/batch-upscale-retry";
import type { CreativeProjectBrief } from "@/packages/contracts/creative";
import CanvasActivityDrawer from "@/components/canvas/CanvasActivityDrawer";
import CanvasAssetDrawer from "@/components/canvas/CanvasAssetDrawer";
import type { CanvasPanel } from "@/components/canvas/CanvasWorkspaceHeader";
import { CanvasSettingsPanel, CanvasShortcutsPanel } from "@/components/canvas/CanvasPanels";

export type CanvasPanelLayerProps = {
  activePanel: CanvasPanel | null;
  canvasAssets: AssetRecord[];
  creativeProjectId?: string;
  projectName: string;
  projectBrief: CreativeProjectBrief | null;
  projectVersionCount: number;
  assetRefresh: number;
  assetLibraryCollectionId: string;
  canReferenceAssets: boolean;
  generationLogs: GenerationLog[];
  activityLogs: CanvasActivityLog[];
  canvasDocument: CanvasDocument;
  canvasId?: string;
  generationLogsLoading: boolean;
  theme: "light" | "dark";
  connectionStyle: CanvasConnectionStyle;
  edgesVisible: boolean;
  depthQuality: DepthQuality;
  autoCheckpointIntervalMinutes: AutoProjectCheckpointIntervalMinutes;
  activityPanelScrollTop: number | null;
  onCollectionSelectionChange: (collectionId: string) => void;
  onAddAsset: (asset: AssetRecord) => void;
  onReferenceAsset: (asset: AssetRecord) => void;
  projectReferenceAssetIds?: readonly string[];
  onSetProjectReference: (asset: AssetRecord) => void;
  onLocateAsset: (asset: AssetRecord) => void;
  onAddNodeToCollection: (nodeId: string, collectionId: string) => void;
  onRefreshGenerationLogs: () => void;
  onFocusTask: (log: GenerationLog, openMedia?: boolean) => void;
  onFocusNode: (nodeId: string, openMedia?: boolean) => void;
  onRestoreTaskContext: (log: GenerationLog) => void;
  onPreserveAudioDraft: (log: GenerationLog) => void;
  onCheckTaskRecord: (log: GenerationLog) => Promise<void>;
  onRetryTask: (log: GenerationLog) => Promise<void>;
  onBatchRetryVideoTasks: (
    logs: GenerationLog[],
    onProgress: (completed: number, total: number) => void,
  ) => Promise<CanvasVideoRetryResult>;
  onBatchRetryUpscaleTasks: (
    logs: GenerationLog[],
    onProgress: (completed: number, total: number) => void,
  ) => Promise<CanvasUpscaleRetryResult>;
  onContinueTask: (log: GenerationLog) => void;
  onCancelTask: (log: GenerationLog) => Promise<void>;
  cancellableCanvasTaskIds: ReadonlySet<string>;
  onRememberActivityScroll: (scrollTop: number) => void;
  canvasNodeIds: ReadonlySet<string>;
  canvasTaskIds: ReadonlySet<string>;
  onNotify: (message: string, kind?: "ok" | "error") => void;
  onClose: () => void;
  onOpenAssetWorkbench: () => void;
  onTheme: () => void;
  onConnectionStyleChange: (value: CanvasConnectionStyle) => void;
  onEdgesVisibleChange: (value: boolean) => void;
  onDepthQualityChange: (value: DepthQuality) => void;
  onAutoCheckpointIntervalMinutesChange: (value: AutoProjectCheckpointIntervalMinutes) => void;
  onExportWorkflow: () => void;
  onExportProjectPackage: () => void;
  onOpenProjectBrief: () => void;
  onDraftProject: () => void;
  onCreateProjectNode: (kind: CanvasNodeCreationKind, sourceNodeIds?: string[]) => void;
  onSaveProjectVersion: () => void;
  onImportWorkflow: () => void;
  onScaffoldProject: () => void;
};

/** Composes the existing canvas side panels without owning their state or actions. */
export default function CanvasPanelLayer({
  activePanel,
  canvasAssets,
  creativeProjectId,
  projectName,
  projectBrief,
  projectVersionCount,
  assetRefresh,
  assetLibraryCollectionId,
  canReferenceAssets,
  generationLogs,
  activityLogs,
  canvasDocument,
  canvasId,
  generationLogsLoading,
  theme,
  connectionStyle,
  edgesVisible,
  depthQuality,
  autoCheckpointIntervalMinutes,
  activityPanelScrollTop,
  onCollectionSelectionChange,
  onAddAsset,
  onReferenceAsset,
  projectReferenceAssetIds,
  onSetProjectReference,
  onLocateAsset,
  onAddNodeToCollection,
  onRefreshGenerationLogs,
  onFocusTask,
  onFocusNode,
  onRestoreTaskContext,
  onPreserveAudioDraft,
  onCheckTaskRecord,
  onRetryTask,
  onBatchRetryVideoTasks,
  onBatchRetryUpscaleTasks,
  onContinueTask,
  onCancelTask,
  cancellableCanvasTaskIds,
  onRememberActivityScroll,
  canvasNodeIds,
  canvasTaskIds,
  onNotify,
  onClose,
  onOpenAssetWorkbench,
  onTheme,
  onConnectionStyleChange,
  onEdgesVisibleChange,
  onDepthQualityChange,
  onAutoCheckpointIntervalMinutesChange,
  onExportWorkflow,
  onExportProjectPackage,
  onOpenProjectBrief,
  onDraftProject,
  onCreateProjectNode,
  onSaveProjectVersion,
  onImportWorkflow,
  onScaffoldProject,
}: CanvasPanelLayerProps) {
  if (activePanel === "assets") {
    return (
      <CanvasAssetDrawer
        extraAssets={canvasAssets}
        creativeProjectId={creativeProjectId}
        refresh={assetRefresh}
        collectionSelection={assetLibraryCollectionId}
        onCollectionSelectionChange={onCollectionSelectionChange}
        canReference={canReferenceAssets}
        onAdd={onAddAsset}
        onReference={onReferenceAsset}
        projectReferenceAssetIds={projectReferenceAssetIds}
        onSetProjectReference={onSetProjectReference}
        onLocate={onLocateAsset}
        onAddNodeToCollection={onAddNodeToCollection}
        onClose={onClose}
        onOpenWorkbench={onOpenAssetWorkbench}
        onNotify={onNotify}
      />
    );
  }

  if (activePanel === "activity") {
    return (
      <CanvasActivityDrawer
        taskLogs={generationLogs}
        activityLogs={activityLogs}
        canvasDocument={canvasDocument}
        loading={generationLogsLoading}
        onRefresh={onRefreshGenerationLogs}
        onFocusTask={onFocusTask}
        onFocusNode={onFocusNode}
        onRestoreTaskContext={onRestoreTaskContext}
        onPreserveAudioDraft={onPreserveAudioDraft}
        onCheckTaskRecord={onCheckTaskRecord}
        onRetryTask={onRetryTask}
        onBatchRetryVideoTasks={onBatchRetryVideoTasks}
        onBatchRetryUpscaleTasks={onBatchRetryUpscaleTasks}
        onContinueTask={onContinueTask}
        onCancelTask={onCancelTask}
        cancellableCanvasTaskIds={cancellableCanvasTaskIds}
        onClose={onClose}
        onNotify={onNotify}
        restoreScrollTop={activityPanelScrollTop}
        onRememberScrollPosition={onRememberActivityScroll}
        creativeProjectId={creativeProjectId}
        projectName={projectName}
        projectBrief={projectBrief}
        projectVersionCount={projectVersionCount}
        canvasId={canvasId}
        canvasNodeIds={canvasNodeIds}
        canvasTaskIds={canvasTaskIds}
        onOpenProjectBrief={onOpenProjectBrief}
        onDraftProject={onDraftProject}
        onCreateProjectNode={onCreateProjectNode}
        onSaveProjectVersion={onSaveProjectVersion}
        onExportProjectPackage={onExportProjectPackage}
        onScaffoldProject={onScaffoldProject}
      />
    );
  }

  if (activePanel === "settings") {
    return (
      <CanvasSettingsPanel
        theme={theme}
        connectionStyle={connectionStyle}
        edgesVisible={edgesVisible}
        depthQuality={depthQuality}
        autoCheckpointIntervalMinutes={autoCheckpointIntervalMinutes}
        onTheme={onTheme}
        onConnectionStyleChange={onConnectionStyleChange}
        onEdgesVisibleChange={onEdgesVisibleChange}
        onDepthQualityChange={onDepthQualityChange}
        onAutoCheckpointIntervalMinutesChange={onAutoCheckpointIntervalMinutesChange}
        onExportWorkflow={onExportWorkflow}
        onExportProjectPackage={onExportProjectPackage}
        onImportWorkflow={onImportWorkflow}
        onClose={onClose}
      />
    );
  }

  if (activePanel === "shortcuts") return <CanvasShortcutsPanel onClose={onClose} />;
  return null;
}
