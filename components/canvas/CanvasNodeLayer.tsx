"use client";

import {
  Fragment,
  memo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
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

type CanvasNodeLayerItemProps = Omit<CanvasNodeLayerProps, "nodes"> & {
  node: CanvasNode;
};

type CanvasNodeLayerCallbackProps = {
  [Key in keyof CanvasNodeLayerProps as Key extends `on${string}`
    ? Key
    : never]: CanvasNodeLayerProps[Key];
};

type CanvasNodeLayerCallbackRef = {
  current: CanvasNodeLayerCallbackProps;
};

type MemoizedCanvasNodeLayerItemProps = Omit<
  CanvasNodeLayerItemProps,
  keyof CanvasNodeLayerCallbackProps
> & {
  callbacksRef: CanvasNodeLayerCallbackRef;
};

/**
 * Camera updates replace only the document wrapper. Keep each node item alive
 * when its node/edge/group collections are unchanged so panning and zooming
 * move one GPU layer instead of rebuilding every card's context and handlers.
 */
function areCanvasNodeLayerItemPropsEqual(
  previous: MemoizedCanvasNodeLayerItemProps,
  next: MemoizedCanvasNodeLayerItemProps,
) {
  const id = previous.node.id;
  return (
    previous.node === next.node &&
    previous.selectedIds.has(id) === next.selectedIds.has(id) &&
    previous.draggingNodeIds.has(id) === next.draggingNodeIds.has(id) &&
    previous.referencePickerActive === next.referencePickerActive &&
    previous.referencePickerTargetId === next.referencePickerTargetId &&
    previous.referencePickerHoverNodeId === next.referencePickerHoverNodeId &&
    previous.referencePickerFlashNodeId === next.referencePickerFlashNodeId &&
    previous.editingNodeId === next.editingNodeId &&
    previous.expandedEditorId === next.expandedEditorId &&
    previous.document.nodes === next.document.nodes &&
    previous.document.edges === next.document.edges &&
    previous.document.groups === next.document.groups &&
    previous.runtime === next.runtime &&
    previous.editorPromptFor === next.editorPromptFor &&
    previous.editorParamsFor === next.editorParamsFor
  );
}

function CanvasNodeLayerItem({ node, ...props }: MemoizedCanvasNodeLayerItemProps) {
  const context = incomingContext(props.document, node.id);
  return (
    <MemoizedCanvasNodeCard
      node={node}
      selected={props.selectedIds.has(node.id)}
      dragging={props.draggingNodeIds.has(node.id)}
      referencePickerActive={props.referencePickerActive}
      referencePickerTargetId={props.referencePickerTargetId}
      referencePickerHoverNodeId={props.referencePickerHoverNodeId}
      referencePickerFlashNodeId={props.referencePickerFlashNodeId}
      document={props.document}
      onPointerDown={(event, target) => props.callbacksRef.current.onPointerDown(event, target)}
      onResize={(event, target) => props.callbacksRef.current.onResize(event, target)}
      onConnect={(event, targetId, port) => props.callbacksRef.current.onConnect(event, targetId, port)}
      onSelect={(event) => props.callbacksRef.current.onSelect(event, node)}
      onRemoveFromGroup={() => props.callbacksRef.current.onRemoveFromGroup(node)}
      onPreview={() => props.callbacksRef.current.onPreview(node)}
      onOpenVideoClip={() => props.callbacksRef.current.onOpenVideoClip(node)}
      onOpenAngle={() => props.callbacksRef.current.onOpenAngle(node)}
      onCancelAngle={() => props.callbacksRef.current.onCancelAngle(node)}
      onOpenVideoEditor={() => props.callbacksRef.current.onOpenVideoEditor(node)}
      onOutputPreview={(target) => props.callbacksRef.current.onOutputPreview(target)}
      onLocalEdit={() => props.callbacksRef.current.onLocalEdit(node)}
      onTextPreview={() => props.callbacksRef.current.onTextPreview(node)}
      onUseAsImagePrompt={() => props.callbacksRef.current.onUseAsImagePrompt(node)}
      onRetryVariant={(variantIndex) => props.callbacksRef.current.onRetryVariant(node.id, variantIndex)}
      onRetryFailedVariants={() => props.callbacksRef.current.onRetryFailedVariants(node.id)}
      editing={props.editingNodeId === node.id}
      onEdit={(editing) => props.callbacksRef.current.onEdit(node, editing)}
      onNaturalSize={(nodeId, width, height, durationSeconds) => props.callbacksRef.current.onNaturalSize(nodeId, width, height, durationSeconds)}
      onPromptChange={(value) => props.callbacksRef.current.onPromptChange(node, value)}
      onEditorPromptChange={(target, value) => props.callbacksRef.current.onEditorPromptChange(target, value)}
      onEditorParamsChange={(target, settings) => props.callbacksRef.current.onEditorParamsChange(target, settings)}
      onVariantRequirementsChange={(target, value) => props.callbacksRef.current.onVariantRequirementsChange(target, value)}
      runtime={props.runtime}
      editorPrompt={props.editorPromptFor(node)}
      editorParams={props.editorParamsFor(node)}
      expanded={props.expandedEditorId === node.id}
      onToggleEditor={(target) => props.callbacksRef.current.onToggleEditor(target)}
      onGenerate={(target) => props.callbacksRef.current.onGenerate(target)}
      onOneTake={(target, durationSeconds) => props.callbacksRef.current.onOneTake(target, durationSeconds)}
      onReferenceReorder={(ownerId, draggedId, targetId) => props.callbacksRef.current.onReferenceReorder(ownerId, draggedId, targetId)}
      onReferenceRemove={(ownerId, sourceId) => props.callbacksRef.current.onReferenceRemove(ownerId, sourceId)}
      onReferenceDrop={(ownerId, sourceId, role) => props.callbacksRef.current.onReferenceDrop(ownerId, sourceId, role)}
      onAddReferenceFiles={(ownerId, files) => props.callbacksRef.current.onAddReferenceFiles(ownerId, files)}
      editorContexts={context.filter(
        (item) => item.type === "prompt" || item.type === "generator",
      )}
      mentionCandidates={context.filter(isCanvasMentionableNode)}
    />
  );
}

const MemoizedCanvasNodeLayerItem = memo(
  CanvasNodeLayerItem,
  areCanvasNodeLayerItemPropsEqual,
);

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
  const callbacksRef = useRef<CanvasNodeLayerCallbackProps>({
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
  });
  callbacksRef.current = {
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
  };
  return (
    <div className="canvas-node-layer">
      {nodes.map((node) => (
        <Fragment key={node.id}>
          <MemoizedCanvasNodeLayerItem
            node={node}
            callbacksRef={callbacksRef}
            document={document}
            selectedIds={selectedIds}
            draggingNodeIds={draggingNodeIds}
            referencePickerActive={referencePickerActive}
            referencePickerTargetId={referencePickerTargetId}
            referencePickerHoverNodeId={referencePickerHoverNodeId}
            referencePickerFlashNodeId={referencePickerFlashNodeId}
            editingNodeId={editingNodeId}
            expandedEditorId={expandedEditorId}
            runtime={runtime}
            editorPromptFor={editorPromptFor}
            editorParamsFor={editorParamsFor}
          />
        </Fragment>
      ))}
    </div>
  );
}
