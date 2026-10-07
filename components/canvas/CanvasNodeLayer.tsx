"use client";

import { Fragment, type PointerEvent as ReactPointerEvent } from "react";
import { incomingContext, isCanvasMentionableNode } from "@/lib/canvas/model";
import type {
  CanvasDocument,
  CanvasGenerationParams,
  CanvasNode,
  CanvasRuntimeState,
} from "@/lib/canvas/types";
import { MemoizedCanvasNodeCard } from "@/components/canvas/CanvasNodeCard";
import type { CanvasNodeCardProps } from "@/components/canvas/CanvasNodeCardContract";

export type CanvasNodeLayerProps = {
  nodes: readonly CanvasNode[];
  document: CanvasDocument;
  selectedIds: ReadonlySet<string>;
  draggingNodeIds: ReadonlySet<string>;
  referencePickerActive: boolean;
  referencePickerTargetId: string | null;
  referencePickerHoverNodeId: string | null;
  referencePickerFlashNodeId: string | null;
  editingNodeId: string | null;
  expandedEditorId: string | null;
  runtime: CanvasRuntimeState | null;
  editorPromptFor: (node: CanvasNode) => string;
  editorParamsFor: (node: CanvasNode) => CanvasGenerationParams | undefined;
  onPointerDown: CanvasNodeCardProps["onPointerDown"];
  onResize: CanvasNodeCardProps["onResize"];
  onConnect: CanvasNodeCardProps["onConnect"];
  onSelect: (event: ReactPointerEvent, node: CanvasNode) => void;
  onRemoveFromGroup: (node: CanvasNode) => void;
  onPreview: (node: CanvasNode) => void;
  onOpenVideoClip: (node: CanvasNode) => void;
  onOpenVideoEditor: (node: CanvasNode) => void;
  onOpenAngle: (node: CanvasNode) => void;
  onCancelAngle: (node: CanvasNode) => void;
  onOutputPreview: (node: CanvasNode) => void;
  onLocalEdit: (node: CanvasNode) => void;
  onTextPreview: (node: CanvasNode) => void;
  onUseAsImagePrompt: (node: CanvasNode) => void;
  onRetryVariant: (nodeId: string, variantIndex: number) => void;
  onRetryFailedVariants: (nodeId: string) => void;
  onEdit: (node: CanvasNode, editing: boolean) => void;
  onNaturalSize: CanvasNodeCardProps["onNaturalSize"];
  onPromptChange: (node: CanvasNode, value: string) => void;
  onEditorPromptChange: CanvasNodeCardProps["onEditorPromptChange"];
  onEditorParamsChange: CanvasNodeCardProps["onEditorParamsChange"];
  onVariantRequirementsChange: (node: CanvasNode, value: string) => void;
  onToggleEditor: CanvasNodeCardProps["onToggleEditor"];
  onGenerate: CanvasNodeCardProps["onGenerate"];
  onOneTake: CanvasNodeCardProps["onOneTake"];
  onReferenceReorder: CanvasNodeCardProps["onReferenceReorder"];
  onReferenceRemove: CanvasNodeCardProps["onReferenceRemove"];
  onReferenceDrop: CanvasNodeCardProps["onReferenceDrop"];
  onAddReferenceFiles: CanvasNodeCardProps["onAddReferenceFiles"];
};

/**
 * Owns the node layer container and stable list keys.
 *
 * Node state, mutations, and card behavior remain owned by CanvasWorkspace;
 * this component only establishes the presentation boundary for the list.
 */
export default function CanvasNodeLayer({
  nodes,
  document,
  selectedIds,
  draggingNodeIds,
  referencePickerActive,
  referencePickerTargetId,
  referencePickerHoverNodeId,
  referencePickerFlashNodeId,
  editingNodeId,
  expandedEditorId,
  runtime,
  editorPromptFor,
  editorParamsFor,
  onPointerDown,
  onResize,
  onConnect,
  onSelect,
  onRemoveFromGroup,
  onPreview,
  onOpenVideoClip,
  onOpenVideoEditor,
  onOpenAngle,
  onCancelAngle,
  onOutputPreview,
  onLocalEdit,
  onTextPreview,
  onUseAsImagePrompt,
  onRetryVariant,
  onRetryFailedVariants,
  onEdit,
  onNaturalSize,
  onPromptChange,
  onEditorPromptChange,
  onEditorParamsChange,
  onVariantRequirementsChange,
  onToggleEditor,
  onGenerate,
  onOneTake,
  onReferenceReorder,
  onReferenceRemove,
  onReferenceDrop,
  onAddReferenceFiles,
}: CanvasNodeLayerProps) {
  return (
    <div className="canvas-node-layer">
      {nodes.map((node) => {
        const context = incomingContext(document, node.id);
        return (
          <Fragment key={node.id}>
            <MemoizedCanvasNodeCard
              node={node}
              selected={selectedIds.has(node.id)}
              dragging={draggingNodeIds.has(node.id)}
              referencePickerActive={referencePickerActive}
              referencePickerTargetId={referencePickerTargetId}
              referencePickerHoverNodeId={referencePickerHoverNodeId}
              referencePickerFlashNodeId={referencePickerFlashNodeId}
              document={document}
              onPointerDown={onPointerDown}
              onResize={onResize}
              onConnect={onConnect}
              onSelect={(event) => onSelect(event, node)}
              onRemoveFromGroup={() => onRemoveFromGroup(node)}
              onPreview={() => onPreview(node)}
              onOpenVideoClip={() => onOpenVideoClip(node)}
              onOpenAngle={() => onOpenAngle(node)}
              onCancelAngle={() => onCancelAngle(node)}
              onOpenVideoEditor={() => onOpenVideoEditor(node)}
              onOutputPreview={onOutputPreview}
              onLocalEdit={() => onLocalEdit(node)}
              onTextPreview={() => onTextPreview(node)}
              onUseAsImagePrompt={() => onUseAsImagePrompt(node)}
              onRetryVariant={(variantIndex) => onRetryVariant(node.id, variantIndex)}
              onRetryFailedVariants={() => onRetryFailedVariants(node.id)}
              editing={editingNodeId === node.id}
              onEdit={(editing) => onEdit(node, editing)}
              onNaturalSize={onNaturalSize}
              onPromptChange={(value) => onPromptChange(node, value)}
              onEditorPromptChange={onEditorPromptChange}
              onEditorParamsChange={onEditorParamsChange}
              onVariantRequirementsChange={onVariantRequirementsChange}
              runtime={runtime}
              editorPrompt={editorPromptFor(node)}
              editorParams={editorParamsFor(node)}
              expanded={expandedEditorId === node.id}
              onToggleEditor={onToggleEditor}
              onGenerate={onGenerate}
              onOneTake={onOneTake}
              onReferenceReorder={onReferenceReorder}
              onReferenceRemove={onReferenceRemove}
              onReferenceDrop={onReferenceDrop}
              onAddReferenceFiles={onAddReferenceFiles}
              editorContexts={context.filter(
                (item) => item.type === "prompt" || item.type === "generator",
              )}
              mentionCandidates={context.filter(isCanvasMentionableNode)}
            />
          </Fragment>
        );
      })}
    </div>
  );
}
