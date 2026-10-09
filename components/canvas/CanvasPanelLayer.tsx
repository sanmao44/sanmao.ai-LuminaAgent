"use client";

import type { AssetRecord } from "@/lib/assets";
import type { CanvasActivityLog } from "@/lib/canvas/activity-log";
import type { CanvasConnectionStyle, CanvasDocument } from "@/lib/canvas/types";
import type { DepthQuality } from "@/lib/canvas/depth-settings";
import type { GenerationLog } from "@/lib/generation-log";
import CanvasActivityDrawer from "@/components/canvas/CanvasActivityDrawer";
import CanvasAssetDrawer from "@/components/canvas/CanvasAssetDrawer";
import type { CanvasPanel } from "@/components/canvas/CanvasWorkspaceHeader";
import { CanvasSettingsPanel, CanvasShortcutsPanel } from "@/components/canvas/CanvasPanels";

export type CanvasPanelLayerProps = {
  activePanel: CanvasPanel | null;
  canvasAssets: AssetRecord[];
  assetRefresh: number;
  assetLibraryCollectionId: string;
  canReferenceAssets: boolean;
  generationLogs: GenerationLog[];
  activityLogs: CanvasActivityLog[];
  canvasDocument: CanvasDocument;
  generationLogsLoading: boolean;
  theme: "light" | "dark";
  connectionStyle: CanvasConnectionStyle;
  depthQuality: DepthQuality;
  activityPanelScrollTop: number | null;
  onCollectionSelectionChange: (collectionId: string) => void;
  onAddAsset: (asset: AssetRecord) => void;
  onReferenceAsset: (asset: AssetRecord) => void;
  onLocateAsset: (asset: AssetRecord) => void;
  onAddNodeToCollection: (nodeId: string, collectionId: string) => void;
  onRefreshGenerationLogs: () => void;
  onFocusTask: (log: GenerationLog, openMedia?: boolean) => void;
  onFocusNode: (nodeId: string, openMedia?: boolean) => void;
  onRetryTask: (log: GenerationLog) => void;
  onRememberActivityScroll: (scrollTop: number) => void;
  onNotify: (message: string, kind?: "ok" | "error") => void;
  onClose: () => void;
  onOpenAssetWorkbench: () => void;
  onTheme: () => void;
  onConnectionStyleChange: (value: CanvasConnectionStyle) => void;
  onDepthQualityChange: (value: DepthQuality) => void;
  onExportWorkflow: () => void;
  onImportWorkflow: () => void;
};

/** Composes the existing canvas side panels without owning their state or actions. */
export default function CanvasPanelLayer({
  activePanel,
  canvasAssets,
  assetRefresh,
  assetLibraryCollectionId,
  canReferenceAssets,
  generationLogs,
  activityLogs,
  canvasDocument,
  generationLogsLoading,
  theme,
  connectionStyle,
  depthQuality,
  activityPanelScrollTop,
  onCollectionSelectionChange,
  onAddAsset,
  onReferenceAsset,
  onLocateAsset,
  onAddNodeToCollection,
  onRefreshGenerationLogs,
  onFocusTask,
  onFocusNode,
  onRetryTask,
  onRememberActivityScroll,
  onNotify,
  onClose,
  onOpenAssetWorkbench,
  onTheme,
  onConnectionStyleChange,
  onDepthQualityChange,
  onExportWorkflow,
  onImportWorkflow,
}: CanvasPanelLayerProps) {
  if (activePanel === "assets") {
    return (
      <CanvasAssetDrawer
        extraAssets={canvasAssets}
        refresh={assetRefresh}
        collectionSelection={assetLibraryCollectionId}
        onCollectionSelectionChange={onCollectionSelectionChange}
        canReference={canReferenceAssets}
        onAdd={onAddAsset}
        onReference={onReferenceAsset}
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
        onRetryTask={onRetryTask}
        onClose={onClose}
        onNotify={onNotify}
        restoreScrollTop={activityPanelScrollTop}
        onRememberScrollPosition={onRememberActivityScroll}
      />
    );
  }

  if (activePanel === "settings") {
    return (
      <CanvasSettingsPanel
        theme={theme}
        connectionStyle={connectionStyle}
        depthQuality={depthQuality}
        onTheme={onTheme}
        onConnectionStyleChange={onConnectionStyleChange}
        onDepthQualityChange={onDepthQualityChange}
        onExportWorkflow={onExportWorkflow}
        onImportWorkflow={onImportWorkflow}
        onClose={onClose}
      />
    );
  }

  if (activePanel === "shortcuts") return <CanvasShortcutsPanel onClose={onClose} />;
  return null;
}
