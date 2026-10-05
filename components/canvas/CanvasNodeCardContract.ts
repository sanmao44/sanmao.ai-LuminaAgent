import type { PointerEvent as ReactPointerEvent } from "react";
import type { CreationSettings } from "@/lib/creation/settings";
import type {
  CanvasDocument,
  CanvasGenerationParams,
  CanvasInputRole,
  CanvasNode,
  CanvasRuntimeState,
} from "@/lib/canvas/types";

export type CanvasNodeCardProps = {
  node: CanvasNode;
  selected: boolean;
  dragging: boolean;
  referencePickerActive: boolean;
  referencePickerTargetId: string | null;
  referencePickerHoverNodeId: string | null;
  referencePickerFlashNodeId: string | null;
  document: CanvasDocument;
  onPointerDown: (event: ReactPointerEvent, node: CanvasNode) => void;
  onResize: (event: ReactPointerEvent, node: CanvasNode) => void;
  onConnect: (
    event: ReactPointerEvent,
    nodeId: string,
    port: "left" | "right",
  ) => void;
  onSelect: (event: ReactPointerEvent) => void;
  onRemoveFromGroup: () => void;
  onPreview: () => void;
  onOpenVideoClip: () => void;
  onOpenVideoEditor: () => void;
  onOpenAngle: () => void;
  onCancelAngle: () => void;
  onTextPreview: () => void;
  onLocalEdit: () => void;
  onUseAsImagePrompt: () => void;
  onRetryVariant: (variantIndex: number) => void;
  onRetryFailedVariants: () => void;
  onNaturalSize: (
    nodeId: string,
    width: number,
    height: number,
    durationSeconds?: number,
  ) => void;
  onPromptChange: (value: string) => void;
  onEditorPromptChange: (node: CanvasNode, value: string) => void;
  onEditorParamsChange: (node: CanvasNode, settings: CreationSettings) => void;
  onVariantRequirementsChange: (node: CanvasNode, value: string) => void;
  runtime: CanvasRuntimeState | null;
  editorPrompt: string;
  editorParams?: CanvasGenerationParams;
  expanded: boolean;
  onToggleEditor: (node: CanvasNode) => void;
  onGenerate: (node: CanvasNode) => void;
  onOneTake: (node: CanvasNode, durationSeconds: number) => void;
  onReferenceReorder: (ownerId: string, draggedId: string, targetId: string) => void;
  onReferenceRemove: (ownerId: string, sourceId: string) => void;
  onReferenceDrop: (ownerId: string, sourceId: string, role: CanvasInputRole) => void;
  onAddReferenceFiles: (ownerId: string, files: File[]) => void;
  editorContexts: CanvasNode[];
  mentionCandidates: CanvasNode[];
  onOutputPreview: (node: CanvasNode) => void;
  editing: boolean;
  onEdit: (value: boolean) => void;
};

/**
 * Keeps memoized cards from retaining stale Workspace callbacks.
 * Camera-only document replacements are intentionally ignored because cards
 * only read node, edge, and group collections from the document snapshot.
 */
export function areCanvasNodeCardPropsEqual(
  previous: CanvasNodeCardProps,
  next: CanvasNodeCardProps,
) {
  return (
    previous.node === next.node &&
    previous.selected === next.selected &&
    previous.dragging === next.dragging &&
    previous.referencePickerActive === next.referencePickerActive &&
    previous.referencePickerTargetId === next.referencePickerTargetId &&
    previous.referencePickerHoverNodeId === next.referencePickerHoverNodeId &&
    previous.referencePickerFlashNodeId === next.referencePickerFlashNodeId &&
    previous.document.nodes === next.document.nodes &&
    previous.document.edges === next.document.edges &&
    previous.document.groups === next.document.groups &&
    previous.onPointerDown === next.onPointerDown &&
    previous.onResize === next.onResize &&
    previous.onConnect === next.onConnect &&
    previous.onSelect === next.onSelect &&
    previous.onRemoveFromGroup === next.onRemoveFromGroup &&
    previous.onPreview === next.onPreview &&
    previous.onOpenVideoClip === next.onOpenVideoClip &&
    previous.onOpenVideoEditor === next.onOpenVideoEditor &&
    previous.onOpenAngle === next.onOpenAngle &&
    previous.onCancelAngle === next.onCancelAngle &&
    previous.onTextPreview === next.onTextPreview &&
    previous.onLocalEdit === next.onLocalEdit &&
    previous.onUseAsImagePrompt === next.onUseAsImagePrompt &&
    previous.onRetryVariant === next.onRetryVariant &&
    previous.onRetryFailedVariants === next.onRetryFailedVariants &&
    previous.onNaturalSize === next.onNaturalSize &&
    previous.onPromptChange === next.onPromptChange &&
    previous.onEditorPromptChange === next.onEditorPromptChange &&
    previous.onEditorParamsChange === next.onEditorParamsChange &&
    previous.onVariantRequirementsChange === next.onVariantRequirementsChange &&
    previous.runtime === next.runtime &&
    previous.editorPrompt === next.editorPrompt &&
    previous.editorParams === next.editorParams &&
    previous.expanded === next.expanded &&
    previous.onToggleEditor === next.onToggleEditor &&
    previous.onGenerate === next.onGenerate &&
    previous.onOneTake === next.onOneTake &&
    previous.onReferenceReorder === next.onReferenceReorder &&
    previous.onReferenceRemove === next.onReferenceRemove &&
    previous.onReferenceDrop === next.onReferenceDrop &&
    previous.onAddReferenceFiles === next.onAddReferenceFiles &&
    previous.editorContexts === next.editorContexts &&
    previous.mentionCandidates === next.mentionCandidates &&
    previous.onOutputPreview === next.onOutputPreview &&
    previous.editing === next.editing &&
    previous.onEdit === next.onEdit
  );
}
