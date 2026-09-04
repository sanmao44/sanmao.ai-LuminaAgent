import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);
const parameterEditor = await readFile(
  new URL("../components/CreationParameterEditor.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../app/canvas.css", import.meta.url),
  "utf8",
);

test("node editor exposes an accessible expand/collapse control", () => {
  assert.match(component, /className="canvas-node-editor-expand"/);
  assert.match(component, /title=\{promptExpanded \? "收回编辑" : "放大编辑"\}/);
  assert.match(component, /aria-label=\{promptExpanded \? "收回编辑" : "放大编辑"\}/);
  assert.match(component, /aria-expanded=\{promptExpanded\}/);
  assert.match(component, /data-prompt-expanded=\{promptExpanded \? "true" : "false"\}/);
});

test("image-connected video cards generate back into the current node", () => {
  assert.match(component, /shouldGenerateVideoInPlace/);
  assert.match(component, /selectedMediaTarget\?\.data\.url && !inPlaceVideoTarget/);
  assert.match(component, /currentVideoIsSource/);
  assert.match(component, /canvasVideoTargetHasImageReference\(docRef\.current, target\)/);
  assert.match(component, /引用图片 · 结果写回当前视频节点/);
  assert.match(component, /生成到当前节点/);
});

test("overlay positioning ignores identical geometry updates", () => {
  const toolbarStart = component.indexOf("function CanvasNodeQuickToolbar");
  const editorStart = component.indexOf("function CanvasNodeEditorPopover");
  assert.ok(toolbarStart >= 0 && editorStart > toolbarStart, "canvas overlays should be present");
  const toolbar = component.slice(toolbarStart, editorStart);
  assert.match(toolbar, /setPosition\(\(current\) =>[\s\S]*current\.left === nextPosition\.left[\s\S]*current\.top === nextPosition\.top[\s\S]*\? current/);

  const editor = component.slice(editorStart);
  assert.match(editor, /setPosition\(\(current\) =>[\s\S]*current\.left === position\.left[\s\S]*current\.top === position\.top[\s\S]*current\.maxHeight === position\.maxHeight[\s\S]*\? current/);
});

test("editor generation forwards its draft without waiting for selection state", () => {
  const editorStart = component.indexOf("const runEditorGeneration = useCallback");
  const editorEnd = component.indexOf("const updateUpscaleParams", editorStart);
  assert.ok(editorStart >= 0 && editorEnd > editorStart, "editor generation should be present");
  const editor = component.slice(editorStart, editorEnd);
  assert.match(editor, /const currentNode = nodeById\(docRef\.current, node\.id\)/);
  assert.match(editor, /const generationRequest: CanvasGenerationRequest/);
  assert.match(editor, /nodeId: currentNode\.id/);
  assert.match(editor, /prompt: draft\?\.prompt \?\? editorPromptFor\(currentNode\)/);
  assert.match(editor, /runGenerationRef\.current\?\.\(generationRequest\)/);
  assert.doesNotMatch(editor, /setTimeout/);

  const generationStart = component.indexOf("const runGeneration = useCallback");
  const generationEnd = component.indexOf("runGenerationRef.current = runGeneration", generationStart);
  assert.ok(generationStart >= 0 && generationEnd > generationStart, "generation implementation should be present");
  const generation = component.slice(generationStart, generationEnd);
  assert.match(generation, /async \(request\?: CanvasGenerationRequest\)/);
  assert.match(generation, /nodeById\(docRef\.current, request\.nodeId\)/);
  assert.match(generation, /const source = deckSource\(request\)/);
  assert.match(generation, /const generationMode = source\.kind/);
  assert.match(generation, /request\.prompt !== undefined/);
  assert.match(generation, /if \(!request && reuseDraft\)/);
  assert.doesNotMatch(generation, /if \(mode === "text"\)/);
});

test("open editor drafts follow externally synchronized video input modes", () => {
  assert.match(component, /function syncCanvasEditorDraftInputModes\(/);
  assert.match(component, /params: \{ \.\.\.draft\.params, inputMode: params\.inputMode \}/);
  assert.match(component, /setEditorDrafts\(\(current\) => syncCanvasEditorDraftInputModes\(current, normalized, runtime\)\)/);
});

test("upscale runs in place and keeps a visible processing state on the node", () => {
  const start = component.indexOf("const runUpscaleNode = useCallback");
  const end = component.indexOf("runUpscaleNodeRef.current = runUpscaleNode", start);
  assert.ok(start >= 0 && end > start, "upscale implementation should be present");
  const upscaleRun = component.slice(start, end);
  assert.doesNotMatch(upscaleRun, /createMedia\(/);
  assert.doesNotMatch(upscaleRun, /addEdge\(/);
  assert.match(upscaleRun, /resultSource: "upscale-node"/);
  assert.match(upscaleRun, /url: resultUrl/);
  assert.match(upscaleRun, /statusLabel: "超分节点生成的结果"/);
  assert.match(component, /setExpandedEditorId\(\(current\) => current === node\.id \? null : current\)/);
  assert.match(component, /className="canvas-upscale-card-loading"/);
  assert.match(component, /className="canvas-upscale-result-badge"/);
  assert.match(styles, /\.canvas-upscale-card-result/);
  assert.match(styles, /\.canvas-upscale-card-loading \.canvas-processing-indicator/);
});

test("upscale settings use provider-specific controls with the main bilingual custom select menu", () => {
  const start = component.indexOf("function CanvasUpscaleSettingsPanel");
  const end = component.indexOf("type CanvasNodeEditorPopoverProps", start);
  assert.ok(start >= 0 && end > start, "upscale settings panel should be present");
  const panel = component.slice(start, end);
  assert.equal((panel.match(/<SelectMenu/g) || []).length, 4);
  assert.doesNotMatch(panel, /<select\b/);
  [
    "模型",
    "放大倍率",
    "颜色校正",
    "缩放算法",
    "可选说明",
    "输出格式",
    "JPG 质量",
  ].forEach((label) => assert.match(panel, new RegExp(label)));
  [
    "自动选择",
    "wavelet · 接近原图",
    "关闭",
    "lanczos · 锐利",
    "bicubic · 平滑",
    "nearest · 像素",
  ].forEach((label) => assert.match(panel, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));
  assert.doesNotMatch(panel, /Upscale model|Color correction|Scaling algorithm|High-quality smoothing|Balanced quality and speed/);
  assert.match(panel, /supportedScales/);
  assert.match(panel, /selectedCloudModel\?\.provider === "tencent-ci"/);
  assert.match(panel, /!isCloudModel/);
  assert.match(panel, /className="canvas-upscale-select"/);
  assert.match(panel, /menuClassName="canvas-upscale-select-popover"/);
  assert.match(styles, /\.canvas-upscale-select-popover\{z-index:var\(--canvas-z-modal-popover\)/);
  assert.match(styles, /\.canvas-upscale-field-label/);
});

test("image cards show intrinsic resolution only after a valid image has loaded", () => {
  assert.match(component, /const imageResolution =/);
  assert.match(component, /node\.type === "media"/);
  assert.match(component, /data\.kind === "image"/);
  assert.match(component, /node\.type === "upscale"/);
  assert.match(component, /Boolean\(data\.url\)/);
  assert.match(component, /!pending/);
  assert.match(component, /data\.status !== "failed"/);
  assert.match(component, /Number\(data\.nativeWidth\) > 0/);
  assert.match(component, /Number\(data\.nativeHeight\) > 0/);
  assert.match(component, /className="canvas-image-resolution"/);
  assert.match(component, /title=\{`图片分辨率 \$\{imageResolution\}`\}/);
  assert.match(component, /className="canvas-image-resolution canvas-upscale-resolution"/);
  assert.match(component, /canvas-upscale-resolution[\s\S]*title=\{`图片分辨率 \$\{imageResolution\}`\}/);
  assert.match(styles, /\.canvas-image-resolution\{[^}]*right:10px[^}]*bottom:10px/);
  assert.match(styles, /font-variant-numeric:tabular-nums/);
  assert.match(styles, /@media\(max-width:720px\)\{\.canvas-image-resolution/);
});

test("upscale result frames use the loaded image dimensions for auto-fit", () => {
  assert.match(component, /upscaleCardSizeForRatio/);
  assert.match(component, /node\.type !== "media" && node\.type !== "upscale"/);
  assert.match(component, /className="canvas-upscale-card-result"[\s\S]*?onLoad=\{\(event\) =>\s*onNaturalSize\(/);
  assert.match(component, /item\.data\.autoFit !== false \? upscaleCardSizeForRatio\(/);
  assert.match(component, /autoFit: item\.data\.autoFit !== false/);
});

test("prompt editor measures content and caps scrolling in both display modes", () => {
  assert.match(component, /const promptRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(component, /editor\.style\.height = "auto"/);
  assert.match(component, /const contentHeight = (?:textarea|editor)\.scrollHeight/);
  assert.match(component, /const baseMinHeight = promptExpanded[\s\S]*stackedEditor[\s\S]*mobile \? 50 : 54/);
  assert.match(component, /const baseMaxHeight = promptExpanded[\s\S]*stackedEditor[\s\S]*mobile \? 88 : 96/);
  assert.match(component, /textarea\.style\.overflowY = contentHeight > maxHeight \? "auto" : "hidden"/);
});

test("expanded editor is centered and remains responsive", () => {
  assert.match(styles, /\.canvas-node-editor-popover\.is-prompt-expanded\{[^}]*position:fixed/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-prompt-expanded\{[^}]*width:min\(860px,calc\(100vw - 32px\)\)/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-prompt-expanded\{[^}]*max-height:calc\(100vh - 32px\)/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-prompt-expanded \.canvas-node-editor-columns\{[^}]*grid-template-columns/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-prompt-expanded \.canvas-node-editor-settings,\.canvas-node-editor-popover\.is-prompt-expanded \.canvas-editor-references,\.canvas-node-editor-popover\.is-prompt-expanded \.canvas-reference-draft-strip\{display:none!important\}/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-prompt-expanded \.canvas-node-editor-prompt-wrap\{display:flex;flex:1;flex-direction:column/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-prompt-expanded \.canvas-node-editor-prompt-wrap>textarea\{flex:1 1 auto/);
  assert.match(styles, /@media\(max-width:720px\)\{[\s\S]*\.canvas-node-editor-popover\.is-prompt-expanded\{width:calc\(100vw - 16px\)/);
});

test("expanded prompt editing saves without triggering generation", () => {
  const editorStart = component.indexOf("function CanvasNodeEditorPopover");
  assert.ok(editorStart >= 0, "node editor popover should be present");
  const editor = component.slice(editorStart);
  assert.match(editor, /const editorActionLabel = promptExpanded \? "保存" : generateLabel/);
  assert.match(editor, /const promptLabelSmall = promptExpanded[\s\S]*编辑完成后点击保存/);
  assert.match(editor, /const handleEditorAction = \(\) => \{[\s\S]*?if \(promptExpanded\) \{[\s\S]*?setPromptExpanded\(false\)[\s\S]*?return;[\s\S]*?\}\s*onGenerate\(node\);/);
  assert.match(editor, /!promptExpanded && event\.key === "Enter"/);
  assert.match(editor, /!audioNode && \(promptExpanded \|\| !isDockNode\)/);
  assert.match(editor, /disabled=\{!promptExpanded && \(pending \|\| upscaleMissingInput\)\} onClick=\{handleEditorAction\}>\{editorActionLabel\}/);
});

test("editor keeps references, variant requirements, parameters, mentions and generation", () => {
  assert.match(component, /<CanvasNodeReferenceStrip/);
  assert.match(component, /<CanvasReferenceDraftStrip/);
  assert.match(component, /<CreationParameterEditor/);
  assert.match(component, /className="canvas-node-variant-editor"/);
  assert.match(component, /className="canvas-node-mention-menu"/);
  assert.match(component, /onGenerate\(node\)/);
  assert.match(component, /setMentionState\(null\)/);
  assert.match(component, /setPromptExpanded\(false\)/);
});

test("video variant generators reuse the compact image-variant dock", () => {
  const editorStart = component.indexOf("function CanvasNodeEditorPopover");
  const editor = component.slice(editorStart);
  assert.match(editor, /const isVariantGenerator = node\.type === "generator" && data\.kind === "video"/);
  assert.match(editor, /const isDockNode = isImageNode \|\| isVariantGenerator/);
  assert.match(editor, /className="canvas-node-editor-dock-variant-wrap"/);
  assert.match(editor, /aria-controls="canvas-node-dock-variant"/);
  assert.match(editor, /id="canvas-node-dock-variant"/);
  assert.match(editor, /canvas-node-editor-dock-variant-title/);
  assert.match(editor, /canvas-node-editor-dock-variant-actions/);
  const dockVariantStart = editor.indexOf('id="canvas-node-dock-variant"');
  const dockVariantInput = editor.indexOf("<ReferenceMentionEditor", dockVariantStart);
  assert.ok(dockVariantStart >= 0 && dockVariantInput > dockVariantStart, "compact variant drawer should contain an input");
  assert.doesNotMatch(editor.slice(dockVariantStart, dockVariantInput), /canvas-node-variant-editor-head/);
  assert.doesNotMatch(editor, /imageDockPanel === "variant" && createPortal/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-image-dock \.canvas-node-editor-dock-variant-wrap\{/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-image-dock \.canvas-node-editor-dock-variant-wrap>\.canvas-node-editor-dock-popover\.canvas-node-editor-dock-drawer\.is-variant\{[\s\S]*position:absolute[\s\S]*left:0[\s\S]*bottom:calc\(100% \+ 8px\)/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-image-dock \.canvas-node-editor-dock-variant-wrap>\.canvas-node-editor-dock-popover\.canvas-node-editor-dock-drawer\.is-variant\{[\s\S]*width:min\(540px,calc\(100vw - 32px\)\)/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-image-dock \.canvas-node-editor-dock-variant-wrap\{[\s\S]*position:relative/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-image-dock \.canvas-node-editor-dock-variant-actions\{[\s\S]*position:relative/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-image-dock \.canvas-node-editor-dock-variant-actions>\.canvas-generator-help-popover\{[\s\S]*position:absolute[\s\S]*bottom:calc\(100% \+ 10px\)/);
});

test("image parameter dock closes when the pointer lands outside it", () => {
  assert.match(component, /const imageDockParamsRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(component, /if \(imageDockPanel !== "params"\) return;[\s\S]*?window\.document\.addEventListener\("pointerdown", closeOnOutsidePointer\)/);
  assert.match(component, /imageDockPanel === "params" && !imageDockParamsRef\.current\?\.contains\(target\)/);
  assert.match(component, /<div ref=\{imageDockParamsRef\} className="canvas-node-editor-dock-params-wrap">/);
});

test("reference thumbnails keep the strip compact and scroll horizontally only", () => {
  const start = component.indexOf("const renderItem =");
  const end = component.indexOf("const renderSlot =", start);
  assert.ok(start >= 0 && end > start, "reference item renderer should be present");
  const renderItem = component.slice(start, end);
  assert.match(renderItem, /role && \(/);
  assert.match(styles, /\.canvas-editor-reference-items\{[^}]*overflow-x:auto;overflow-y:hidden/);
  assert.match(styles, /\.canvas-node-editor-popover:not\(\.is-prompt-expanded\) \.canvas-editor-reference-items[^}]*overflow-x:auto;overflow-y:hidden/);
});

test("Agent generation keeps the node model when image references are present", () => {
  const start = component.indexOf("const effectiveSettings: AgentCreationSettings = {");
  const end = component.indexOf("let inputNode = source.node", start);
  assert.ok(start >= 0 && end > start, "Agent request settings should be present");
  const settingsBlock = component.slice(start, end);
  assert.doesNotMatch(settingsBlock, /referenceNodes\.length/);
  assert.match(settingsBlock, /settings\.model === "auto"/);
  assert.match(settingsBlock, /resolved\.model\?\.id/);
  assert.match(component, /model: effectiveSettings\.model/);
});

test("Agent nodes share deliverable routing, throttle streaming paint, and reject unexpected images", () => {
  assert.match(component, /classifyAgentDeliverable\(prompt/);
  assert.match(component, /deliverable: intentDecision\.deliverable/);
  assert.match(component, /intentReason: intentDecision\.reason/);
  assert.match(component, /window\.requestAnimationFrame\(flushStreamedText\)/);
  assert.match(component, /const localAllowsImages = intentDecision\.deliverable === "IMAGE" \|\| intentDecision\.deliverable === "BOTH"/);
  assert.match(component, /const serverAllowsImages = responseDeliverable === "IMAGE" \|\| responseDeliverable === "BOTH"/);
  assert.match(component, /非预期图片，已按文字交付规则忽略/);
});

test("image continuation uses the ordinary image API and keeps lineage on image nodes", () => {
  const start = component.indexOf("const runImageContinuation = useCallback");
  const end = component.indexOf("const runReuseGeneration = useCallback", start);
  assert.ok(start >= 0 && end > start, "image continuation implementation should be present");
  const continuation = component.slice(start, end);

  assert.match(continuation, /generateCanvasImage\(/);
  assert.match(continuation, /addReference\(\s*source\.id/);
  assert.match(continuation, /referenceIds: \[\.\.\.resolvedReferenceIds\]/);
  assert.match(continuation, /parentNodeId: source\.id/);
  assert.match(continuation, /reuseSourceNodeId: source\.id/);
  assert.match(continuation, /kind: "lineage"/);
  assert.match(continuation, /createMedia\(\s*"image"/);
  assert.match(continuation, /result\.images\.forEach/);
  assert.match(continuation, /status: "failed"/);
  assert.match(continuation, /referenceEdges\.map/);
  assert.doesNotMatch(continuation, /sourceGeneratorId/);
  assert.doesNotMatch(continuation, /variantBatchId|variantIndex/);
  assert.doesNotMatch(continuation, /createGenerator\(/);
});

test("selected related canvas edges become dashed and animate their flow", () => {
  assert.match(component, /related \? "related"/);
  assert.match(styles, /\.canvas-edge-visual \.canvas-edge\.related\{[^}]*stroke-dasharray:11 9[^}]*animation:canvas-edge-related-dashes 1\.8s linear infinite/);
  assert.match(styles, /@keyframes canvas-edge-related-dashes\{from\{stroke-dashoffset:0\}to\{stroke-dashoffset:-40\}\}/);
  assert.match(styles, /canvas-edge-related-flow,html:not\(\[data-motion="on"\]\) \.canvas-edge\.related\{animation:none!important\}/);
});

test("canvas edges reveal one small red removal control at the pointer without a modifier", () => {
  assert.match(component, /CANVAS_CONNECTION_CANCEL_SHOW_DELAY_MS = 140/);
  assert.match(component, /const handleConnectionHover = useCallback/);
  assert.match(component, /clearConnectionCancelShowTimer/);
  assert.match(component, /connectionCancelShowTimerRef\.current = window\.setTimeout/);
  assert.match(component, /}, CANVAS_CONNECTION_CANCEL_SHOW_DELAY_MS\);/);
  assert.match(component, /showConnectionCancel\(\s*edgeId,\s*stagePoint\(event\.clientX, event\.clientY\),\s*\)/);
  assert.match(component, /onPointerMove=\{handlePointerMove\}/);
  assert.match(component, /onHover=\{\(event\) => handleConnectionHover\(edge\.id, event\)\}/);
  assert.match(component, /const \[connectionCancelPointer, setConnectionCancelPointer\]/);
  assert.match(component, /connectionCancelPointer \|\| worldToScreen\(/);
  assert.match(component, /onPointerDown=\{\(event\) =>\s*connectionCancelEdge/);
  assert.doesNotMatch(component, /悬停连线显示取消按钮/);
  assert.match(styles, /\.canvas-connection-cancel\{[^}]*width:14px[^}]*height:14px/);
  assert.match(styles, /\.canvas-connection-remove\{width:12px[^}]*height:12px/);
  assert.match(styles, /\.canvas-connection-cancel\{[^}]*border:1px solid color-mix\(in srgb,var\(--danger\) 28%/);
  assert.match(styles, /\.canvas-connection-cancel\{[^}]*background:color-mix\(in srgb,var\(--danger-soft\) 78%,var\(--panel-2\)\)/);
  assert.match(styles, /\.canvas-connection-cancel\{[^}]*color:var\(--danger\)/);
  assert.match(styles, /@keyframes canvas-connection-remove-attention\{/);
  assert.match(styles, /\.canvas-connection-cancel\{[^}]*animation:canvas-connection-remove-attention \.42s ease-out both/);
  assert.match(styles, /\.canvas-connection-cancel:hover,.canvas-connection-cancel:focus-visible\{[^}]*background:color-mix\(in srgb,var\(--danger-soft\)/);
});

test("nested node scrolling does not trigger canvas zoom", () => {
  assert.match(component, /function isCanvasWheelIsolatedTarget\(target: EventTarget \| null\)/);
  assert.match(component, /target\.closest\(selector\)/);
  assert.match(component, /onWheel=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(component, /if \(isCanvasWheelIsolatedTargetWithOptions\(event\.target, true\)\)/);
  assert.doesNotMatch(component, /onWheel=\{\(event\) => event\.stopPropagation\(\)\}\s*onDoubleClick/);
  assert.match(component, /Do not preventDefault/);
  assert.match(styles, /\.canvas-node,\.canvas-node-editor-popover,\.canvas-node-quick-toolbar/);
  assert.match(styles, /\.canvas-prompt-preview,\.canvas-node-editor-body/);
  assert.match(styles, /overscroll-behavior:contain/);
});

test("grouped cards defer external connections to the group ports", () => {
  assert.match(component, /!group && \(\s*<button\s+type="button"\s+className="canvas-port left"/);
  assert.match(component, /!group && \(\s*<button\s+type="button"\s+className="canvas-port right"/);
});

test("audio nodes use the branded rounded player instead of browser gray controls", () => {
  const playerStart = component.indexOf("function CanvasAudioPlayer");
  const playerEnd = component.indexOf("function CanvasAudioNodePanel", playerStart);
  assert.ok(playerStart >= 0 && playerEnd > playerStart, "audio player should be a dedicated component");
  const player = component.slice(playerStart, playerEnd);
  assert.match(player, /className=\{`canvas-audio-player\$\{compact/);
  assert.match(player, /className="canvas-audio-player-native"/);
  assert.match(player, /className="canvas-audio-player-play"/);
  assert.match(player, /aria-label="音频播放进度"/);
  assert.match(player, /aria-label="音量"/);
  assert.doesNotMatch(player, /controls/);
  assert.match(component, /data-node-kind=\{node\.type === "prompt" \? "agent" : node\.type === "upscale" \? "upscale" : data\.kind === "video" \? "video" : data\.kind === "audio" \? "audio"/);
  assert.match(styles, /\.canvas-audio-player\{[^}]*border-radius:15px/);
  assert.match(styles, /\.canvas-audio-player-play\{[^}]*border-radius:50%/);
  assert.match(styles, /\.canvas-audio-panel-meta-chips span\{[^}]*border-radius:999px/);
});

test("audio editor keeps its natural height after viewport fitting", () => {
  assert.match(component, /className="canvas-audio-panel"/);
  assert.match(component, /if \(!audioNode\) return popover\.scrollHeight \|\| estimatedPopoverHeight/);
  assert.match(component, /const naturalHeight = \(head\?\.offsetHeight \|\| 0\) \+ \(body\?\.scrollHeight \|\| 0\) \+ 2/);
  assert.match(styles, /\.canvas-audio-panel\{display:grid;gap:11px;min-width:0\}/);
});

test("image node editing persists parameters without turning uploads into generated media", () => {
  assert.match(component, /role: "参考素材",\s*mimeType: asset\.mime,\s*\.\.\.defaultMediaParams\(asset\.kind, runtime\)/);
  assert.match(component, /generation: item\.data\.generation/);
  assert.match(component, /params: clone\(settings\)/);
  assert.match(component, /prompt: value/);
  assert.match(component, /if \(item\.type === "prompt"\)/);
  const start = component.indexOf("const updatePrompt = useCallback");
  const end = component.indexOf("const updateVariantRequirements = useCallback", start);
  const updatePrompt = component.slice(start, end);
  assert.match(updatePrompt, /node\.data\.generation\s*\?/);
  assert.doesNotMatch(updatePrompt, /generation:\s*\{\s*kind:/);
});

test("mask removal clears both current and persisted generation parameters", () => {
  assert.match(component, /const \{ mask: _mask, \.\.\.withoutMask \} = params/);
  assert.match(component, /mask: undefined/);
  assert.match(component, /generation:\s*\{[\s\S]*params: clone\(cleanedParams\)/);
  assert.match(component, /maskUrl: imageParams\.mask\?\.url/);
});

test("local edit editor reports saving state and passes coverage into the attached image state", () => {
  assert.match(component, /onApply=\{\(value, coverage, prompt, annotations, feather\) => applyCanvasMask\(value, coverage, prompt, annotations, feather\)\}/);
  assert.match(component, /initialMaskDataUrl=\{maskNode\.data\.mask\?\.url \|\| maskSettings\?\.mask\?\.url\}/);
  assert.match(component, /initialFeather=\{maskNode\.data\.mask\?\.feather \?\? maskSettings\?\.mask\?\.feather \?\? 0\}/);
  assert.match(component, /status: "pending"/);
  assert.match(component, /coverage: maskCoverage/);
  assert.match(styles, /\.canvas-node-mask-badge/);
  assert.match(styles, /\.canvas-mask-summary/);
});

test("applying a local edit closes both editors instead of reopening the node prompt", () => {
  const applyStart = component.indexOf("const applyCanvasMask = useCallback");
  const applyEnd = component.indexOf("const removeCanvasMask = useCallback", applyStart);
  const apply = component.slice(applyStart, applyEnd);
  assert.ok(applyStart >= 0 && applyEnd > applyStart, "canvas mask apply handler should be present");
  assert.match(apply, /setExpandedEditorId\(null\)/);
  assert.match(apply, /setMaskNodeId\(null\)/);
  assert.doesNotMatch(apply, /openImageEditor\(node, \{ params, prompt: nextPrompt \}\)/);
});

test("local edit summary only occupies editor space when a mask exists", () => {
  const editorStart = component.indexOf("function CanvasNodeEditorPopover");
  const summaryStart = component.indexOf("function CanvasMaskSummary");
  assert.ok(editorStart >= 0 && summaryStart > editorStart, "mask editor components should be present");
  const editor = component.slice(editorStart, summaryStart);
  assert.match(editor, /onLocalEdit && maskState && \(/);
  assert.doesNotMatch(editor, /尚未设置，绘制后只重新生成指定区域/);
  assert.doesNotMatch(styles, /\.canvas-mask-summary\.empty/);
  assert.match(component, /label: node\.data\.mask \? "查看局部编辑" : "局部编辑"/);
});

test("dock local edit control keeps the remove action inside the same chip", () => {
  assert.match(component, /className="canvas-node-editor-dock-local-edit"/);
  assert.match(component, /className="canvas-node-editor-dock-chip canvas-node-editor-dock-chip-edit"/);
  assert.match(component, /className="canvas-node-editor-dock-chip canvas-node-editor-dock-chip-remove"/);
  assert.match(component, /aria-label="删除局部编辑"/);
  assert.match(component, /title="删除当前局部编辑范围"/);
  const removeStart = component.indexOf("className=\"canvas-node-editor-dock-chip canvas-node-editor-dock-chip-remove\"");
  const removeEnd = component.indexOf("</button>", removeStart);
  assert.ok(removeStart >= 0 && removeEnd > removeStart, "local edit remove button should be present");
  assert.doesNotMatch(component.slice(removeStart, removeEnd), /data-tooltip=/);
  assert.match(component, /event\.stopPropagation\(\);\s*onLocalEditRemove\(\)/);
  assert.match(styles, /\.canvas-node-editor-dock-local-edit\{[^}]*position:relative[^}]*isolation:isolate[^}]*border-radius:999px/);
  assert.match(styles, /\.canvas-node-editor-dock-local-edit \.canvas-node-editor-dock-chip-edit\{[^}]*padding:0 31px 0 9px/);
  assert.match(styles, /\.canvas-node-editor-dock-local-edit \.canvas-node-editor-dock-chip-remove\{[^}]*position:absolute[^}]*display:grid[^}]*place-items:center[^}]*border-radius:50%/);
});

test("regular editor stays below its node in the stacked main-composer layout", () => {
  assert.match(component, /fitCanvasNodeEditorBelow\(/);
  assert.match(component, /const fittedPosition = fitCanvasNodeEditorBelow\(\s*anchor,/);
  assert.doesNotMatch(component, /layoutAnchor/);
  assert.match(component, /data-placement="bottom"/);
  assert.match(component, /const position = stackedEditor\s*\? \{ \.\.\.fittedPosition, maxHeight: popoverHeight \}/);
  assert.match(component, /maxHeight: promptExpanded \|\| stackedEditor \|\| isDockNode \? undefined : position\.maxHeight/);
  assert.doesNotMatch(component, /needsFullPanelLift/);
  assert.doesNotMatch(component, /useTopPlacement/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-columns-node:not\(.is-prompt-expanded\)\[data-density\]\{[^}]*width:min\(920px,calc\(100vw - 64px\)\)!important/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-columns-node:not\(.is-prompt-expanded\)\{[^}]*max-height:none!important/);
  assert.match(styles, /\.canvas-node-editor-popover:not\(.is-prompt-expanded\) \.canvas-node-editor-columns\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(styles, /\.canvas-node-editor-popover:not\(.is-prompt-expanded\) \.canvas-node-editor-settings>.creation-parameter-editor\.image \.creation-parameter-grid\.primary\{grid-template-columns:repeat\(4,minmax\(0,1fr\)/);
  assert.match(styles, /\.canvas-node-editor-popover:not\(.is-prompt-expanded\) \.canvas-node-editor-settings>.creation-parameter-editor\.image \.creation-parameter-grid\.primary>.creation-field\.model\{grid-column:1\/-1\}/);
  assert.match(styles, /\.canvas-node-editor-popover:not\(.is-prompt-expanded\) \.canvas-node-editor-actions\{min-height:55px/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-columns-node:not\(.is-prompt-expanded\) \.canvas-editor-frame-slot\{\s*min-height:0!important/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-columns-node:not\(.is-prompt-expanded\) \.canvas-node-editor-actions\{\s*min-height:38px/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-image-dock:not\(.is-prompt-expanded\)\[data-density\]\{\s*width:min\(940px,calc\(100vw - 64px\)\)!important;/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-image-dock:not\(.is-prompt-expanded\)\[data-density\]\{[^}]*max-height:none!important/);
  assert.match(styles, /\.canvas-node-editor-popover\.is-image-dock:not\(.is-prompt-expanded\) \.canvas-node-editor-dock-tool\.params\{\s*flex:0 1 360px;/);
});

test("multi-select layout toolbar exposes alignment and distribution icons only for ordinary nodes", () => {
  assert.match(component, /const CANVAS_ALIGNMENT_OPTIONS/);
  assert.match(component, /const CANVAS_DISTRIBUTION_OPTIONS/);
  assert.match(component, /alignCanvasNodes\(\s*docRef\.current,\s*\[\.\.\.selectedIds\],\s*alignment,?\s*\)/);
  assert.match(component, /distributeCanvasNodes\(\s*docRef\.current,\s*\[\.\.\.selectedIds\],\s*direction,?\s*\)/);
  assert.match(component, /selectedNodes\.length >= 2 && !selectedGroupId/);
  assert.match(component, /className="canvas-selection-layout-toolbar"/);
  assert.match(component, /className="canvas-selection-layout-group alignment"/);
  assert.match(component, /className="canvas-selection-layout-group distribution"/);
  assert.match(component, /disabled=\{disabled\}/);
  assert.match(component, /至少选择 3 个节点后可/);
  ["左对齐", "水平居中", "右对齐", "顶部对齐", "垂直居中", "底部对齐"].forEach((label) => {
    assert.match(component, new RegExp(`label: "${label}"`));
  });
  ["水平均匀分布", "垂直均匀分布"].forEach((label) => {
    assert.match(component, new RegExp(`label: "${label}"`));
  });
  assert.match(component, /function CanvasLayoutIcon/);
  assert.match(component, /title=\{option\.title\}/);
  assert.match(component, /aria-label=\{option\.title\}/);
  assert.match(component, /canvas-selection-toolbar,\.canvas-selection-layout-toolbar/);
  assert.match(component, /commit\(\(\) => result\.document\)/);
  assert.doesNotMatch(component, /canvas-selection-align-actions/);
  assert.match(styles, /\.canvas-selection-layout-toolbar\{position:absolute/);
  assert.match(styles, /\.canvas-selection-layout-group\.alignment/);
  assert.match(styles, /\.canvas-selection-layout-group\.distribution/);
  assert.match(styles, /\.canvas-selection-layout-tooltip::after/);
});

test("group selection uses a toolbar attached to the group card while ordinary multi-select keeps its toolbar", () => {
  assert.match(component, /function CanvasGroupSelectionToolbar\(/);
  assert.match(component, /data-canvas-group-id=\{group\.id\}/);
  assert.match(component, /placeCanvasGroupToolbar\(bounds, stageSize, overlay, 10\)/);
  assert.match(component, /arrangeCanvasGroup\(docRef\.current, activeGroup\.id\)/);
  assert.match(component, /selectedGroupId \? "⌗ 整理组内" : "⌗ 整理选中"/);
  assert.match(
    component,
    /selectedNodes\.length >= 2 && \(\s*selectedGroupId && selectedGroup \?\s*\(\s*<CanvasGroupSelectionToolbar[\s\S]*?<\/CanvasGroupSelectionToolbar>\s*\)\s*:\s*\(\s*<div\s+className="canvas-selection-toolbar"/,
  );
  assert.match(component, /selectedNodes\.length >= 2 && !selectedGroupId/);
  assert.match(styles, /\.canvas-group-selection-toolbar\{[^}]*transform:none/);
});

test("canvas image parameters collapse into a compact one-line collection", () => {
  assert.match(parameterEditor, /canvas-parameter-collection/);
  assert.match(parameterEditor, /aria-controls="canvas-image-parameter-drawer"/);
  assert.match(parameterEditor, /aria-expanded=\{parameterDrawerOpen\}/);
  assert.match(parameterEditor, /canvas-parameter-options quality/);
  assert.match(parameterEditor, /canvas-parameter-options resolution/);
  assert.match(parameterEditor, /canvas-parameter-options aspect/);
  assert.match(parameterEditor, /canvas-parameter-options count/);
  assert.match(parameterEditor, /\[1, 2, 3, 4, 5, 6, 7, 8\]\.map/);
  assert.match(styles, /\.canvas-node-editor-popover \.canvas-parameter-trigger\{[^}]*min-height:38px/);
  assert.match(styles, /\.canvas-node-editor-popover \.canvas-parameter-trigger>span\{display:flex;align-items:baseline/);
  assert.match(styles, /\.canvas-node-editor-popover \.canvas-parameter-options\.aspect\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.canvas-node-editor-popover \.canvas-parameter-drawer\{position:absolute;z-index:var\(--canvas-z-node-editor\)/);
  assert.match(styles, /\.canvas-node-editor-popover:has\(\.canvas-parameter-drawer\)\{z-index:var\(--canvas-z-node-editor\);overflow:visible\}/);
  assert.match(styles, /\.canvas-node-editor-popover \.canvas-parameter-drawer\{position:absolute;z-index:var\(--canvas-z-node-editor\)[^}]*padding:9px;gap:7px/);
  assert.match(styles, /\.canvas-node-editor-popover \.canvas-parameter-options\.aspect>button\{height:44px/);
  assert.match(styles, /\.canvas-node-editor-popover \.canvas-parameter-options\.count\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:4px\}/);
  assert.match(styles, /data-density="compact"\]\{width:min\(500px/);
  assert.match(styles, /data-density="micro"\]\{width:min\(360px/);
  assert.match(styles, /data-density="micro"\]\{width:min\(360px,calc\(100vw - 24px\)\);max-height:min\(400px/);
});

test("canvas stacking rules are tokenized instead of using historical hard-coded values", () => {
  [
    "--canvas-z-grid:0",
    "--canvas-z-edge:10",
    "--canvas-z-group:20",
    "--canvas-z-node:30",
    "--canvas-z-stage-guide:50",
    "--canvas-z-selection:70",
    "--canvas-z-deck:80",
    "--canvas-z-topbar:100",
    "--canvas-z-node-quick:200",
    "--canvas-z-node-editor:220",
    "--canvas-z-asset-drawer:260",
    "--canvas-z-portal-popover:300",
    "--canvas-z-context-menu:360",
    "--canvas-z-expanded-editor:450",
    "--canvas-z-modal:500",
    "--canvas-z-asset-preview:520",
    "--canvas-z-asset-picker:540",
    "--canvas-z-model-dialog:560",
    "--canvas-z-modal-popover:580",
    "--canvas-z-toast:700",
  ].forEach((token) => assert.match(styles, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));
  assert.doesNotMatch(styles, /z-index\s*:\s*-?\d+!?/);
});
