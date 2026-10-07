"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type RefObject,
  type ReactNode,
} from "react";
import { CANVAS_Z_INDEX } from "@/lib/canvas/layers";
import { incomingReferences, isCanvasReadyImageSource, nodeSize } from "@/lib/canvas/model";
import { canvasVideoTargetHasImageReference, variantRequirementsFor } from "@/lib/canvas/node-editor";
import type {
  CanvasDocument,
  CanvasGenerationParams,
  CanvasInputRole,
  CanvasMaskState,
  CanvasNode,
  CanvasRuntimeState,
  CanvasUpscaleParams,
} from "@/lib/canvas/types";
import type { CanvasReferenceDraft, CanvasReuseDraft } from "@/lib/canvas/reuse";
import { BUILTIN_IMAGE_PRESETS, type CustomImagePreset, type ImagePreset, visibleImagePresetPrompt } from "@/lib/creation/image-presets";
import { IMAGE_QUALITY_OPTIONS, type CreationSettings, type VideoCreationSettings } from "@/lib/creation/settings";
import { requestPromptOptimization } from "@/lib/creation/agent";
import { canvasNodeSupportsImagePresets } from "@/lib/canvas/image-presets";
import { placeCanvasNodeEditorDock } from "@/lib/canvas/editor-layout";
import { canvasVisibleStageWidth } from "@/lib/canvas/menu-layout";
import { nodeLabel } from "@/lib/canvas/menu-labels";
import { replaceNaturalReferenceLabels } from "@/lib/creative-references";
import { canvasMentionOption } from "@/components/canvas/mention-options";
import CanvasReferenceDraftStrip from "@/components/CanvasReferenceDraftStrip";
import CreationParameterEditor from "@/components/CreationParameterEditor";
import ModelPicker from "@/components/ModelPicker";
import OneTakeDurationPicker from "@/components/OneTakeDurationPicker";
import CanvasAudioNodePanel from "@/components/canvas/CanvasAudioNodePanel";
import { CanvasGeneratorHelp, CanvasVariantRequirementsEditor } from "@/components/canvas/CanvasVariantEditors";
import CanvasImagePresetControl, { CanvasImagePresetBadge } from "@/components/canvas/CanvasImagePresetControl";
import CanvasMaskSummary from "@/components/canvas/CanvasMaskSummary";
import CanvasNodeReferenceStrip from "@/components/canvas/CanvasNodeReferenceStrip";
import CanvasUpscaleSettingsPanel from "@/components/canvas/CanvasUpscaleSettingsPanel";
import ReferenceMentionEditor from "@/components/ReferenceMentionEditor";

export type CanvasNodeEditorPopoverProps = {
  smartVariantAction?: ReactNode;
  node: CanvasNode;
  document: CanvasDocument;
  stageRef: RefObject<HTMLDivElement | null>;
  runtime: CanvasRuntimeState | null;
  editorPrompt: string;
  editorParams?: CanvasGenerationParams;
  imagePresets: CustomImagePreset[];
  onImagePresetSelect: (preset: ImagePreset | CustomImagePreset) => void;
  onImagePresetClear: () => void;
  onSaveImagePreset: (preset: CustomImagePreset) => void;
  onDeleteImagePreset: (presetId: string) => void;
  currentImageReference?: boolean;
  onCurrentImageReferenceChange?: (value: boolean) => void;
  maskState?: CanvasMaskState;
  onLocalEdit?: () => void;
  onLocalEditRemove?: () => void;
  onToggleEditor: (node: CanvasNode) => void;
  onGenerate: (
    node: CanvasNode,
    options?: { useCurrentImageAsReference?: boolean; presetId?: string; presetName?: string },
  ) => void;
  onOneTake: (node: CanvasNode, durationSeconds: number) => void;
  onNotify: (message: string, kind?: "ok" | "error") => void;
  onEditorPromptChange: (node: CanvasNode, value: string) => void;
  onEditorParamsChange: (node: CanvasNode, settings: CreationSettings) => void;
  onVideoInputModeChange: (node: CanvasNode) => void;
  onVariantRequirementsChange: (node: CanvasNode, value: string) => void;
  onReferenceReorder: (ownerId: string, draggedId: string, targetId: string) => void;
  onReferenceRemove: (ownerId: string, sourceId: string) => void;
  onReferenceDrop: (ownerId: string, sourceId: string, role: CanvasInputRole) => void;
  onAddReferenceFiles: (ownerId: string, files: File[]) => void;
  onPickFromCanvas?: (role?: CanvasInputRole) => void;
  onRestoreAutomatic: (targetId: string) => void;
  branchDraft?: CanvasReuseDraft | null;
  onDraftReferenceFiles?: (files: File[]) => void;
  onDraftReferenceRemove?: (id: string) => void;
  onDraftReferenceReorder?: (from: number, to: number) => void;
  onDraftReferenceNodeDrop?: (nodeId: string) => void;
  onDraftReferencePreview?: (reference: CanvasReferenceDraft) => void;
  onDraftReferencePaste?: () => void;
  editorContexts: CanvasNode[];
  onTextPreview: (node: CanvasNode) => void;
  mentionCandidates: CanvasNode[];
  onOutputPreview: (node: CanvasNode) => void;
  upscaleParams?: CanvasUpscaleParams;
  upscaleSourceUrl?: string;
  onUpscaleParamsChange?: (params: CanvasUpscaleParams) => void;
  onReplaceAudio: (nodeId: string, file: File) => void;
  onAudioDurationChange: (nodeId: string, durationSeconds: number) => void;
  resolveInputRoles: (document: CanvasDocument, targetId: string) => ReadonlyMap<string, CanvasInputRole | undefined>;
  resolveVideoCapabilities: (settings: VideoCreationSettings, runtime: CanvasRuntimeState | null) => { supportsAudio: boolean };
};

function CanvasNodeEditorPopover({
  smartVariantAction,
  node,
  document,
  stageRef,
  runtime,
  editorPrompt,
  editorParams,
  maskState,
  onLocalEdit,
  onLocalEditRemove,
  onToggleEditor,
  onGenerate,
  onOneTake,
  onNotify,
  onEditorPromptChange,
  onEditorParamsChange,
  onVideoInputModeChange,
  onVariantRequirementsChange,
  onReferenceReorder,
  onReferenceRemove,
  onReferenceDrop,
  onAddReferenceFiles,
  onPickFromCanvas,
  onRestoreAutomatic,
  branchDraft,
  onDraftReferenceFiles,
  onDraftReferenceRemove,
  onDraftReferenceReorder,
  onDraftReferenceNodeDrop,
  onDraftReferencePreview,
  onDraftReferencePaste,
  editorContexts,
  onTextPreview,
  mentionCandidates,
  onOutputPreview,
  upscaleParams,
  upscaleSourceUrl,
  onUpscaleParamsChange,
  onReplaceAudio,
  onAudioDurationChange,
  imagePresets,
  onImagePresetSelect,
  onImagePresetClear,
  onSaveImagePreset,
  onDeleteImagePreset,
  currentImageReference,
  onCurrentImageReferenceChange,
  resolveInputRoles,
  resolveVideoCapabilities,
}: CanvasNodeEditorPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: 18, top: 86 });
  const [isCompact, setIsCompact] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [promptOptimizing, setPromptOptimizing] = useState(false);
  const [promptBeforeOptimization, setPromptBeforeOptimization] = useState<string | null>(null);
  const [oneTakeDurationOpen, setOneTakeDurationOpen] = useState(false);
  const [useCurrentImageAsReference, setUseCurrentImageAsReference] = useState(currentImageReference ?? true);
  const [imageDockPanel, setImageDockPanel] = useState<"params" | "variant" | null>(null);
  const imageDockParamsRef = useRef<HTMLDivElement | null>(null);
  const imageDockFileRef = useRef<HTMLInputElement | null>(null);
  const data = node.data;
  const audioNode = node.type === "media" && data.kind === "audio";
  const isImageNode = !audioNode && node.type !== "prompt" && node.type !== "upscale" && data.kind !== "video";
  const isVariantGenerator = node.type === "generator" && data.kind === "video";
  const isDockNode = isImageNode || isVariantGenerator;
  const stackedEditor = !promptExpanded && !audioNode && !isDockNode;
  const isVideoNode = data.kind === "video";
  const isAgentNode = node.type === "prompt";
  const isUpscaleNode = node.type === "upscale";
  const editorChatAvailable = Boolean(
    runtime?.models?.some(
      (model) => model.kind === "chat" && model.enabled !== false && model.published !== false,
    ),
  );
  const size = nodeSize(node);
  const pending = data.status === "queued" || data.status === "running";
  const upscaleMissingInput = node.type === "upscale" && !upscaleSourceUrl;
  const editorReferences = incomingReferences(document, node.id);
  const readyOneTakeReferences = editorReferences.filter(isCanvasReadyImageSource);
  const inPlaceVideo = canvasVideoTargetHasImageReference(document, node);
  const branchReferences = branchDraft?.references || [];
  const canUseCurrentImageAsReference =
    node.type === "media" &&
    data.kind === "image" &&
    Boolean(data.url) &&
    !branchDraft;
  const variantRequirements = node.type === "generator" ? variantRequirementsFor(node) : [];
  const imageParams = isImageNode && editorParams && editorParams.kind === "image" ? editorParams : null;
  const imageQualityLabel = imageParams
    ? (IMAGE_QUALITY_OPTIONS.find((option) => option.value === imageParams.quality)?.label.replace("质量", "") || imageParams.quality)
    : "";
  const imageSizeLabel = imageParams
    ? imageParams.sizeMode === "system"
      ? imageParams.resolution
      : `${imageParams.width}×${imageParams.height}`
    : "";
  const imageParameterSummary = imageParams
    ? `${imageParams.aspect} · ${imageQualityLabel} · ${imageSizeLabel} · ${imageParams.count}张`
    : "";
  const videoEditorParams = editorParams && editorParams.kind === "video" ? editorParams : null;
  const textEditorParams = editorParams && editorParams.kind === "text" ? editorParams : null;
  const modelNameForSummary = textEditorParams
    ? (runtime?.models?.find((item) => item.id === textEditorParams.model)?.displayName || runtime?.models?.find((item) => item.id === runtime?.settings.agentModelId)?.displayName || "自动选择")
    : "";
  const webModeLabel = textEditorParams
    ? (textEditorParams.webMode === "always" ? "始终联网" : textEditorParams.webMode === "auto" ? "智能联网" : "关闭联网")
    : "";
  const videoParameterSummary = videoEditorParams
    ? `${videoEditorParams.aspect} · ${videoEditorParams.duration}s · ${videoEditorParams.resolution}`
    : "";
  const upscaleParameterSummary = upscaleParams ? `${upscaleParams.scale}倍 · ${upscaleParams.target}` : "";
  const parameterSummary = imageParams
    ? imageParameterSummary
    : (videoParameterSummary || (textEditorParams ? `${modelNameForSummary} · ${webModeLabel}` : "") || upscaleParameterSummary || "");
  const dockModelValue = imageParams?.model ?? videoEditorParams?.model ?? textEditorParams?.model;
  const dockModelCapability = imageParams
    ? (imageParams.mask ? "edit" : "generate")
    : videoEditorParams
      ? "video-generate"
      : textEditorParams
        ? "chat"
        : null;
  const dockModelDefaultId = imageParams
    ? runtime?.settings.defaultImageModelId
    : videoEditorParams
      ? runtime?.settings.defaultVideoModelId
      : runtime?.settings.agentModelId;
  const referenceFileAccept = isUpscaleNode
    ? "image/png,image/jpeg,image/webp,.txt,.md,.markdown,.json,.csv,.tsv,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.java,.sql,.xml,.svg,.yaml,.yml,.sh,.ps1"
    : "image/*,video/*,audio/*,.txt,.md,.markdown,.json,.csv,.tsv,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.java,.sql,.xml,.svg,.yaml,.yml,.sh,.ps1";
  const dockHint = isUpscaleNode
    ? (upscaleMissingInput ? "请连接一张已完成的图片" : "连接图片后提交超分")
    : isAgentNode
      ? "Enter 发送 · Shift + Enter 换行"
      : inPlaceVideo
        ? "引用图片 · 生成新视频"
        : isVideoNode
          ? "右侧生成新视频"
          : node.type === "media" && data.kind === "image" && data.url
            ? "当前图片作参考 · 右侧生成新图"
            : node.type === "generator"
              ? "共同提示词 + 逐条编辑、回车新增"
              : "Ctrl/Cmd + Enter 生成";
  const promptPlaceholder = isAgentNode
    ? "输入 Agent 任务… 输入 @ 引用节点"
    : isVideoNode
      ? "描述动作、镜头和声音… 输入 @ 引用节点"
      : "描述想生成的画面… 输入 @ 引用节点";
  const promptLabelSmall = promptExpanded
    ? "@ 引用节点 · 编辑完成后点击保存"
    : isAgentNode
      ? "@ 引用节点 · Enter 发送"
      : "@ 引用节点 · Ctrl/Cmd + Enter 生成";
  const generateLabel = pending
    ? "处理中…"
    : isUpscaleNode
      ? "提交超分"
      : isAgentNode
        ? "发送"
        : inPlaceVideo
          ? "生成新视频"
          : node.type === "generator"
            ? (data.kind === "video" ? "生成新视频" : "生成新图")
            : node.type === "media" && data.kind === "image" && data.url
              ? "生成新图"
              : "生成";
  const editorActionLabel = promptExpanded ? "保存" : generateLabel;
  const handleEditorAction = () => {
    if (promptExpanded) {
      setPromptBeforeOptimization(null);
      setPromptExpanded(false);
      window.setTimeout(() => promptRef.current?.focus(), 0);
      return;
    }
    if (canUseCurrentImageAsReference) {
      onGenerate(node, generationOptions);
      return;
    }
    onGenerate(node);
  };

  const hasPresetReferenceImage = canUseCurrentImageAsReference || Boolean(branchDraft?.sourceNodeId && data.url) || editorReferences.some(isCanvasReadyImageSource) || branchReferences.some((reference) => reference.kind === "image" && Boolean(reference.url));
  const supportsImagePresets = canvasNodeSupportsImagePresets(node);
  const imagePresetEnabled = supportsImagePresets && !pending;
  const chooseImagePreset = (preset: ImagePreset | CustomImagePreset) => {
    setSelectedPresetId(preset.id);
    setSelectedPresetName(preset.label);
    onImagePresetSelect(preset);
    if (imageParams && "aspectRatio" in preset && preset.aspectRatio) onEditorParamsChange(node, { ...imageParams, aspect: preset.aspectRatio });
    setImageDockPanel(null);
    onNotify(`已套用预设：${preset.label}`);
  };
  const clearImagePreset = () => {
    if (!selectedPresetId) return;
    setSelectedPresetId("");
    setSelectedPresetName("");
    onImagePresetClear();
  };
  const [selectedPresetId, setSelectedPresetId] = useState(supportsImagePresets ? (branchDraft?.presetId || node.data.generation?.presetId || "") : "");
  const [selectedPresetName, setSelectedPresetName] = useState(supportsImagePresets ? (branchDraft?.presetName || node.data.generation?.presetName || "") : "");
  const customImagePresetList = imagePresets;
  const activeImagePreset = imagePresetEnabled && supportsImagePresets
    ? [...BUILTIN_IMAGE_PRESETS, ...customImagePresetList].find((preset) => preset.id === selectedPresetId)
    : undefined;
  const visibleEditorPrompt = supportsImagePresets
    ? visibleImagePresetPrompt(editorPrompt, selectedPresetId, customImagePresetList)
    : editorPrompt;
  const generationOptions = {
    ...(canUseCurrentImageAsReference ? { useCurrentImageAsReference } : {}),
    ...(supportsImagePresets && selectedPresetId ? { presetId: selectedPresetId } : {}),
    ...(supportsImagePresets && selectedPresetName ? { presetName: selectedPresetName } : {}),
  };
  const editorSubtitle = node.type === "generator"
    ? (data.kind === "video" ? "视频变体 · 生成新视频" : "变体 · 生成新图")
    : node.type === "prompt"
      ? "Agent 节点"
      : data.kind === "video"
        ? "视频节点"
        : audioNode
          ? "音频素材"
          : node.type === "upscale"
            ? (upscaleMissingInput ? "超分节点 · 请连接一张已完成的图片" : "超分节点 · 已连接图片")
            : node.type === "media" && data.kind === "image" && data.url
              ? "当前图片作参考 · 右侧生成新图"
              : "图片节点";

  useEffect(() => {
    setPromptBeforeOptimization(null);
    setSelectedPresetId(supportsImagePresets ? (branchDraft?.presetId || node.data.generation?.presetId || "") : "");
    setSelectedPresetName(supportsImagePresets ? (branchDraft?.presetName || node.data.generation?.presetName || "") : "");
  }, [branchDraft?.presetId, branchDraft?.presetName, node.data.generation?.presetId, node.data.generation?.presetName, node.id, supportsImagePresets]);

  useEffect(() => {
    setUseCurrentImageAsReference(currentImageReference ?? true);
  }, [currentImageReference, node.id]);

  async function optimizeEditorPrompt() {
    if (!visibleEditorPrompt.trim()) return;
    if (!editorChatAvailable) return onNotify("没有可用的对话模型，请先在主界面模型库启用。", "error");
    if (promptOptimizing) return;
    const original = visibleEditorPrompt;
    setPromptOptimizing(true);
    try {
      const optimized = await requestPromptOptimization(
        original,
        [],
        runtime?.settings.agentModelId || undefined,
        "polish_text",
      );
      setPromptBeforeOptimization(original);
      onEditorPromptChange(node, optimized);
      window.setTimeout(() => promptRef.current?.focus(), 0);
      onNotify("已完成 AI 优化，可继续修改；也可以撤销");
    } catch {
      onNotify("AI 优化失败", "error");
    } finally {
      setPromptOptimizing(false);
    }
  }

  function undoEditorPromptOptimization() {
    if (promptBeforeOptimization === null) return;
    onEditorPromptChange(node, promptBeforeOptimization);
    setPromptBeforeOptimization(null);
    window.setTimeout(() => promptRef.current?.focus(), 0);
  }

  function handleEditorPromptChange(value: string) {
    setPromptBeforeOptimization(null);
    onEditorPromptChange(node, value);
  }

  function handleNodePromptPaste(event: ReactClipboardEvent<HTMLDivElement>) {
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
  }

  const promptOptimizationActions = (
    <div className="canvas-node-editor-prompt-actions" aria-label="提示词操作">
      {visibleEditorPrompt.trim() && <button type="button" className="canvas-prompt-clear-action" disabled={promptOptimizing} title="清空当前节点提示词" aria-label="清空当前节点提示词" onClick={() => { handleEditorPromptChange(""); setPromptBeforeOptimization(null); window.setTimeout(() => promptRef.current?.focus(), 0); }}><span aria-hidden="true">⌫</span><span>清空</span></button>}
      {visibleEditorPrompt.trim() && <button type="button" disabled={promptOptimizing} aria-busy={promptOptimizing} title={editorChatAvailable ? "使用 AI 优化当前提示词" : "请先在模型库启用对话模型"} onClick={() => void optimizeEditorPrompt()}><span aria-hidden="true">✦</span><span>{promptOptimizing ? "优化中…" : "AI 优化"}</span></button>}
      {promptBeforeOptimization !== null && <button type="button" disabled={promptOptimizing} title="撤销 AI 优化" onClick={undoEditorPromptOptimization}><span aria-hidden="true">↶</span><span>撤销</span></button>}
    </div>
  );

  useEffect(() => {
    setPromptExpanded(false);
    setOneTakeDurationOpen(false);
  }, [node.id]);

  useLayoutEffect(() => {
    const textarea = promptRef.current;
    if (!textarea) return;
    const syncPromptHeight = () => {
      const mobile = window.matchMedia("(max-width: 720px)").matches;
      const shortViewport = window.innerHeight <= 620;
      const baseMinHeight = promptExpanded
        ? (mobile ? 180 : 220)
        : stackedEditor
          ? (mobile ? 50 : 54)
          : (mobile ? 76 : 86);
      const baseMaxHeight = promptExpanded
        ? (mobile ? 360 : 460)
        : stackedEditor
          ? (mobile ? 88 : 96)
          : (mobile ? 112 : 128);
      const isCompactPromptDock = isDockNode && !promptExpanded;
      const minHeight = isCompactPromptDock
        ? (mobile ? 56 : 64)
        : (shortViewport && !promptExpanded ? Math.min(baseMinHeight, 82) : baseMinHeight);
      const maxHeight = isCompactPromptDock
        ? (mobile ? 132 : 152)
        : (shortViewport && !promptExpanded ? Math.min(baseMaxHeight, 132) : baseMaxHeight);
      textarea.style.height = "auto";
      const contentHeight = textarea.scrollHeight;
      textarea.style.height = `${Math.min(maxHeight, Math.max(minHeight, contentHeight))}px`;
      textarea.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
    };
    syncPromptHeight();
    const frame = window.requestAnimationFrame(syncPromptHeight);
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(syncPromptHeight)
      : null;
    if (observer) observer.observe(textarea.parentElement || textarea);
    window.addEventListener("resize", syncPromptHeight);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", syncPromptHeight);
    };
  }, [editorPrompt, isCompact, isDockNode, node.id, promptExpanded]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (promptExpanded) {
        event.preventDefault();
        event.stopPropagation();
        setPromptExpanded(false);
      }
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [promptExpanded]);

  useEffect(() => {
    if (imageDockPanel !== "params") return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && imageDockParamsRef.current?.contains(target)) return;
      setImageDockPanel(null);
    };
    window.document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => window.document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [imageDockPanel]);



  const reposition = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const zoom = Math.max(0.12, document.camera.zoom || 1);
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    const nextCompact = stageWidth < 960 || zoom < 0.58;
    const microEditor = zoom < 0.35;
    if (nextCompact !== isCompact) setIsCompact(nextCompact);
    const popoverWidth = popoverRef.current?.offsetWidth || (microEditor ? 360 : nextCompact ? 510 : 640);
    const stageRect = stage.getBoundingClientRect();
    const nodeElement = Array.from(
      stage.querySelectorAll<HTMLElement>("[data-canvas-node-id]"),
    ).find((element) => element.dataset.canvasNodeId === node.id);
    const nodeRect = nodeElement?.getBoundingClientRect();
    const anchor = nodeRect
      ? {
          left: nodeRect.left - stageRect.left,
          top: nodeRect.top - stageRect.top,
          width: nodeRect.width,
          height: nodeRect.height,
        }
      : {
          left: node.x * zoom + document.camera.x,
          top: node.y * zoom + document.camera.y,
          width: size.w * zoom,
          height: size.h * zoom,
        };
    // Use the node's real screen-space anchor for every editor mode. The
    // panel may clamp to the stage margins when it is wider than the node,
    // but it must not be recentered independently from the node.
    /* 参数面板同理：贴到面板左边，别让 Agent 面板压住正在调的那几个参数。 */
    const visibleStage = { width: canvasVisibleStageWidth(stage), height: stageHeight };
    // Keep the complete editor laid out below the node. The editor never jumps
    // above its owner; only its prompt field and explicit drawers can scroll.
    const nextPosition = placeCanvasNodeEditorDock(
      anchor,
      visibleStage,
      { width: popoverWidth, height: 0 },
      14,
      12,
    );
    setPosition((current) =>
      current.left === nextPosition.left &&
      current.top === nextPosition.top
        ? current
        : nextPosition,
    );
  }, [audioNode, document.camera.x, document.camera.y, document.camera.zoom, isCompact, isDockNode, isImageNode, node.x, node.y, promptExpanded, size.h, size.w, stackedEditor, stageRef]);

  useLayoutEffect(() => {
    reposition();
    let frame = 0;
    const handleResize = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(reposition);
    };
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(handleResize)
      : null;
    if (observer) {
      if (popoverRef.current) observer.observe(popoverRef.current);
      if (stageRef.current) observer.observe(stageRef.current);
      const nodeElement = Array.from(
        stageRef.current?.querySelectorAll<HTMLElement>("[data-canvas-node-id]") || [],
      ).find((element) => element.dataset.canvasNodeId === node.id);
      if (nodeElement) observer.observe(nodeElement);
    }
    window.addEventListener("resize", handleResize);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [reposition]);

  return (
    <>
    <div
      ref={popoverRef}
       className={`canvas-node-editor-popover canvas-node-editor-dock${isDockNode ? " is-image-dock" : ""}${isVariantGenerator ? " is-video-variant" : ""}${!audioNode && !isDockNode ? " is-columns-node" : ""}${promptExpanded ? " is-prompt-expanded" : ""}`}
      data-placement="bottom"
      data-density={document.camera.zoom < 0.35 ? "micro" : isCompact ? "compact" : "comfortable"}
      data-node-kind={node.type === "prompt" ? "agent" : node.type === "upscale" ? "upscale" : data.kind === "video" ? "video" : data.kind === "audio" ? "audio" : "image"}
      data-prompt-expanded={promptExpanded ? "true" : "false"}
      data-node-id={node.id}
      aria-label={`${nodeLabel(node)}编辑器`}
      style={{
        left: position.left,
        top: position.top,
      }}
      onPointerDown={(event) => {
        const target = event.target as Node;
        if (imageDockPanel === "params" && !imageDockParamsRef.current?.contains(target)) {
          setImageDockPanel(null);
        }
        event.stopPropagation();
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="canvas-node-editor-surface">
       <div className="canvas-node-editor-head">
        <div className="canvas-node-editor-identity">
          <span className="canvas-node-editor-status-dot" aria-hidden="true" />
          <div>
            <b>{nodeLabel(node)}</b>
             <small>{editorSubtitle} · 节点内编辑</small>
          </div>
        </div>
        <div className="canvas-node-editor-head-actions">
          <span>编辑中</span>
           {!audioNode && node.type !== "upscale" && <button
            type="button"
            className="canvas-node-editor-expand"
            title={promptExpanded ? "收回编辑" : "放大编辑"}
            {...(isDockNode ? { "data-tooltip": promptExpanded ? "收回编辑" : "放大编辑" } : {})}
            aria-label={promptExpanded ? "收回编辑" : "放大编辑"}
            aria-expanded={promptExpanded}
            onClick={(event) => {
              event.stopPropagation();
              setPromptExpanded((value) => !value);
            }}
          >
            <span aria-hidden="true">{promptExpanded ? "⤡" : "⤢"}</span>
           </button>}
          <button
            type="button"
            className={node.type === "upscale" && pending ? "canvas-node-editor-collapse" : undefined}
            {...(isDockNode ? { "data-tooltip": node.type === "upscale" && pending ? "收起超分面板" : "关闭节点参数" } : { title: node.type === "upscale" && pending ? "收起超分面板" : "关闭节点参数" })}
            onClick={() => onToggleEditor(node)}
            aria-label={node.type === "upscale" && pending ? "收起超分面板" : "关闭节点参数"}
          >×</button>
        </div>
      </div>
      <div className="canvas-node-editor-body">
         {audioNode ? (
           <CanvasAudioNodePanel
             node={node}
             onReplaceAudio={onReplaceAudio}
             onDurationChange={onAudioDurationChange}
           />
          ) : isDockNode ? (
           <div className="canvas-node-editor-image-dock">
            <div className="canvas-node-editor-dock-chips">
              <CanvasImagePresetControl
                enabled={imagePresetEnabled}
                hasReferenceImage={hasPresetReferenceImage}
                selectedPresetId={selectedPresetId}
                imagePresets={customImagePresetList}
                onSelect={chooseImagePreset}
                onClear={clearImagePreset}
                onSave={onSaveImagePreset}
                onDelete={onDeleteImagePreset}
                onNotify={onNotify}
              />
              <button type="button" className="canvas-node-editor-dock-chip" onClick={() => onPickFromCanvas ? onPickFromCanvas() : imageDockFileRef.current?.click()} aria-label="从画布选择参考素材" data-tooltip="从画布选择参考素材">
                <span aria-hidden="true">⌁</span> 参考
              </button>
              {onPickFromCanvas && <button type="button" className="canvas-node-editor-dock-chip" onClick={() => imageDockFileRef.current?.click()} aria-label="上传参考素材" data-tooltip="上传参考素材">
                <span aria-hidden="true">↥</span> 上传
              </button>}
              {node.type === "media" && node.data.kind === "image" && node.data.url && onLocalEdit && maskState && (
                <div className="canvas-node-editor-dock-local-edit" role="group" aria-label="局部编辑操作">
                  <button type="button" className="canvas-node-editor-dock-chip canvas-node-editor-dock-chip-edit" onClick={() => onLocalEdit()} aria-label="局部编辑" data-tooltip="局部编辑">
                    <span aria-hidden="true">✎</span> 局部编辑
                  </button>
                  {onLocalEditRemove && (
                    <button
                      type="button"
                      className="canvas-node-editor-dock-chip canvas-node-editor-dock-chip-remove"
                      aria-label="删除局部编辑"
                      title="删除当前局部编辑范围"
                      onClick={(event) => {
                        event.stopPropagation();
                        onLocalEditRemove();
                      }}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  )}
                </div>
              )}
              {canUseCurrentImageAsReference && (
                <label className="canvas-current-image-reference-toggle">
                  <input
                    type="checkbox"
                    checked={useCurrentImageAsReference}
                    onChange={(event) => {
                      const next = event.currentTarget.checked;
                      setUseCurrentImageAsReference(next);
                      onCurrentImageReferenceChange?.(next);
                    }}
                    aria-label="当前图片作参考"
                  />
                  <span className="canvas-current-image-reference-switch" aria-hidden="true">
                    <i />
                  </span>
                  <span className="canvas-current-image-reference-copy">
                    <b>当前图片作参考</b>
                    <small>
                      {useCurrentImageAsReference
                        ? "默认使用当前图片"
                        : maskState
                          ? "已关闭，本次不应用局部编辑蒙版"
                          : "已关闭，本次不提交当前图片"}
                    </small>
                  </span>
                </label>
              )}
              {node.type === "generator" && (
                <div className="canvas-node-editor-dock-variant-wrap">
                  <button type="button" className="canvas-node-editor-dock-chip" onClick={() => setImageDockPanel((value) => value === "variant" ? null : "variant")} aria-label="变体要求" aria-expanded={imageDockPanel === "variant"} aria-controls="canvas-node-dock-variant" data-tooltip="变体要求">
                    <span aria-hidden="true">⧉</span> 变体
                  </button>
                  {imageDockPanel === "variant" && (
                    <div id="canvas-node-dock-variant" className="canvas-node-editor-dock-popover canvas-node-editor-dock-drawer is-variant" role="dialog" aria-label="变体要求" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
                      <div className="canvas-node-editor-dock-drawer-grip" aria-hidden="true" />
                      <div className="canvas-node-editor-dock-popover-head">
                        <div className="canvas-node-editor-dock-variant-title">
                          <b>变体要求</b>
                          <small>逐条编辑、回车新增</small>
                        </div>
                        <div className="canvas-node-editor-dock-variant-actions">
                          <span className="canvas-node-editor-dock-variant-count">{variantRequirements.length} 条</span>
                          <CanvasGeneratorHelp kind={data.kind === "video" ? "video" : "image"} />
                          {(data.variantRequirementsText ?? variantRequirements.join("\n")).trim() && <button type="button" className="canvas-prompt-clear-action" title="清空变体要求" aria-label="清空变体要求" onClick={() => onVariantRequirementsChange(node, "")}>⌫ <span>清空</span></button>}
                          <button type="button" aria-label="关闭变体" onClick={() => setImageDockPanel(null)}>×</button>
                        </div>
                      </div>
                      <div className="canvas-node-variant-editor">
                        <CanvasVariantRequirementsEditor
                          value={data.variantRequirementsText ?? variantRequirements.join("\n")}
                          references={mentionCandidates.map((candidate, index) => canvasMentionOption(document, candidate, index))}
                          ariaLabel={`${nodeLabel(node)}变体要求`}
                          menuClassName="canvas-node-mention-menu canvas-variant-mention-menu"
                          menuPortal
                          onPasteFiles={(files) => onAddReferenceFiles(node.id, files)}
                          onChange={(value) => onVariantRequirementsChange(node, value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
              {smartVariantAction}
              <span className="canvas-node-editor-dock-hint">{dockHint}</span>
            </div>
            {!isUpscaleNode && (
            <div className="canvas-node-editor-prompt-wrap">
              <div className="canvas-node-editor-prompt-label">
                <span>{isAgentNode ? "Agent 任务" : "提示词"}</span>
                <small>{promptLabelSmall}</small>
                {promptOptimizationActions}
              </div>
              <ReferenceMentionEditor
                ref={promptRef}
                value={visibleEditorPrompt}
                references={mentionCandidates.map((candidate, index) => canvasMentionOption(document, candidate, index))}
                ariaLabel={`${nodeLabel(node)}提示词`}
                className="canvas-node-prompt-editor"
                menuClassName="canvas-node-mention-menu"
                menuPortal
                allowRichPaste={false}
                onPaste={handleNodePromptPaste}
                onChange={handleEditorPromptChange}
                onMentionSelect={(_candidateIndex, value) => handleEditorPromptChange(value)}
                placeholder={promptPlaceholder}
                onKeyDown={(event) => {
                  if (!promptExpanded && event.key === "Enter" && (isAgentNode ? !event.shiftKey : (event.ctrlKey || event.metaKey))) {
                    event.preventDefault();
                    onGenerate(node, generationOptions);
                  }
                }}
                transformPastedText={(text) => replaceNaturalReferenceLabels(
                  text,
                  mentionCandidates.map((candidate, index) => canvasMentionOption(document, candidate, index)),
                ).value}
              />
              {activeImagePreset && <CanvasImagePresetBadge preset={activeImagePreset} onClear={clearImagePreset} />}
            </div>
            )}
            {branchDraft ? (
              <CanvasReferenceDraftStrip
                references={branchReferences}
                onFiles={onDraftReferenceFiles || (() => undefined)}
                onRemove={onDraftReferenceRemove || (() => undefined)}
                onReorder={onDraftReferenceReorder || (() => undefined)}
                onNodeDrop={onDraftReferenceNodeDrop}
                onPaste={onDraftReferencePaste}
                onPickFromCanvas={onPickFromCanvas ? () => onPickFromCanvas() : undefined}
                onPreview={onDraftReferencePreview}
                emptyLabel="添加画布参考"
              />
            ) : isUpscaleNode ? (
              <div className="canvas-upscale-input-note">
                <span>输入：{upscaleSourceUrl ? "已连接一张图片" : "未连接图片"}</span>
                {onPickFromCanvas && <button type="button" onClick={() => onPickFromCanvas()}>⌁ 画布点选</button>}
              </div>
            ) : (
              <CanvasNodeReferenceStrip
                target={node}
                document={document}
                runtime={runtime}
                references={editorReferences}
                contexts={editorContexts}
                onReorder={onReferenceReorder}
                onRemove={onReferenceRemove}
                onDrop={onReferenceDrop}
                onAddFiles={onAddReferenceFiles}
                onPickFromCanvas={onPickFromCanvas}
                onPreview={onOutputPreview}
                onTextPreview={onTextPreview}
                onRestoreAutomatic={onRestoreAutomatic}
                resolveInputRoles={resolveInputRoles}
                resolveVideoCapabilities={resolveVideoCapabilities}
              />
            )}
            <div className="canvas-node-editor-dock-toolbar">
              <div className="canvas-node-editor-dock-tool model">
                {editorParams && dockModelCapability && (
                  <ModelPicker
                    models={runtime?.models || []}
                    value={dockModelValue ?? ""}
                    capability={dockModelCapability}
                    portalZIndex={CANVAS_Z_INDEX.modalPopover}
                    dialogPortalZIndex={CANVAS_Z_INDEX.modelDialog}
                    defaultProviderId={runtime?.settings.defaultProviderId}
                    defaultProviderName={runtime?.providers.find((item) => item.id === runtime?.settings.defaultProviderId)?.name}
                    defaultModelId={dockModelDefaultId}
                    onChange={(value) => onEditorParamsChange(node, { ...editorParams, model: value })}
                    className="canvas-node-editor-dock-model-picker"
                  />
                )}
              </div>
              <div ref={imageDockParamsRef} className="canvas-node-editor-dock-params-wrap">
                <button type="button" className="canvas-node-editor-dock-tool params" onClick={() => setImageDockPanel((value) => value === "params" ? null : "params")} aria-expanded={imageDockPanel === "params"} aria-controls="canvas-image-dock-params">
                  <b>生成参数</b>
                  <small>{parameterSummary || "参数"}</small>
                </button>
                {imageDockPanel === "params" && (
                  <div id="canvas-image-dock-params" className="canvas-node-editor-dock-popover canvas-node-editor-dock-drawer is-params" role="dialog" aria-label="生成参数" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
                    <div className="canvas-node-editor-dock-drawer-grip" aria-hidden="true" />
                    <div className="canvas-node-editor-dock-popover-head">
                      <b>生成参数</b>
                      <button type="button" aria-label="关闭参数" onClick={() => setImageDockPanel(null)}>×</button>
                    </div>
                    <div className="canvas-node-editor-dock-drawer-body">
                    {isUpscaleNode && upscaleParams && onUpscaleParamsChange ? (
                      <CanvasUpscaleSettingsPanel params={upscaleParams} runtime={runtime} sourceUrl={upscaleSourceUrl} portalZIndex={CANVAS_Z_INDEX.modalPopover} onChange={onUpscaleParamsChange} />
                    ) : editorParams ? (
                      <CreationParameterEditor
                        key={node.id}
                        settings={editorParams}
                        runtime={runtime}
                        referenceCount={branchDraft ? branchReferences.length : editorReferences.length}
                        variant={isDockNode ? "dock" : undefined}
                        portalZIndex={CANVAS_Z_INDEX.modalPopover}
                        dialogPortalZIndex={CANVAS_Z_INDEX.modelDialog}
                        onChange={(settings) => onEditorParamsChange(node, settings)}
                        onVideoInputModeChange={() => onVideoInputModeChange(node)}
                      />
                    ) : null}
                    </div>
                    <div className="canvas-node-editor-dock-drawer-summary"><span>{parameterSummary || "参数"}</span></div>
                  </div>
                )}
              </div>
              <button type="button" className="canvas-node-editor-generate" data-tooltip={promptExpanded ? "保存编辑内容" : upscaleMissingInput ? "请连接一张已完成的图片" : inPlaceVideo ? "生成新的结果卡片" : undefined} disabled={!promptExpanded && (pending || upscaleMissingInput)} onClick={handleEditorAction}>{editorActionLabel}</button>
            </div>
            <input ref={imageDockFileRef} hidden type="file" multiple accept={referenceFileAccept} onChange={(event) => { if (event.target.files) onAddReferenceFiles(node.id, [...event.target.files]); event.currentTarget.value = ""; }} />
           </div>
          ) : <div className="canvas-node-editor-columns">
          <div className="canvas-node-editor-copy">
            <div className="canvas-node-editor-prompt-wrap">
              <div className="canvas-node-editor-prompt-label">
                <span>{node.type === "prompt" ? "Agent 任务" : "提示词"}</span>
                <small>@ 引用节点 · {promptExpanded ? "编辑完成后点击保存" : node.type === "prompt" ? "Enter 发送" : "Ctrl/Cmd + Enter 生成"}</small>
                {promptOptimizationActions}
              </div>
              <ReferenceMentionEditor
                ref={promptRef}
                value={editorPrompt}
                references={mentionCandidates.map((candidate, index) => canvasMentionOption(document, candidate, index))}
                ariaLabel={`${nodeLabel(node)}提示词`}
                className="canvas-node-prompt-editor"
                menuClassName="canvas-node-mention-menu"
                menuPortal
                allowRichPaste={false}
                onPaste={handleNodePromptPaste}
                onChange={handleEditorPromptChange}
                onMentionSelect={(_candidateIndex, value) => handleEditorPromptChange(value)}
                 placeholder={node.type === "prompt" ? "输入 Agent 任务… 输入 @ 引用节点" : data.kind === "video" ? "描述动作、镜头和声音… 输入 @ 引用节点" : "描述想生成的画面… 输入 @ 引用节点"}
                 onKeyDown={(event) => {
                   if (!promptExpanded && event.key === "Enter" && (node.type === "prompt" ? !event.shiftKey : (event.ctrlKey || event.metaKey))) {
                     event.preventDefault();
                     onGenerate(node, generationOptions);
                  }
                }}
                transformPastedText={(text) => replaceNaturalReferenceLabels(
                  text,
                  mentionCandidates.map((candidate, index) => canvasMentionOption(document, candidate, index)),
                ).value}
              />
            </div>
            {node.type === "media" && node.data.kind === "image" && node.data.url && onLocalEdit && maskState && (
              <CanvasMaskSummary
                mask={maskState}
                onEdit={onLocalEdit}
                onRemove={onLocalEditRemove}
              />
            )}
            {branchDraft ? (
              <CanvasReferenceDraftStrip
                references={branchReferences}
                onFiles={onDraftReferenceFiles || (() => undefined)}
                onRemove={onDraftReferenceRemove || (() => undefined)}
                onReorder={onDraftReferenceReorder || (() => undefined)}
                onNodeDrop={onDraftReferenceNodeDrop}
                onPaste={onDraftReferencePaste}
                onPickFromCanvas={onPickFromCanvas ? () => onPickFromCanvas() : undefined}
                onPreview={onDraftReferencePreview}
                emptyLabel="添加画布参考"
              />
            ) : node.type === "upscale" ? (
              <div className="canvas-upscale-input-note">
                <span>输入：{upscaleSourceUrl ? "已连接一张图片" : "未连接图片"}</span>
                {onPickFromCanvas && <button type="button" onClick={() => onPickFromCanvas()}>⌁ 画布点选</button>}
              </div>
            ) : (
              <CanvasNodeReferenceStrip
                target={node}
                document={document}
                runtime={runtime}
                references={editorReferences}
                contexts={editorContexts}
                onReorder={onReferenceReorder}
                onRemove={onReferenceRemove}
                onDrop={onReferenceDrop}
                onAddFiles={onAddReferenceFiles}
                onPickFromCanvas={onPickFromCanvas}
                onPreview={onOutputPreview}
                onTextPreview={onTextPreview}
                onRestoreAutomatic={onRestoreAutomatic}
                resolveInputRoles={resolveInputRoles}
                resolveVideoCapabilities={resolveVideoCapabilities}
              />
            )}
          </div>
          <div className="canvas-node-editor-settings">
            {node.type === "generator" && (
              <div className="canvas-node-variant-editor">
                <div className="canvas-node-variant-editor-head">
                  <label>变体要求 <small>逐条编辑、回车新增 · {variantRequirements.length} 条</small></label>
                  <CanvasGeneratorHelp kind={data.kind === "video" ? "video" : "image"} />
                  {(data.variantRequirementsText ?? variantRequirements.join("\n")).trim() && <button type="button" className="canvas-prompt-clear-action" title="清空变体要求" aria-label="清空变体要求" onClick={() => onVariantRequirementsChange(node, "")}>⌫ <span>清空</span></button>}
                </div>
                <CanvasVariantRequirementsEditor
                  value={data.variantRequirementsText ?? variantRequirements.join("\n")}
                  references={mentionCandidates.map((candidate, index) => canvasMentionOption(document, candidate, index))}
                  ariaLabel={`${nodeLabel(node)}变体要求`}
                  menuClassName="canvas-node-mention-menu canvas-variant-mention-menu"
                  menuPortal
                  onPasteFiles={(files) => onAddReferenceFiles(node.id, files)}
                  onChange={(value) => onVariantRequirementsChange(node, value)}
              />
            </div>
            )}
            {node.type === "upscale" && upscaleParams && onUpscaleParamsChange ? (
              <CanvasUpscaleSettingsPanel params={upscaleParams} runtime={runtime} sourceUrl={upscaleSourceUrl} portalZIndex={CANVAS_Z_INDEX.modalPopover} onChange={onUpscaleParamsChange} />
            ) : editorParams && (
              <CreationParameterEditor
                key={node.id}
                settings={editorParams}
                runtime={runtime}
                referenceCount={branchDraft ? branchReferences.length : editorReferences.length}
                variant="canvas-flat"
                portalZIndex={CANVAS_Z_INDEX.modalPopover}
                dialogPortalZIndex={CANVAS_Z_INDEX.modelDialog}
                onChange={(settings) => onEditorParamsChange(node, settings)}
                onVideoInputModeChange={() => onVideoInputModeChange(node)}
              />
            )}
          </div>
         </div>}
       </div>
        {!audioNode && (promptExpanded || !isDockNode) && <div className="canvas-node-editor-actions">
          <span>{promptExpanded ? "编辑完成后点击保存" : node.type === "upscale" ? "连接图片后提交超分" : node.type === "prompt" ? "Enter 发送 · Shift + Enter 换行" : inPlaceVideo ? "引用图片 · 生成新视频" : node.type === "media" && data.kind === "image" && data.url ? "当前图片作参考 · 右侧生成新图" : "Ctrl/Cmd + Enter 生成"}</span>
          <div className="canvas-node-editor-action-buttons">
            {isAgentNode && !promptExpanded && readyOneTakeReferences.length >= 2 && (
              <div className="one-take-duration-control canvas-agent-one-take-control">
                <button
                  type="button"
                  className="canvas-node-editor-one-take"
                  disabled={pending}
                  onClick={() => setOneTakeDurationOpen(true)}
                >
                  🎬 一镜到底
                </button>
                <OneTakeDurationPicker
                  open={oneTakeDurationOpen}
                  busy={pending}
                  onConfirm={(duration) => {
                    setOneTakeDurationOpen(false);
                    onOneTake(node, duration);
                  }}
                  onCancel={() => setOneTakeDurationOpen(false)}
                />
              </div>
            )}
            <button type="button" className="canvas-node-editor-generate" title={promptExpanded ? "保存编辑内容" : upscaleMissingInput ? "请连接一张已完成的图片" : inPlaceVideo ? "生成新的结果卡片" : undefined} disabled={!promptExpanded && (pending || upscaleMissingInput)} onClick={handleEditorAction}>{editorActionLabel}</button>
          </div>
        </div>}
      </div>
    </div>
    </>
  );
}


export default CanvasNodeEditorPopover;
