"use client";

import { forwardRef, type ClipboardEvent as ReactClipboardEvent } from "react";
import AgentOrb, { busyOrbState } from "@/components/AgentOrb";
import CanvasReferenceDraftStrip from "@/components/CanvasReferenceDraftStrip";
import CanvasReferenceList from "@/components/canvas/CanvasReferenceList";
import CreationParameterEditor from "@/components/CreationParameterEditor";
import ReferenceMentionEditor from "@/components/ReferenceMentionEditor";
import { CanvasVariantRequirementsEditor } from "@/components/canvas/CanvasVariantEditors";
import { canvasMentionOption } from "@/components/canvas/mention-options";
import type { CanvasDocument, CanvasGroup, CanvasNode, CanvasRuntimeState, CanvasMediaKind } from "@/lib/canvas/types";
import { CANVAS_Z_INDEX } from "@/lib/canvas/layers";
import { nodeLabel } from "@/lib/canvas/menu-labels";
import { replaceNaturalReferenceLabels } from "@/lib/creative-references";
import type { CanvasReferenceDraft, CanvasReuseDraft } from "@/lib/canvas/reuse";
import type { CreationSettings } from "@/lib/creation/settings";

type CanvasGenerationMode = Exclude<CanvasMediaKind, "audio">;
export type CanvasDeckMode = CanvasGenerationMode | "text";

export type CanvasDeckProps = {
  deckCollapsed: boolean;
  selectedAudioNode: boolean;
  mode: CanvasDeckMode;
  selectedSingle?: CanvasNode;
  selectedGroup?: CanvasGroup;
  selectedNodes: CanvasNode[];
  agentBusy: boolean;
  references: CanvasNode[];
  composerReferences: CanvasNode[] | CanvasReferenceDraft[];
  composerSemanticBadges: string[];
  composerPrompt: string;
  activeDeckPrompt: string;
  reuseDraft: CanvasReuseDraft | null;
  referenceOwnerId?: string;
  document: CanvasDocument;
  mentionCandidates: CanvasNode[];
  canvasPromptOptimizing: boolean;
  chatModelsAvailable: boolean;
  generationBusy: boolean;
  runButtonLabel: string;
  runButtonTitle: string;
  deckModelState: { unavailableModelId?: string };
  runtime: CanvasRuntimeState | null;
  smartVariantSources: readonly unknown[];
  reusePromptBeforeOptimization: string | null;
  deckPromptBeforeOptimization: string | null;
  smartVariantLoading: boolean;
  smartVariantBeforeApply: string | null;
  variantRequirements: string;
  variantRequirementCount: number;
  settings: CreationSettings;
  deckPromptRef: React.RefObject<HTMLDivElement | null>;
  onToggleCollapsed: () => void;
  onModeChange: (mode: CanvasDeckMode | "clear-selection") => void;
  onOpenFilePicker: () => void;
  onAddReuseFiles: (files: File[]) => void;
  onReferenceFiles: (files: File[]) => void;
  onRemoveReuseReference: (id: string) => void;
  onReorderReuseReference: (from: number, to: number) => void;
  onPasteReuseReference: () => void;
  onClearReuseReferences: () => void;
  onPreviewReuse: (reference: CanvasReferenceDraft) => void;
  onReverseReusePrompt: () => void;
  onPreviewReference: (node: CanvasNode) => void;
  onReorderReference: (ownerId: string, draggedId: string, targetId: string) => void;
  onRemoveComposerReference: (nodeId: string) => void;
  onClearComposerReferences: () => void;
  onPasteReferences: () => void;
  onPromptPaste: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  onMentionEscape: () => void;
  onPromptChange: (value: string, cursor: number) => void;
  onMentionSelect: (value: string, cursor: number) => void;
  onRun: () => void;
  onOptimizePrompt: () => void;
  onUndoPromptOptimization: () => void;
  onClearPrompt: () => void;
  onOpenSmartVariant: () => void;
  onChangeVariantRequirements: (value: string) => void;
  onUndoSmartVariant: () => void;
  onChangeSettings: (settings: CreationSettings) => void;
  onVideoInputModeChange?: () => void;
};

const CanvasDeck = forwardRef<HTMLDivElement, CanvasDeckProps>(function CanvasDeck(props, deckRef) {
  const {
    deckCollapsed, selectedAudioNode, mode, selectedSingle, selectedGroup, selectedNodes,
    references, composerReferences, composerSemanticBadges, composerPrompt, activeDeckPrompt,
    reuseDraft, referenceOwnerId, document, mentionCandidates, canvasPromptOptimizing, chatModelsAvailable,
    generationBusy, runButtonLabel, runButtonTitle, deckModelState, runtime,
    smartVariantSources, smartVariantLoading, smartVariantBeforeApply, reusePromptBeforeOptimization, deckPromptBeforeOptimization, variantRequirements,
    variantRequirementCount, settings, deckPromptRef, agentBusy, onToggleCollapsed, onModeChange,
    onOpenFilePicker, onAddReuseFiles, onReferenceFiles, onRemoveReuseReference, onReorderReuseReference,
    onPasteReuseReference, onClearReuseReferences, onPreviewReuse, onReverseReusePrompt,
    onPreviewReference, onReorderReference, onRemoveComposerReference, onClearComposerReferences,
    onPasteReferences, onPromptPaste, onMentionEscape, onPromptChange, onMentionSelect, onRun,
    onOptimizePrompt, onUndoPromptOptimization, onClearPrompt, onOpenSmartVariant,
    onChangeVariantRequirements, onUndoSmartVariant, onChangeSettings, onVideoInputModeChange,
  } = props;
  const mentionOptions = mentionCandidates.map((node, index) => canvasMentionOption(document, node, index));
  return (
        <div ref={deckRef} className={`canvas-deck legacy-deck-hidden ${deckCollapsed ? "collapsed" : ""}${selectedAudioNode ? " audio-node-selected" : ""}`}>
          <div className="canvas-deck-top">
            <div className="canvas-mode-switch">
              <button
                type="button"
                className={mode === "image" ? "active" : ""}
                onClick={() => {
                  if (selectedSingle) onModeChange("clear-selection");
                  onModeChange("image");
                }}
              >
                ✦ 图片
              </button>
              <button
                type="button"
                className={mode === "video" ? "active" : ""}
                onClick={() => {
                  if (selectedSingle) onModeChange("clear-selection");
                  onModeChange("video");
                }}
              >
                ▶ 视频
              </button>
              <button
                type="button"
                className={mode === "text" ? "active" : ""}
                onClick={() => {
                  if (selectedSingle) onModeChange("clear-selection");
                  onModeChange("text");
                }}
              >
                <AgentOrb state={busyOrbState(agentBusy)} size={13} label="" />
                Agent
              </button>
            </div>
            <div className="canvas-deck-context">
              <i />
              <b>
                {selectedSingle
                  ? nodeLabel(selectedSingle)
                  : selectedGroup
                    ? selectedGroup.name
                    : "智能创作"}
              </b>
              <small>
                {selectedNodes.length > 1 || selectedGroup
                  ? `将所选内容作为参考 · 当前输出 ${mode === "video" ? "视频" : mode === "text" ? "Agent 回复" : "图片"}`
                  : references.length
                    ? reuseDraft
                      ? `复用草稿 · ${composerReferences.length} 个参考素材`
                      : `已连接 ${composerReferences.length} 个参考素材`
                    : selectedSingle?.type === "media" &&
                        selectedSingle.data.url
                      ? "再次生成会创建新分支；原节点和原连线保持不变"
                      : "生成结果直接进入画布卡片"}
              </small>
            </div>
            <button
              type="button"
              className="canvas-deck-collapse"
              aria-label={deckCollapsed ? "展开创作面板" : "收起创作面板"}
              onClick={onToggleCollapsed}
            >
              {deckCollapsed ? "⌃" : "⌄"}
            </button>
          </div>
          {!deckCollapsed && !selectedAudioNode && (
            <>
              <div
                className="canvas-deck-main"
                onDragOver={(event) => {
                  if (!reuseDraft) event.preventDefault();
                }}
                onDrop={(event) => {
                  if (reuseDraft) return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.dataTransfer.files.length) onReferenceFiles(Array.from(event.dataTransfer.files));
                }}
                onPaste={(event) => {
                  if (reuseDraft) return;
                  const image = [...event.clipboardData.items].find((item) => item.type.startsWith("image/"));
                  if (image?.getAsFile()) {
                    event.preventDefault();
                    event.stopPropagation();
                    onReferenceFiles([image.getAsFile()!]);
                  }
                }}
              >
                <div className="canvas-deck-reference-row">
                  {!reuseDraft && (
                    <button
                      type="button"
                      className="canvas-context-add"
                      aria-label="导入参考素材"
                      onClick={() => onOpenFilePicker()}
                    >
                      ＋
                    </button>
                  )}
                  {reuseDraft ? (
                    <CanvasReferenceDraftStrip
                      references={reuseDraft.references}
                      onFiles={(files) => void onAddReuseFiles(files)}
                      onRemove={onRemoveReuseReference}
                      onReorder={onReorderReuseReference}
                      onPaste={() => void onPasteReuseReference()}
                      onClear={() => onClearReuseReferences()}
                      onPreview={onPreviewReuse}
                      emptyLabel="添加参考图"
                        trailing={
                          <>
                            <button type="button" disabled={!reuseDraft.references.length} onClick={() => void onReverseReusePrompt()}>⌁ 反推</button>
                          </>
                        }
                    />
                  ) : (
                    <CanvasReferenceList
                      document={document}
                      ownerId={referenceOwnerId}
                      nodes={references}
                      onPreview={onPreviewReference}
                      onReorder={onReorderReference}
                      onRemove={onRemoveComposerReference}
                      onClear={onClearComposerReferences}
                      onAdd={() => onOpenFilePicker()}
                      onPaste={() => void onPasteReferences()}
                      variant="deck"
                    />
                  )}
                  <div className="canvas-input-semantics" aria-label="引用语义">
                    <span className="canvas-input-semantics-label">引用方式</span>
                    {composerSemanticBadges.map((badge) => (
                      <span key={badge}>{badge}</span>
                    ))}
                  </div>
                </div>
                <div className="canvas-deck-prompt-row">
                  <div className="canvas-prompt-input-wrap">
                  <ReferenceMentionEditor
                    ref={deckPromptRef}
                    value={
                      selectedSingle?.type === "prompt"
                        ? String(
                            selectedSingle.data.agentPrompt ||
                              selectedSingle.data.text ||
                              "",
                          )
                      : composerPrompt
                    }
                    references={mentionOptions}
                    ariaLabel="创作提示词"
                    className="canvas-deck-prompt-editor"
                    menuClassName="canvas-mention-menu"
                    allowRichPaste={false}
                    onPaste={onPromptPaste}
                    onChange={onPromptChange}
                    onMentionSelect={(_index, value, cursor) => onMentionSelect(value, cursor)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") onMentionEscape();
                      if (mode === "text" && event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void onRun();
                        return;
                      }
                      if (
                        (event.ctrlKey || event.metaKey) &&
                        event.key === "Enter"
                      ) {
                        event.preventDefault();
                          void onRun();
                      }
                    }}
                    placeholder={
                      mode === "video"
                        ? "描述视频动作、镜头、节奏和声音… 输入 @ 可调用参考图"
                        : mode === "text"
                          ? "输入要交给 Agent 的任务… 可连接上游文本形成对话上下文"
                          : "描述你想生成的画面… 输入 @ 可调用参考图"
                    }
                    transformPastedText={(text) => replaceNaturalReferenceLabels(
                      text,
                      mentionOptions,
                    ).value}
                  />
                  </div>
                  <div className="canvas-deck-prompt-actions" aria-label="提示词操作">
                    {activeDeckPrompt.trim() && <button type="button" className="canvas-prompt-ai-action" disabled={canvasPromptOptimizing} aria-busy={canvasPromptOptimizing} title={chatModelsAvailable ? "使用 AI 优化当前提示词" : "请先在模型库启用对话模型"} onClick={() => void onOptimizePrompt()}><span aria-hidden="true">✦</span><span>{canvasPromptOptimizing ? "优化中…" : "AI 优化"}</span></button>}
                    {((reuseDraft && reusePromptBeforeOptimization !== null) || (!reuseDraft && deckPromptBeforeOptimization !== null)) && <button type="button" className="canvas-prompt-undo-action" disabled={canvasPromptOptimizing} onClick={onUndoPromptOptimization}><span aria-hidden="true">↶</span><span>撤销</span></button>}
                    {activeDeckPrompt.trim() && <button type="button" className="canvas-prompt-clear-action" aria-label={reuseDraft ? "清空复用提示词" : "清空提示词"} onClick={onClearPrompt}><span aria-hidden="true">⌫</span><span>清空</span></button>}
                  </div>
                  <button
                    type="button"
                    className="canvas-run-button"
                    disabled={generationBusy}
                    aria-busy={generationBusy}
                    aria-label={runButtonTitle}
                    title={`${runButtonTitle}（Ctrl + Enter）`}
                    onClick={() => void onRun()}
                  >
                    <span aria-hidden="true">✦</span>
                    <b>{runButtonLabel}</b>
                    <small>Ctrl + Enter</small>
                  </button>
                </div>
              </div>
              <div className="canvas-deck-params">
                {selectedSingle?.type === "generator" && (
                  <div className="canvas-variant-editor">
                    <div className="canvas-variant-editor-head">
                      <div>
                        <b>变体要求</b>
                        <small>逐条编辑、回车新增</small>
                      </div>
                      <div className="canvas-variant-editor-head-actions">
                        <button
                          type="button"
                          className="canvas-smart-variant-button"
                          disabled={!chatModelsAvailable || !smartVariantSources.length || smartVariantLoading}
                          title={!smartVariantSources.length ? "请先连接至少一个有文案的 Agent 节点" : "使用 AI 整理变体"}
                          onClick={() => void onOpenSmartVariant()}
                        >
                          ✦ {smartVariantLoading ? "分析中…" : "一键变体"}
                        </button>
                        <span>{variantRequirementCount} 条</span>
                      </div>
                    </div>
                    <CanvasVariantRequirementsEditor
                      ariaLabel="变体要求"
                      value={
                        variantRequirements
                      }
                      references={mentionOptions}
                      menuClassName="canvas-mention-menu canvas-variant-mention-menu"
                      onPasteFiles={onReferenceFiles}
                      onChange={onChangeVariantRequirements}
                      note="每条要求都会叠加到共同提示词，并按顺序生成独立结果。"
                    />
                    {smartVariantBeforeApply !== null && (
                      <button type="button" className="canvas-smart-variant-undo" onClick={onUndoSmartVariant}>↶ 撤销上次应用</button>
                    )}
                  </div>
                )}
                <CreationParameterEditor
                  settings={settings}
                  runtime={runtime}
                  unavailableModelId={deckModelState.unavailableModelId}
                  referenceCount={composerReferences.length}
                  portalZIndex={CANVAS_Z_INDEX.portalPopover}
                  dialogPortalZIndex={CANVAS_Z_INDEX.modelDialog}
                  onChange={onChangeSettings}
                  onVideoInputModeChange={onVideoInputModeChange}
                />
              </div>
            </>
          )}
        </div>
  );
});

export default CanvasDeck;