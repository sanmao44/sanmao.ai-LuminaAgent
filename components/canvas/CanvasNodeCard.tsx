"use client";

import { memo, useCallback, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import { CANVAS_Z_INDEX, canvasNodePaintZIndex } from "@/lib/canvas/layers";
import {
  incomingContext,
  incomingReferences,
  isCanvasReadyImageSource,
  isCanvasReferenceableNode,
  nodeSize,
  groupForNode,
} from "@/lib/canvas/model";
import type { CanvasGenerationParams, CanvasInputRole, CanvasNode, CanvasRuntimeState } from "@/lib/canvas/types";
import type { CanvasVariantState } from "@/lib/canvas/types";
import type { ImageCreationSettings } from "@/lib/creation/settings";
import { formatCanvasVideoDuration } from "@/lib/canvas/media";
import { normalizeCanvasVideoClipState, videoClipDurationSeconds } from "@/lib/canvas/video-clip";
import { canvasNodeColorKey } from "@/lib/canvas/appearance";
import { canvasMentionOption } from "@/components/canvas/mention-options";
import { nodeLabel } from "@/lib/canvas/menu-labels";
import { areCanvasNodeCardPropsEqual, type CanvasNodeCardProps } from "@/components/canvas/CanvasNodeCardContract";
import CanvasAgentNodeCard from "@/components/canvas/CanvasAgentNodeCard";
import CanvasAngleNodeCard from "@/components/canvas/CanvasAngleNodeCard";
import CanvasGeneratorNodeCard from "@/components/canvas/CanvasGeneratorNodeCard";
import CanvasMediaNodeCard from "@/components/canvas/CanvasMediaNodeCard";
import CanvasUpscaleNodeCard from "@/components/canvas/CanvasUpscaleNodeCard";
import { CanvasVariantRequirementsEditor } from "@/components/canvas/CanvasVariantEditors";
import CanvasNodeReferenceStrip from "@/components/canvas/CanvasNodeReferenceStrip";
import CanvasReferenceMentionMenu from "@/components/canvas/CanvasReferenceMentionMenu";
import CreationParameterEditor from "@/components/CreationParameterEditor";
import VideoEditorNode from "@/components/VideoEditorNode";
import type { CanvasProcessingKind } from "@/components/canvas/CanvasProcessingIndicator";
import { insertReferenceMention as insertCreativeMention, referenceMentionRange as creativeReferenceMentionRange } from "@/lib/creative-references";
type MentionState = { start: number; end: number; query: string } | null;
function mentionStateForValue(value: string, cursor: number): MentionState { return creativeReferenceMentionRange(value, cursor); }
import { maskStateForNode, canvasUpscaleSource, nodeStatus, progressValue, variantRequirementsFor, variantStatesFor } from "@/lib/canvas/node-card";

function CanvasNodeCard({
  node,
  selected,
  dragging,
  referencePickerActive,
  referencePickerTargetId,
  referencePickerHoverNodeId,
  referencePickerFlashNodeId,
  document,
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
  onTextPreview,
  onLocalEdit,
  onUseAsImagePrompt,
  onRetryVariant,
  onRetryFailedVariants,
  onNaturalSize,
  onPromptChange,
  onEditorPromptChange,
  onEditorParamsChange,
  onVariantRequirementsChange,
  runtime,
  editorPrompt,
  editorParams,
  expanded,
  onToggleEditor,
  onGenerate,
  onOneTake,
  onReferenceReorder,
  onReferenceRemove,
  onReferenceDrop,
  onAddReferenceFiles,
  editorContexts,
  mentionCandidates,
  onOutputPreview,
  editing,
  onEdit,
}: CanvasNodeCardProps) {
  const size = nodeSize(node);
  const data = node.data;
  const group = groupForNode(document, node.id);
  const colorKey = canvasNodeColorKey(node);
  const status = data.status || "idle";
  const pending = data.status === "queued" || data.status === "running";
  const imageResolution =
    ((node.type === "media" && data.kind === "image") || node.type === "upscale") &&
    Boolean(data.url) &&
    !pending &&
    data.status !== "failed" &&
    Number(data.nativeWidth) > 0 &&
    Number(data.nativeHeight) > 0
      ? `${Math.round(Number(data.nativeWidth))} × ${Math.round(Number(data.nativeHeight))}`
      : null;
  const hasUpscaleResult = node.type === "upscale" && Boolean(data.url);
  const failed = data.status === "failed" && !data.url;
  const angleReference = node.type === "angle"
    ? incomingReferences(document, node.id).find((item) => isCanvasReadyImageSource(item))
    : undefined;
  const angleParams = node.type === "angle" ? data.angle : undefined;
  const videoClipSourceDuration =
    Number(data.sourceDurationMs || data.durationMs) > 0
      ? Number(data.sourceDurationMs || data.durationMs) / 1000
      : undefined;
  const videoClip =
    node.type === "media" && data.kind === "video"
      ? normalizeCanvasVideoClipState(data.videoClip, videoClipSourceDuration)
      : undefined;
  const sourceVideoDuration = formatCanvasVideoDuration(data.durationMs);
  const videoDuration =
    node.type === "media" && data.kind === "video" && data.url
      ? videoClip
        ? formatCanvasVideoDuration(Math.round(videoClipDurationSeconds(videoClip) * 1000))
        : sourceVideoDuration
      : "";
  const videoResolution =
    node.type === "media" &&
    data.kind === "video" &&
    Boolean(data.url) &&
    !pending &&
    data.status !== "failed" &&
    Number(data.nativeWidth) > 0 &&
    Number(data.nativeHeight) > 0
      ? `${Math.round(Number(data.nativeWidth))} × ${Math.round(Number(data.nativeHeight))}`
      : null;
  const maskState = maskStateForNode(node);
  const agentResponse =
    node.type === "prompt" &&
    (data.agentResponse || String(data.role || "").includes("回复"))
      ? String(data.agentResponse || data.text || "")
      : "";
  const agentInput = String(
    agentResponse ? data.agentPrompt || data.text || "" : data.text || "",
  );
  const handleCardPromptPaste = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .flatMap((item) => {
        const file = item.getAsFile();
        return file ? [file] : [];
      });
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    onAddReferenceFiles(node.id, files);
  }, [node.id, onAddReferenceFiles]);
  const variantRequirements =
    node.type === "generator" ? variantRequirementsFor(node) : [];
  const variantStates =
    node.type === "generator" ? variantStatesFor(node) : [];
  const processingProgress = progressValue(data.progress);
  const generatorProgress = variantStates.length
    ? progressValue(
        variantStates.reduce(
          (total, state) =>
            total +
            (state.status === "completed"
              ? 100
              : progressValue(state.progress) || 0),
          0,
        ) / variantStates.length,
      )
    : processingProgress;
  const processingMediaLabel =
    data.kind === "video" ? "视频" : data.kind === "audio" ? "音频" : "图片";
  const processingLabel =
    data.status === "queued"
      ? data.statusLabel || "排队等待中"
      : data.statusLabel ||
        (node.type === "prompt"
          ? "Agent 正在思考"
          : node.type === "generator"
            ? "批量处理中"
            : `${processingMediaLabel}生成中`);
  const processingKind: CanvasProcessingKind =
    node.type === "prompt"
      ? "agent"
      : node.type === "generator"
        ? "generator"
        : node.type === "angle"
          ? "angle"
          : node.type === "upscale"
            ? "upscale"
            : data.kind === "video"
              ? "video"
              : "image";
  const mediaFooterStatus =
    node.type === "media" && data.kind === "video"
      ? pending
        ? processingLabel
        : data.status === "failed"
          ? "视频生成失败"
          : data.url
            ? data.generation
              ? "视频生成结果"
              : "视频素材"
             : "空视频节点"
       : node.type === "media" && data.kind === "audio"
         ? data.url ? "音频素材" : "等待导入音频"
         : nodeStatus(node);
  const completedVariants = variantStates.filter(
    (state) => state.status === "completed",
  ).length;
  const failedVariants = variantStates.filter(
    (state) => state.status === "failed",
  ).length;
  const imageParams =
    node.type === "generator" && data.kind === "image"
      ? (data.params as ImageCreationSettings | undefined)
      : undefined;
  const perVariantImageCount = Math.max(1, Number(imageParams?.count || 1));
  const estimatedResultCount =
    node.type === "generator" && data.kind === "image"
      ? variantRequirements.length * perVariantImageCount
      : 0;
  const referenceCount =
    node.type === "generator" ? incomingReferences(document, node.id).length : 0;
  const editorReferences = incomingReferences(document, node.id);
  const editorOutputs =
    node.type === "generator"
      ? document.nodes.filter(
          (item) => item.type === "media" && item.data.generation?.sourceGeneratorId === node.id,
        )
      : [];
  const [mentionState, setMentionState] = useState<MentionState>(null);
  // 媒体文件被删/不在媒体库时给出可见提示，而不是留一片空白或只剩播放按钮。

  return (
    <article
      className={`canvas-node node-color-${colorKey} status-${status} ${selected ? "selected" : ""} ${dragging ? "dragging" : ""}${referencePickerActive && referencePickerTargetId === node.id ? " reference-picker-target" : ""}${referencePickerActive && referencePickerHoverNodeId === node.id ? " reference-picker-hover" : ""}${referencePickerFlashNodeId === node.id ? " reference-picker-flash" : ""}`}
      data-canvas-node-id={node.id}
      data-canvas-connectable-id={node.id}
      data-node-color={colorKey}
      data-node-kind={node.type === "angle" ? "angle" : node.type === "video-editor" ? "video-editor" : node.type === "upscale" ? "upscale" : node.type === "prompt" ? "agent" : data.kind === "video" ? "video" : data.kind === "audio" ? "audio" : "image"}
      aria-busy={pending}
      style={{
        left: node.x,
        top: node.y,
        width: size.w,
        height: size.h,
        zIndex: canvasNodePaintZIndex(document, node, dragging),
      }}
      // Node movement and typed connections use the canvas pointer model.
      // Do not enable native HTML dragging on the whole card: it steals click
      // events from the editor controls and makes the card feel unresponsive.
      draggable={false}
      onDragStart={(event) => {
        if (!data.url && node.type !== "prompt") return;
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-sanmao-canvas-node", node.id);
      }}
      onPointerDown={(event) => onPointerDown(event, node)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (referencePickerActive) return;
        if (node.type === "angle") onOpenAngle();
        else if (node.type === "video-editor") onOpenVideoEditor();
        else if (node.type === "media" && node.data.kind === "video" && node.data.url) onOpenVideoClip();
        else if (node.type === "prompt") onEdit(true);
        else if (node.type === "media" && node.data.kind === "audio") onToggleEditor(node);
        else if (isCanvasReferenceableNode(node)) onPreview();
        else onToggleEditor(node);
      }}
    >
      {status === "running" && (
        <div className="canvas-node-aura" aria-hidden="true">
          <span className="canvas-node-aura-surface" />
        </div>
      )}
      {group && (
        <button
          type="button"
          className="canvas-node-group-remove"
          aria-label="移出对象组"
          title="移出对象组"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onRemoveFromGroup();
          }}
        >
          出组
        </button>
      )}
      <button
        type="button"
        className="canvas-port left"
        aria-label="左侧连接端口"
        onPointerDown={(event) => onConnect(event, node.id, "left")}
      />
      {node.type === "video-editor" ? (
        <VideoEditorNode
          node={node}
          state={data.videoEditor}
          inputs={incomingContext(document, node.id).filter(isCanvasReferenceableNode)}
          onOpen={onOpenVideoEditor}
        />
      ) : node.type === "angle" ? (
        <CanvasAngleNodeCard
          angleReference={angleReference}
          angleParams={angleParams}
          status={status}
          statusLabel={data.statusLabel}
          pending={pending}
          processingLabel={processingLabel}
          processingProgress={processingProgress}
          processingKind={processingKind}
          processingStartedAt={data.processingStartedAt}
          onOpenAngle={onOpenAngle}
          onCancelAngle={onCancelAngle}
        />
      ) : node.type === "media" ? (
        <CanvasMediaNodeCard
          node={node}
          pending={pending}
          failed={failed}
          processingLabel={processingLabel}
          processingProgress={processingProgress}
          processingKind={processingKind}
          imageResolution={imageResolution}
          videoResolution={videoResolution}
          videoDuration={videoDuration}
          videoClip={videoClip}
          mediaFooterStatus={mediaFooterStatus}
          maskState={maskState}
          onNaturalSize={onNaturalSize}
          onLocalEdit={onLocalEdit}
        />
      ) : null}
      {node.type === "upscale" && (
        <CanvasUpscaleNodeCard
          node={node}
          pending={pending}
          hasResult={hasUpscaleResult}
          processingLabel={processingLabel}
          processingProgress={processingProgress}
          processingKind={processingKind}
          imageResolution={imageResolution}
          sourceConnected={Boolean(canvasUpscaleSource(document, node.id))}
          onNaturalSize={onNaturalSize}
        />
      )}
      {node.type === "prompt" && (
        <CanvasAgentNodeCard
          node={node}
          status={status}
          pending={pending}
          role={data.role}
          model={data.model}
          statusLabel={data.statusLabel}
          agentInput={agentInput}
          agentResponse={agentResponse}
          processingLabel={processingLabel}
          processingProgress={processingProgress}
          processingKind={processingKind}
          processingStartedAt={data.processingStartedAt || data.generation?.createdAt}
          editing={editing}
          references={mentionCandidates.map((candidate, index) => canvasMentionOption(document, candidate, index))}
          onPaste={handleCardPromptPaste}
          onPromptChange={onPromptChange}
          onEdit={onEdit}
          onUseAsImagePrompt={onUseAsImagePrompt}
          onTextPreview={onTextPreview}
        />
      )}
      {node.type === "generator" && (
        <CanvasGeneratorNodeCard
          node={node}
          kind={data.kind === "video" ? "video" : "image"}
          status={status}
          pending={pending}
          processingLabel={processingLabel}
          processingProgress={processingProgress}
          processingKind={processingKind}
          processingStartedAt={data.processingStartedAt || data.generation?.createdAt}
          generatorProgress={generatorProgress}
          referenceCount={referenceCount}
          variantRequirements={variantRequirements}
          variantStates={variantStates}
          completedVariants={completedVariants}
          failedVariants={failedVariants}
          estimatedResultCount={estimatedResultCount}
          editorOutputs={editorOutputs}
          prompt={data.prompt}
          model={(data.params as CanvasGenerationParams | undefined)?.model}
          aspect={data.params && "aspect" in data.params ? data.params.aspect : undefined}
          onRetryVariant={onRetryVariant}
          onRetryFailedVariants={onRetryFailedVariants}
          onOutputPreview={onOutputPreview}
        />
      )}
      <button
        type="button"
        className="canvas-port right"
        aria-label="右侧连接端口"
        onPointerDown={(event) => onConnect(event, node.id, "right")}
      />
      <span
        className="canvas-node-resize"
        onPointerDown={(event) => onResize(event, node)}
        title="调整卡片大小"
      />
    </article>
  );
}


export const MemoizedCanvasNodeCard = memo(CanvasNodeCard, areCanvasNodeCardPropsEqual);
