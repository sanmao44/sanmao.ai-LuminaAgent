"use client";

import {
  CanvasGroupContextMenu,
  CanvasNodeContextMenu,
} from "@/components/canvas/CanvasContextMenu";
import CanvasCreateContextMenu from "@/components/canvas/CanvasCreateContextMenu";
import CanvasToolsContextMenu from "@/components/canvas/CanvasToolsContextMenu";
import type { CanvasContextMenuGroup } from "@/lib/canvas/menu-actions";
import type { CanvasGroup, CanvasNode, CanvasNodeCreationKind } from "@/lib/canvas/types";

export type CanvasContextMenuPosition = {
  x: number;
  y: number;
  world: { x: number; y: number };
};

export type CanvasContextMenuLayerProps = {
  menu: "node" | "group" | "create" | "tools" | null;
  position: CanvasContextMenuPosition | null;
  node: CanvasNode | null;
  group: CanvasGroup | null;
  selectionCount: number;
  nodeGroups: CanvasContextMenuGroup[];
  groupGroups: CanvasContextMenuGroup[];
  canUndo: boolean;
  canRedo: boolean;
  emptyContentCount: number;
  onClose: () => void;
  onCreateNode: (type: CanvasNodeCreationKind, world: { x: number; y: number }) => void;
  onOpenClone: () => void;
  onAskAgent: () => void;
  onUpload: (position: { x: number; y: number }) => void;
  onOpenCreate: () => void;
  onPaste: (position: { x: number; y: number }) => void | Promise<void>;
  onUndo: () => void;
  onRedo: () => void;
  onArrange: () => void;
  onFit: () => void;
  onClean: () => void;
};

/** Composes the four context-menu presentations; Workspace retains all actions and state. */
export default function CanvasContextMenuLayer({
  menu,
  position,
  node,
  group,
  selectionCount,
  nodeGroups,
  groupGroups,
  canUndo,
  canRedo,
  emptyContentCount,
  onClose,
  onCreateNode,
  onOpenClone,
  onAskAgent,
  onUpload,
  onOpenCreate,
  onPaste,
  onUndo,
  onRedo,
  onArrange,
  onFit,
  onClean,
}: CanvasContextMenuLayerProps) {
  if (!position) return null;
  if (menu === "group" && group) {
    return <CanvasGroupContextMenu group={group} groups={groupGroups} position={position} />;
  }
  if (menu === "node" && node) {
    return <CanvasNodeContextMenu node={node} selectionCount={selectionCount} groups={nodeGroups} position={position} />;
  }
  if (menu === "create") {
    return (
      <CanvasCreateContextMenu
        position={position}
        onClose={onClose}
        onCreateNode={onCreateNode}
        onOpenClone={onOpenClone}
      />
    );
  }
  if (menu === "tools") {
    return (
      <CanvasToolsContextMenu
        position={position}
        canUndo={canUndo}
        canRedo={canRedo}
        emptyContentCount={emptyContentCount}
        onClose={onClose}
        onAskAgent={onAskAgent}
        onUpload={onUpload}
        onOpenCreate={onOpenCreate}
        onPaste={onPaste}
        onUndo={onUndo}
        onRedo={onRedo}
        onArrange={onArrange}
        onFit={onFit}
        onClean={onClean}
      />
    );
  }
  return null;
}
