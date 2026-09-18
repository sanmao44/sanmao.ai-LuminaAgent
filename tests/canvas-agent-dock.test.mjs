import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [component, canvas, styles, context, canvasApi, route, markdown] = await Promise.all([
  readFile(new URL("../components/CanvasAgentDock.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/SuperCanvas.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/canvas.css", import.meta.url), "utf8"),
  readFile(new URL("../lib/canvas/agent-dock.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/canvas/api.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/agent/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../components/AgentMarkdown.tsx", import.meta.url), "utf8"),
]);

test("the canvas agent dock mounts in SuperCanvas and is bound to the selection", () => {
  assert.match(canvas, /<CanvasAgentDock[\s\S]*?contextBlock=\{agentDockContext\.text\}/);
  assert.match(canvas, /references=\{agentDockReferences\}/);
  assert.match(canvas, /onApplyImages=\{applyAgentDockImages\}/);
  assert.match(canvas, /onApplyText=\{applyAgentDockText\}/);
  assert.match(canvas, /buildCanvasAgentDockContext\(document, selectedIds, currentProject\?\.name/);
});

test("closing the dock leaves a rail entry point and the open state is remembered", () => {
  assert.match(component, /canvas-agent-dock-rail\$\{busy \? " is-busy" : ""\}/);
  assert.match(component, /onClick=\{\(\) => onToggle\(true\)\}/);
  assert.match(component, /onClick=\{\(\) => onToggle\(false\)\}/);
  assert.match(canvas, /localStorage\.setItem\(CANVAS_AGENT_DOCK_OPEN_KEY/);
  assert.match(canvas, /localStorage\.getItem\(CANVAS_AGENT_DOCK_OPEN_KEY\) === "1"/);
});

test("the right-hand slot hosts one panel at a time", () => {
  assert.match(canvas, /const applyAgentDockOpen = useCallback\(/);
  assert.match(canvas, /if \(open\) closeCanvasOverlayConflicts\(\);/);
  assert.match(canvas, /closeCanvasOverlayConflicts\(\);\s*setAgentDockOpen\(false\);\s*setActivePanel\(panel\);/);
  assert.match(canvas, /onToggle=\{applyAgentDockOpen\}/);
  assert.match(canvas, /onClick=\{\(\) => applyAgentDockOpen\(!agentDockOpen\)\}/);
});

test("the right-hand slot reads as one dock instead of separate overlays", () => {
  // One geometry token set drives the drawer, the dock and the shell panels.
  assert.match(styles, /\.canvas-panel-backdrop\{[^}]*padding:var\(--canvas-panel-top\) var\(--canvas-panel-right\) var\(--canvas-panel-bottom\)/);
  assert.match(styles, /\.canvas-side-panel\{pointer-events:auto;width:var\(--canvas-panel-width\)/);
  assert.match(styles, /@media\(max-width:1280px\)\{:root\{--canvas-panel-width:min\(430px,calc\(100vw - 32px\)\)\}/);
  assert.match(styles, /@media\(max-width:960px\)\{\s*:root\{--canvas-panel-width:min\(390px,calc\(100vw - 32px\)\)\}/);
  // No breakpoint may pin the drawer to a width the side panels do not share.
  assert.doesNotMatch(styles, /\.canvas-asset-drawer\{width:min\(/);
  // The slot is a dock, so it must not dim the app or swallow topbar clicks.
  assert.match(styles, /\.canvas-panel-backdrop\{[^}]*background:transparent;backdrop-filter:none;pointer-events:none\}/);
  assert.match(styles, /\.canvas-workspace:has\(:is\(\.canvas-asset-drawer,\.canvas-panel-backdrop\)\) \.canvas-deck\{left:16px;transform:none;width:min\(900px,calc\(100% - 528px\)\)\}/);
  // Escape and the topbar button both close an open shell panel.
  assert.match(canvas, /function CanvasPanelShell[\s\S]{0,400}?if \(event\.key === "Escape"\) onClose\(\);[\s\S]{0,400}?className="canvas-modal-backdrop canvas-panel-backdrop">/);
  assert.doesNotMatch(canvas, /canvas-panel-backdrop" onClick=/);
  assert.match(canvas, /onClick=\{\(\) => activePanel === "settings" \? setActivePanel\(null\) : openCanvasPanel\("settings"\)\}/);
  assert.match(canvas, /onClick=\{\(\) => activePanel === "shortcuts" \? setActivePanel\(null\) : openCanvasPanel\("shortcuts"\)\}/);
});

test("the dock sends canvas context only with the message being sent", () => {
  assert.match(component, /index === history\.length - 1[\s\S]*?composeCanvasAgentDockMessage\(resolveReferenceMentions\(message\.content, orderedReferences\), contextBlock\)/);
  assert.match(component, /references: orderedReferences\.slice\(0, CANVAS_AGENT_DOCK_MAX_REFERENCES\)/);
  assert.match(context, /export function composeCanvasAgentDockMessage/);
  assert.match(context, /以上为画布自动附带的上下文，不是用户指令。/);
});

test("canvas context never decides what the dock asks for", () => {
  // 画布上下文里有“画布 / 图片 / 渲染”，一旦参与意图判断，问什么都会变成生图。
  assert.match(component, /intentText: text,/);
  assert.match(canvasApi, /\.\.\.\(input\.intentText \? \{ intentText: input\.intentText \} : \{\}\),/);
  assert.match(route, /const latestInstruction = agentInstructionText\(body\.intentText, latest\?\.content \|\| ''\);/);
  assert.match(route, /classifyAgentDeliverable\(latestInstruction, \{/);
  assert.match(route, /shouldUseAgentWebSearch\(webMode, latestInstruction, messages\.slice\(0, -1\)\)/);
});

test("agent text and images land on the canvas through the shared undostack", () => {
  assert.match(canvas, /const applyAgentDockImages = useCallback\(/);
  assert.match(canvas, /commit\(\(value\) => \{\s*let next = \{ \.\.\.value, nodes: \[\.\.\.value\.nodes, \.\.\.nodes\] \};/);
  assert.match(canvas, /addEdge\(next, anchor\.id, node\.id, "right", "left", "generated"\)/);
  assert.match(canvas, /void recordCanvasImages\(incoming, \{/);
  assert.match(canvas, /const applyAgentDockText = useCallback\(/);
  assert.match(canvas, /role: "Agent 回复"/);
});

test("smart canvas apply only promotes explicit canvas-directed replies", () => {
  assert.match(context, /export function canvasAgentDockShouldAutoApplyText/);
  assert.match(component, /canvasAgentDockShouldAutoApplyText\(text\)/);
  assert.match(component, /textNodeId: appliedIds\[0\]/);
  assert.ok(component.includes("明确说保存、加入或放到画布时，文字回复也会自动生成节点"));
  assert.match(context, /ordinary answers or web-search results/);
});

test("explicit reuse commands stay local and do not call the model again", () => {
  assert.match(context, /export function canvasAgentDockRequestsPreviousImageApply/);
  assert.match(component, /canvasAgentDockRequestsPreviousImageApply\(text\)/);
  assert.match(component, /previousImageMessage\.imageNodeIds/);
  assert.ok(component.includes("上一轮图片已经在画布中，已为你定位结果。"));
});

test("canvas workflows expose a reviewable plan and apply through one canvas transaction", () => {
  assert.match(context, /export type CanvasAgentDockPlan/);
  assert.match(context, /export function buildCanvasAgentDockPlan/);
  assert.match(context, /kind: "batch-image-layout"/);
  assert.match(component, /onApplyPlan: \(plan: CanvasAgentDockPlan/);
  assert.match(component, /画布操作计划/);
  assert.match(component, /确认并应用/);
  assert.match(canvas, /const applyAgentDockPlan = useCallback/);
  assert.match(canvas, /Apply a complete Agent canvas plan as one undoable transaction/);
  assert.match(canvas, /const result = arrangeCanvas\(next/);
  assert.match(canvas, /commit\(\(\) => next\)/);
  assert.match(styles, /\.canvas-agent-dock-plan\{/);
});

test("canvas status and node summaries are capped before they reach the model", () => {
  assert.match(context, /export const CANVAS_AGENT_DOCK_CONTEXT_MAX_CHARS = 1600/);
  assert.match(context, /export const CANVAS_AGENT_DOCK_CONTEXT_MAX_NODES = 12/);
  // 按行裁剪：硬切 slice 会把某条节点摘要截成半句，模型会照着半句话下判断。
  assert.doesNotMatch(context, /lines\.join\("\\n"\)\.slice\(0, CANVAS_AGENT_DOCK_CONTEXT_MAX_CHARS\)/);
  assert.match(context, /function clipCanvasAgentDockLines\(lines: readonly string\[\]\)/);
  assert.match(context, /if \(used \+ line\.length \+ 1 > CANVAS_AGENT_DOCK_CONTEXT_MAX_CHARS\) \{/);
  assert.match(context, /（节点信息过长，已省略后续 \$\{lines\.length - index\} 行）/);
  assert.match(context, /export const CANVAS_AGENT_DOCK_MAX_REFERENCES = 8/);
});

test("audio nodes are never sent as agent references", () => {
  assert.match(canvas, /\.flatMap\(\(reference\) =>\s*reference\.kind === "audio"/);
  assert.match(component, /kind: "text" \| "image" \| "video"|CanvasAgentDockReference/);
});

test("the dock keeps a right-hand dock layout and shifts the composer aside", () => {
  assert.match(styles, /\.canvas-agent-dock\{[^}]*position:fixed[^}]*right:var\(--canvas-panel-right\)[^}]*top:var\(--canvas-panel-top\)/);
  assert.match(styles, /\.canvas-agent-dock-rail\{[^}]*position:fixed[^}]*right:18px/);
  // Every right-hand panel shares one slot, so the dock reads the slot tokens.
  assert.match(styles, /--canvas-panel-width:min\(480px,calc\(100vw - 32px\)\)/);
  assert.match(styles, /\.canvas-agent-dock\{[^}]*width:var\(--canvas-panel-width\)/);
  assert.match(styles, /\.canvas-workspace:has\(\.canvas-agent-dock\) \.canvas-deck:not\(\.collapsed\)\{left:calc\(50% - 230px\)/);
  // The drawer and the dock take turns in the slot, so the dock never parks beside it.
  assert.doesNotMatch(styles, /canvas-asset-drawer\) \.canvas-agent-dock\{right:/);
});

test("the dock never deletes canvas content on its own", () => {
  assert.doesNotMatch(component, /removeNode|deleteNode|removeCanvasNode/);
  assert.doesNotMatch(canvas.slice(canvas.indexOf("const applyAgentDockImages = useCallback(")), /commit\(\(value\) => \(\{[^}]*nodes: value\.nodes\.filter/);
});

test("the stage keeps the dock interactive so the panel never clears the selection", () => {
  const registered = canvas.match(/\.canvas-minimap,\.canvas-agent-dock,\.canvas-agent-dock-rail,/g) || [];
  assert.ok(
    registered.length >= 5,
    `the dock belongs in every stage interaction list (found ${registered.length})`,
  );
  assert.match(
    canvas,
    /"\.canvas-agent-dock",\s*\n\s*"\.canvas-agent-dock-rail",\s*\n\s*"\.canvas-workbench",/,
  );
  assert.match(canvas, /\.canvas-node-editor-popover\.is-prompt-expanded,\.canvas-agent-dock",/);
});

test("the dock session is persisted only after hydration so reloads keep the conversation", () => {
  assert.match(component, /const \[hydrated, setHydrated\] = useState\(false\);/);
  assert.match(component, /if \(!hydrated \|\| typeof window === "undefined"\) return;/);
  assert.match(component, /\}, \[hydrated, messages, model, webMode, autoApply\]\);/);
  assert.doesNotMatch(component, /hydratedRef/);
});

test("the dock reuses the shared skill manager so canvas chats install skills too", () => {
  assert.match(component, /import SkillManager from "@\/components\/SkillManager";/);
  assert.match(component, /canvas-agent-dock-head-actions[\s\S]*?<SkillManager disabled=\{busy\} icon=\{<SkillIcon size=\{14\} \/>\} \/>/);
  assert.match(styles, /\.canvas-agent-dock-head-actions>button\[data-tooltip\]::after\{left:auto;right:0;top:calc\(100% \+ 8px\)/);
});

test("the collapsed rail yields to the expanded topbar and reads horizontally", () => {
  // Wide screens already expose the Agent button in the topbar; the floating rail is
  // only the entry point once the topbar is collapsed or the viewport is small.
  assert.match(styles, /@media\(min-width:1001px\)\{\.canvas-workspace:has\(\.canvas-topbar:not\(\.collapsed\)\) \.canvas-agent-dock-rail\{display:none\}\}/);
  assert.doesNotMatch(styles, /\.canvas-agent-dock-rail em\{[^}]*writing-mode/);
  assert.match(styles, /\.canvas-agent-dock-rail\{[^}]*display:inline-flex[^}]*gap:7px/);
});

test("the web mode button keeps one width so the composer row never reflows", () => {
  // measured: the 3-character label used to fit on one line while the 4-character
  // ones pushed the send button onto a second row, so the whole composer jumped.
  assert.match(styles, /\.canvas-agent-dock-web\{[^}]*flex:none[^}]*min-width:calc\(20px \+ 4em\)/);
  assert.match(component, /off: "[\s\S]*?auto: "[\s\S]*?always: "/);
});

test("dock toolbar button sizing never leaks into the skill dialog", () => {
  assert.doesNotMatch(styles, /\.canvas-agent-dock-head-actions button/);
});

test("opening the dock never shifts the compact canvas topbar", () => {
  assert.doesNotMatch(styles, /with-agent-dock/);
  assert.doesNotMatch(canvas, /with-agent-dock/);
  assert.match(styles, /\.canvas-topbar-main\{width:max-content;max-width:min\(1360px,calc\(100% - 28px\)\)/);
});

test("the save and sync badges keep the max-content topbar at a stable width", () => {
  // The bar hugs its content on wide screens, so every status label change used to
  // resize the whole bar. Both badges reserve room for their longest label.
  assert.match(styles, /\.canvas-topbar-main>\.canvas-save-state\{min-width:calc\(29px \+ 4\.5em\)\}/);
  assert.match(styles, /\.canvas-topbar-main>\.canvas-workspace-sync-state\{min-width:calc\(26px \+ 5\.5em\)\}/);
});

test("the dock composer calls the shared skill picker with slash and a toolbar button", () => {
  assert.match(component, /import AgentSkillMenu from "@\/components\/AgentSkillMenu";/);
  assert.match(component, /const slashQuery = skillSlashQuery\(value\);/);
  assert.match(component, /className=\{`canvas-agent-dock-skill \$\{skillMenuOpen \? "is-active" : ""\}`\}/);
  assert.match(component, /setInput\(\(value\) => skillMessageValue\(value, skill\.name\)\)/);
  assert.match(component, /<AgentSkillMenu[\s\S]*?emptyHint="还没有启用中的技能。点右上角的「技能」按钮可以安装或启用。"/);
  assert.match(styles, /\.canvas-agent-dock-skill\{/);
  assert.match(styles, /\.canvas-agent-dock-composer \.agent-skill-menu\{/);
});

test("the floating rail and minimap restore use the shared control shadow", () => {
  assert.match(styles, /\.canvas-agent-dock-rail\{[^}]*box-shadow:var\(--shadow-control\)/);
  assert.match(styles, /\.canvas-minimap-restore\{[^}]*box-shadow:var\(--shadow-control\)/);
  assert.doesNotMatch(styles, /0 10px 28px rgba\(0,0,0,\.22\)/);
});

test("the dock picks the agent model with the shared model picker", () => {
  // 全站选模型都是同一套 ModelPicker（推荐 / 最近调用 / 收藏 / 搜索 / 按服务商筛选），
  // 面板之前用普通下拉，几十个对话模型只能一行行翻，也没有收藏。
  assert.match(component, /import ModelPicker from "@\/components\/ModelPicker"/);
  assert.match(component, /<ModelPicker[\s\S]*?capability="chat"/);
  assert.match(component, /models=\{runtime\?\.models \|\| \[\]\}/);
  assert.match(component, /defaultModelId=\{runtime\?\.settings\.agentModelId\}/);
  assert.match(component, /dialogPortalZIndex=\{CANVAS_Z_INDEX\.modelDialog\}/);
  assert.doesNotMatch(component, /<SelectMenu/);
  // 生成中不给换模型：ModelPicker 没有 disabled，用 inert 把整块挡住。
  assert.match(component, /canvas-agent-dock-model-wrap\$\{busy \? " is-busy" : ""\}`\} inert=\{busy \? true : undefined\}/);
  assert.match(styles, /\.canvas-agent-dock-model \.model-picker-trigger\{height:30px/);
});

test("the dock composer is the same @ reference editor as the rest of the app", () => {
  // 全项目输入框都是 ReferenceMentionEditor，面板不能自己再留一个 textarea。
  assert.match(component, /import ReferenceMentionEditor from "@\/components\/ReferenceMentionEditor";/);
  assert.match(component, /<ReferenceMentionEditor[\s\S]*?references=\{mentionOptions\}/);
  assert.doesNotMatch(component, /<textarea/);
  assert.match(component, /const mentionOptions = useMemo<ReferenceMentionOption\[\]>/);
  assert.match(component, /transformPastedText=\{\(value\) => replaceNaturalReferenceLabels\(value, mentionOptions\)\.value\}/);
  // Enter 发送 / Shift+Enter 换行，以及 / 技能菜单的回车选中都必须保留。
  assert.match(component, /if \(event\.key === "Enter" && !event\.shiftKey && !event\.nativeEvent\.isComposing\)/);
  // 生成中回车不能既不发也不说：先提示怎么停。
  assert.ok(component.includes('if (busy) notify("Agent 正在生成，按 Esc 可以停止当前回答");'));
  assert.match(component, /else void send\(\);/);
  // 高度还是自适应到上限后才在内部滚动。
  assert.match(styles, /\.canvas-agent-dock \.canvas-agent-dock-mention-editor \.reference-mention-editor-content\{[^}]*min-height:56px;max-height:190px;/);
  assert.match(styles, /\.canvas-agent-dock \.canvas-agent-dock-mention-editor \.reference-mention-editor-content\{[^}]*overflow-y:auto/);
  // 面板贴在屏幕底部，@ 菜单只能向上展开。
  assert.match(component, /menuClassName="canvas-mention-menu canvas-agent-dock-mention-menu"/);
  assert.match(styles, /\.canvas-agent-dock-composer \.canvas-mention-menu\{left:0;right:0;width:auto/);
  assert.match(styles, /\.canvas-mention-menu\{[^}]*bottom:calc\(100% \+ 7px\)/);
});

test("dock chips carry the @ number and can be dragged into order", () => {
  // 编号必须就是 @编号：芯片和引用列表共用一份顺序，拖动改的是同一份。
  assert.match(component, /const orderedReferences = useMemo\([\s\S]*?orderByReferenceIds\(references, chipOrder, referenceOrderKey\)/);
  assert.match(component, /const chipMentionIndexes = useMemo\(/);
  assert.match(component, /const mentionIndex = chipMentionIndexes\.get\(chip\.id\);/);
  assert.match(component, /className="canvas-agent-dock-chip-index"/);
  assert.match(component, /function reorderReferenceIds\(/);
  // 画布 stage 会吃掉原生 HTML5 拖拽（缩略图还带 -webkit-user-drag:none），所以芯片改用指针事件拖；
  // 只有面板里的图片允许用原生 draggable 拖出去落到画布。
  const chipOpening = component.slice(
    component.indexOf("className={`canvas-agent-dock-chip"),
    component.indexOf("onPointerDown={(event) => beginChipDrag"),
  );
  assert.doesNotMatch(chipOpening, /draggable/);
  assert.match(component, /data-chip-id=\{chip\.id\}/);
  assert.match(component, /onPointerDown=\{\(event\) => beginChipDrag\(event, chip\.id\)\}/);
  assert.match(component, /onPointerMove=\{\(event\) => trackChipDrag\(event, chip\.id\)\}/);
  assert.match(component, /event\.currentTarget\.setPointerCapture\(event\.pointerId\);/);
  assert.match(component, /const moveChip = useCallback\(/);
  assert.match(component, /reorderReferenceIds\(order, order\.indexOf\(draggedId\), order\.indexOf\(targetId\)\)/);
  assert.match(component, /const targetId = chipIdUnderPoint\(contextRef\.current, chipId, event\.clientX, event\.clientY\);/);
  // 落点用命中判定：指针压在哪枚芯片上就换到哪枚的位置，折行时也准。
  assert.match(component, /function chipIdUnderPoint\(container: HTMLElement \| null, draggedId: string, clientX: number, clientY: number\)/);
  assert.match(component, /if \(clientX >= rect\.left && clientX <= rect\.right && clientY >= rect\.top && clientY <= rect\.bottom\) return id;/);
  // 拖完浏览器补的 click 不能把视口带跑。
  assert.match(component, /chipClickBlockedRef\.current/);
  assert.match(component, /className=\{`canvas-agent-dock-chip\$\{dragChipId === chip\.id \? " dragging" : ""\}`\}/);
  // 拖动只改面板里的顺序，不能反过来改画布选中顺序（选中顺序由画布 useMemo 决定）。
  assert.doesNotMatch(component, /setSelectedIds|onReorderSelection/);
  assert.match(styles, /\.canvas-agent-dock-chip\.dragging\{/);
  // 触摸拖动不能被滚动抢走手势。
  assert.match(styles, /\.canvas-agent-dock-chip\{cursor:grab;touch-action:none\}/);
  // 芯片按等宽列排满整行，标签自己吃掉列里剩下的宽度，不再留半行的空白。
  assert.match(styles, /\.canvas-agent-dock-context\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(136px,1fr\)\)/);
  assert.match(styles, /\.canvas-agent-dock-chip span\{flex:1;min-width:0;/);
  // 芯片折行后能滚，但不要把滚动条露出来（和主界面 .canvas-input-semantics 一个做法）。
  assert.match(styles, /\.canvas-agent-dock-context\{[^}]*scrollbar-width:none\}/);
  assert.match(styles, /\.canvas-agent-dock-context::-webkit-scrollbar\{display:none\}/);
  assert.match(styles, /\.canvas-agent-dock-chip-index\{/);
});

test("dock @ mentions resolve against the ordered references before sending", () => {
  // @1 只是面板里的编号，发给模型前要还原成它指向的那张图，否则模型对不上。
  assert.match(component, /function resolveReferenceMentions\(text: string, references: readonly CanvasAgentDockReference\[\]\)/);
  assert.match(component, /invalidReferenceMentionNumbers\(text, orderedReferences\)/);
  assert.match(component, /const mentionText = resolveReferenceMentions\(text, orderedReferences\);/);
  assert.match(component, /onApplyImages\(images, \{ prompt: mentionText, model: response\.model \}\);/);
});

test("both sides of the conversation can copy their text", () => {
  // 用户常要把自己刚写的那句提示词拿去别处复用，所以自己的消息也要能复制。
  assert.match(component, /const copyMessage = useCallback\(/);
  assert.match(component, /message\.role === "user" \? \(\s*<>\s*<button type="button" disabled=\{busy\} onClick=\{\(\) => beginEditMessage\(message\)\}>/);
  assert.match(component, /message\.role === "assistant" && !message\.error \? \([\s\S]{0,400}?copyMessage\(message\.content\)/);
  // 放在气泡左侧，避免在自己的消息里被挤成第二行。
  assert.match(styles, /\.canvas-agent-dock-message\.user>\.canvas-agent-dock-message-tools\{position:absolute;right:100%;bottom:2px;margin-right:5px/);
  assert.match(styles, /\.canvas-agent-dock-message\.user\{position:relative;align-self:flex-end;max-width:calc\(92% - 42px\)/);
  // 绝对定位 + right:100% 会把宽度塌成 min-content，按钮文字被挤成竖排，必须钉住宽度。
  assert.match(styles, /\.canvas-agent-dock-message\.user>\.canvas-agent-dock-message-tools\{[^}]*width:max-content\}/);
  // 带图片的消息按钮更多，左侧空隙不够，回到气泡内部右对齐。
  assert.match(component, /message\.role === "user" && message\.images\?\.length \? "has-media"/);
  assert.match(styles, /\.canvas-agent-dock-message\.user\.has-media>\.canvas-agent-dock-message-tools\{position:static/);
});

test("the dock reply offers the same select-text toolbar as the node text viewer", () => {
  // 节点文本里已经有选段工具栏，面板里的回复直接复用同一套按钮和样式。
  assert.match(component, /onMouseUp=\{updateSelection\}/);
  assert.match(component, /canvas-text-selection-toolbar canvas-agent-dock-selection-toolbar \$\{selection\.placement\}/);
  assert.match(component, /复制选段/);
  assert.match(component, /创建 Agent 节点/);
  assert.match(component, /转图片/);
  assert.match(component, /转视频/);
  // 工具栏不能被 portal 出去：画布用 DOM 祖先判断 UI 覆盖层，否则会把这一按
  // 当成平移起手（setPointerCapture），按钮永远收不到 click。
  assert.doesNotMatch(component, /createPortal/);
  assert.match(component, /log\?\.closest\("\.canvas-agent-dock"\)/);
  assert.match(styles, /\.canvas-agent-dock>\.canvas-agent-dock-selection-toolbar\{position:absolute\}/);
  assert.match(styles, /\.canvas-text-selection-toolbar\{position:fixed/);
  // 画布把 user-select 关了，面板里的回复必须重新打开才选得中。
  assert.match(styles, /\.canvas-agent-dock-message\{user-select:text;-webkit-user-select:text\}/);
  assert.match(canvas, /onCreateAgentNode=\{applyAgentDockAgentNode\}/);
  assert.match(canvas, /onUseAsImagePrompt=\{applyAgentDockImageBranch\}/);
  assert.match(canvas, /onUseAsVideoPrompt=\{applyAgentDockVideoBranch\}/);
});

test("dock select-text actions fall back to the viewport centre without a selection", () => {
  // 没选中节点时不能连线，节点落在视口中心，anchor 必须可空。
  assert.match(canvas, /\(anchor: CanvasNode \| null, value: string\) => \{\s*if \(anchor && anchor\.type !== "prompt"\) return;/);
  assert.match(canvas, /\(text: string\) => createImageBranchFromText\(selectedSingle \|\| selectedNodes\[0\] \|\| null, text\)/);
  assert.match(canvas, /\(text: string\) => createViewerAgentNode\(selectedSingle \|\| selectedNodes\[0\] \|\| null, text\)/);
  assert.match(canvas, /return anchor\s*\?\s*addEdge\(withNode, anchor\.id, nextImageNode\.id/);
});

test("the dock header counts the tasks of the selected nodes", () => {
  // 头部曾经拿整张画布的任务数当“你的任务”：选中的节点明明是好的，也会显示“3 个失败”。
  assert.match(context, /status\?: CanvasGenerationStatus;/);
  assert.match(canvas, /\.\.\.\(node\.data\.status \? \{ status: node\.data\.status \} : \{\}\),/);
  assert.match(canvas, /selectedTotal=\{agentDockContext\.nodeIds\.length\}/);
  assert.match(component, /function countSelectedTaskStatus\(chips: readonly CanvasAgentDockChip\[\]\)/);
  assert.match(component, /const selectedTaskText = useMemo\(\(\) => taskStatusText\(countSelectedTaskStatus\(orderedChips\)\), \[orderedChips\]\);/);
  assert.match(component, /已选中 \$\{selectedNodeTotal\} 个节点/);
  assert.match(component, /const selectedNodeTotal = selectedTotal \?\? chips\.length;/);
  // 选中里没有任务时才提整张画布，而且必须写明是“画布上”，不能混进选中数字里。
  assert.match(component, /\{!selectedTaskText && canvasTaskLinks\.length \? \(/);
  assert.match(component, /canvasTaskLinks\.map\(\(link, index\) => \(/);
  assert.doesNotMatch(component, /status\.failed > 0 \? ` · \$\{status\.failed\} 个失败`/);
});

test("the dock tells the user when the selection is larger than the reference limit", () => {
  // 引用有上限，超出的节点不会发给模型，面板必须说出来。
  assert.match(canvas, /agentDockContext\.nodeIds\.slice\(0, CANVAS_AGENT_DOCK_MAX_REFERENCES\)/);
  assert.match(canvas, /\.slice\(0, CANVAS_AGENT_DOCK_MAX_REFERENCES\),\s*\n\s*\[agentDockContext\.nodeIds, document\],/);
  assert.doesNotMatch(canvas, /agentDockContext[\s\S]{0,60}?\.slice\(0, 8\)/);
  // @ 编号和真正发出去的引用共用一份夹过上限的列表。
  assert.match(component, /orderByReferenceIds\(references, chipOrder, referenceOrderKey\) : references\)\.slice\(\s*\n\s*0,\s*\n\s*CANVAS_AGENT_DOCK_MAX_REFERENCES,/);
  assert.match(component, /引用最多带 \$\{CANVAS_AGENT_DOCK_MAX_REFERENCES\} 个/);
});

test("a failed agent turn explains itself and can be retried", () => {
  // 原文（Failed to fetch / 401 / 超时…）对用户没有可操作性。
  assert.match(component, /function describeAgentError\(message: string, online: boolean\)/);
  assert.match(component, /网络已断开，连上后重试这一句。/);
  assert.match(component, /模型密钥无效或没配置，去设置里检查模型连接。/);
  assert.match(component, /模型服务暂时不可用/);
  assert.match(component, /const friendly = describeAgentError\(message, typeof navigator === "undefined" \? true : navigator\.onLine\);/);
  assert.match(component, /notify\(friendly, "error"\);/);
  // 重试要用用户原话，不用重新打字；刷新后也要还在。
  assert.match(component, /const lastUserTextRef = useRef\(""\);/);
  assert.match(component, /lastUserTextRef\.current = text;/);
  assert.match(component, /retryText: lastUserTextRef\.current,/);
  assert.match(component, /message\.error && message\.retryText \? \(\s*\n\s*<button type="button" disabled=\{busy\} onClick=\{\(\) => void send\(message\.retryText\)\}>/);
  assert.match(component, /\.\.\.\(message\.retryText \? \{ retryText: String\(message\.retryText\) \} : \{\}\),/);
});

test("the dock stops announcing every streamed token to screen readers", () => {
  assert.match(component, /aria-live=\{busy \? "off" : "polite"\}/);
  assert.match(component, /role="log"/);
});

test("the dock keeps a long conversation readable", () => {
  // 之前每次 messages/streamText 变化都无条件跳到底部：上滑看历史会被拽回去。
  assert.match(component, /const trackLogScroll = useCallback\(\(\) => \{/);
  assert.match(component, /stickToBottomRef\.current = next;/);
  assert.match(component, /if \(node && stickToBottomRef\.current\) node\.scrollTop = node\.scrollHeight;/);
  assert.match(component, /onScroll=\{trackLogScroll\}/);
  assert.match(component, /className="canvas-agent-dock-jump"/);
  assert.match(component, /onClick=\{jumpToBottom\} aria-label="回到最新消息"/);
  assert.match(styles, /\.canvas-agent-dock-log\{flex:1;min-height:0;overflow:auto;/);
  // sticky 而不是 absolute：滚动容器里的 absolute 会跟着内容一起滚走。
  assert.match(styles, /\.canvas-agent-dock-jump\{position:sticky;bottom:4px;align-self:flex-end/);
  // 几千字的回复默认折叠，展开按钮给全文入口；折叠不动真实内容。
  assert.match(component, /const MESSAGE_COLLAPSE_CHARS = 900;/);
  assert.match(component, /const collapsedMessages = useMemo\(\(\) => \{/);
  assert.match(component, /collapsedMessages\.has\(message\.id\) \? messagePreview\(message\.content\) : message\.content/);
  assert.match(component, /function messagePreview\(content: string\)/);
  assert.match(component, /展开全文（\$\{message\.content\.length\.toLocaleString\(\)\} 字）/);
  assert.match(styles, /\.canvas-agent-dock-more\{justify-self:start/);
});

test("a turn can be re-run, continued or stopped from the keyboard", () => {
  // 答偏了只能重新打字太笨，所以给重新生成；停止时已经流回来的半截要留下才能续写。
  assert.match(component, /const regenerate = useCallback\(/);
  assert.match(component, /void send\(messages\[cursor\]\.content, \{ fromMessageId: messages\[cursor\]\.id \}\)/);
  assert.match(component, /const base = fromMessageId/);
  assert.match(component, /async \(raw\?: string, options: \{ fromMessageId\?: string \} = \{\}\) => \{/);
  assert.match(component, /const partial = streamTextRef\.current\.trim\(\);/);
  assert.match(component, /\{ id: createId\(\), role: "assistant", content: partial, interrupted: true \}/);
  assert.match(component, /已经流回来的那半截是继续写的上下文/);
  assert.match(component, /message\.interrupted && message\.id === lastAssistantId/);
  assert.match(component, /onClick=\{\(\) => void send\("继续"\)\}/);
  // Markdown 渲染后一段消息会有多个块，所以「已停止」是元素而不是 p::after。
  assert.ok(component.includes('<span className="canvas-agent-dock-stopped">（已停止）</span>'));
  assert.match(styles, /\.canvas-agent-dock-stopped\{color:var\(--muted\)/);
  // 停止也要能用键盘：Esc。
  assert.match(component, /if \(event\.key === "Escape" && busy\) \{/);
  assert.match(component, /生成中按 Esc 停止/);
  // 新建对话会清掉整段记录，先问一句。
  assert.match(component, /!window\.confirm\("清空当前对话？画布内容不受影响。"\)/);
  // 历史消息里的 @1 落成名字，回看不歧义。
  assert.match(component, /function labelReferenceMentions\(text: string, references: readonly CanvasAgentDockReference\[\]\)/);
  assert.match(component, /content: labelReferenceMentions\(text, orderedReferences\),/);
  // 上下文条数上限要对用户可见，而不是只写给模型。
  assert.match(component, /节点信息最多带 \$\{CANVAS_AGENT_DOCK_CONTEXT_MAX_NODES\} 个/);
});
test("the dock keeps reporting a run and previews its images", () => {
  // 收起面板不等于停：rail 和工具栏都要显示「生成中」。
  assert.match(component, /canvas-agent-dock-rail\$\{busy \? " is-busy" : ""\}/);
  assert.match(component, /<em>\{busy \? "生成中" : status\.failed \? `\$\{status\.failed\} 个失败` : unreadReply \? "有新回答" : "Agent"\}<\/em>/);
  assert.match(component, /onBusyChange\?\.\(busy\);/);
  assert.match(canvas, /onBusyChange=\{setAgentDockBusy\}/);
  assert.match(canvas, /const \[agentDockBusy, setAgentDockBusy\] = useState\(false\)/);
  assert.match(canvas, /canvas-agent-button \$\{agentDockOpen \? "active" : ""\}\$\{agentDockBusy \? " is-busy" : ""\}/);
  assert.match(styles, /\.canvas-agent-dock-rail\.is-busy span,\.canvas-agent-button\.is-busy i\{animation:canvas-pulse/);
  // 停止留下的半截要能撑过刷新，否则「继续」和「（已停止）」都会丢。
  assert.ok(component.includes("...(message.interrupted ? { interrupted: true } : {}),"));
  // Agent 返回的图点开用画布同一套预览器（挂在画布层，和节点预览是同一个），面板不自己再造一个。
  assert.match(component, /className="canvas-agent-dock-media-item"/);
  assert.match(component, /onClick=\{\(\) => onPreviewImages\(message\.images \|\| \[\], index\)\}/);
  assert.match(component, /onPreviewImages: \(images: Array<\{ url: string; revisedPrompt\?: string \}>, index: number\) => void;/);
  assert.doesNotMatch(component, /MediaViewer/);
  assert.match(canvas, /onPreviewImages=\{\(images, index\) => setAgentDockPreview\(\{ images, index \}\)\}/);
  assert.match(canvas, /const \[agentDockPreview, setAgentDockPreview\] = useState<\{/);
  assert.match(styles, /\.canvas-agent-dock-media-item\{display:block;width:100%;/);
  // 生成中按回车不再无声无息。
  assert.ok(component.includes('if (busy) notify("Agent 正在生成，按 Esc 可以停止当前回答");'));
});

test("replies render as markdown and a long run streams in one frame", () => {
  // 回复里的标题、粗体、列表、代码块要按结构显示，而不是把 ## 和 ** 原样摊开。
  assert.match(component, /<AgentMarkdown/);
  assert.match(component, /onCopyCode=\{copyMessage\}/);
  assert.match(markdown, /export function parseAgentMarkdown\(value: string\)/);
  assert.ok(markdown.includes("className=\"canvas-agent-dock-code\""));
  assert.match(markdown, /onClick=\{\(\) => onCopyCode\(block\.code\)\}/);
  // 只渲染 React 元素，绝不注入 HTML；模型给的链接也只放行安全协议。
  assert.ok(!markdown.includes("dangerouslySetInnerHTML"));
  assert.match(markdown, /const SAFE_LINK_PATTERN = \/\^\(\?:https\?:/);
  assert.match(styles, /\.canvas-agent-dock-code pre\{margin:0;padding:8px 9px\}/);
  // 用户自己打的那句照原样显示，不做 Markdown 解释（渲染层可以是纯 <p>，也可以是透传文本的 SkillInlineText）。
  assert.match(component, /\) : \(\r?\n\s+(?:<p>\{message\.content\}<\/p>|<SkillInlineText text=\{message\.content\} \/>)/);
  // 流式文本按帧合并，长回复不再一个 token 一次重排；收尾时把挂起的帧取消。
  assert.match(component, /streamFrameRef\.current = window\.requestAnimationFrame/);
  assert.match(component, /window\.cancelAnimationFrame\(streamFrameRef\.current\)/);
  // 自己那条提问可以改完再问一次：发送时从那一轮重新开始。
  assert.match(component, /const beginEditMessage = useCallback\(/);
  assert.match(component, /const cancelEditMessage = useCallback\(\(\) => \{/);
  assert.ok(component.includes("setInput(inputBeforeEditRef.current);"));
  assert.match(component, /const fromMessageId = options\.fromMessageId \?\? editingMessageId \?\? undefined;/);
  assert.ok(component.includes("正在编辑这条提问 · 发送后会替换它之后的回答"));
  assert.match(styles, /\.canvas-agent-dock-editing\{display:flex;align-items:center/);
});

test("the dock header drills from the canvas task counts to the real nodes", () => {
  // 画布上的「进行中 / 失败」不只是数字：点一下就把选中和视口拉过去。
  assert.match(context, /activeIds: string\[\];/);
  assert.match(context, /failedIds: string\[\];/);
  assert.match(context, /status\.activeIds\.push\(node\.id\);/);
  assert.match(context, /status\.failedIds\.push\(node\.id\);/);
  assert.match(component, /className="canvas-agent-dock-head-task"/);
  assert.match(component, /onClick=\{\(\) => onFocusNodes\(link\.ids\)\}/);
  assert.match(styles, /\.canvas-agent-dock-head-task\{/);
  // 「排查失败」先把失败的节点选中，模型才拿得到失败原因。
  assert.match(component, /label: status\.failedIds\.length \? `排查失败（\$\{status\.failedIds\.length\}）` : "排查失败"/);
  assert.match(component, /if \(action\.ids\.length\) onFocusNodes\(action\.ids\);/);
  // 落到画布上的结果回传节点 id，消息按钮变成定位入口。
  assert.match(canvas, /return nodes\.map\(\(node\) => node\.id\);/);
  assert.match(canvas, /return \[node\.id\];/);
  assert.match(component, /imageNodeIds: appliedIds/);
  assert.match(component, /onClick=\{\(\) => onFocusNodes\(message\.imageNodeIds \|\| \[\]\)\}/);
  assert.match(component, /onClick=\{\(\) => onFocusNodes\(message\.textNodeId \? \[message\.textNodeId\] : \[\]\)\}/);
  // 刷新后这些定位入口要还在：节点 id 跟着会话一起存。
  assert.match(component, /imageNodeIds: message\.imageNodeIds\.map\(\(id\) => String\(id \|\| ""\)\)\.filter\(Boolean\)/);
  assert.match(component, /\.\.\.\(message\.textNodeId \? \{ textNodeId: String\(message\.textNodeId\) \} : \{\}\),/);
});

test("an agent image can be dragged out of the dock and dropped where the pointer is", () => {
  // 面板里的图可以直接拖到画布上落点：和拖入文件、拖入资产是同一种手感。
  assert.match(context, /export const CANVAS_AGENT_DOCK_IMAGE_DRAG_TYPE = "application\/x-sanmao-agent-image";/);
  assert.match(component, /event\.dataTransfer\.setData\(\s*CANVAS_AGENT_DOCK_IMAGE_DRAG_TYPE,/);
  assert.match(component, /draggable/);
  assert.match(canvas, /const dropAgentDockImage = useCallback\(/);
  assert.match(canvas, /dropAgentDockImage\(\s*event\.dataTransfer\.getData\(CANVAS_AGENT_DOCK_IMAGE_DRAG_TYPE\),\s*screenToWorld\(event\.clientX, event\.clientY\),\s*\);/);
  assert.match(canvas, /event\.dataTransfer\.types\.includes\(CANVAS_AGENT_DOCK_IMAGE_DRAG_TYPE\)/);
  // 拖回面板自己身上不算落点。
  assert.match(canvas, /closest\("\.canvas-agent-dock"\),/);
  assert.ok(canvas.includes("松开以把这张图放到画布上"));
  assert.ok(canvas.includes("已把这张图放到画布上"));
});

test("agent results land in free space instead of on top of existing nodes", () => {
  // 面板落画布曾经用固定偏移：选中节点右边已经有东西时，结果会直接压上去。
  const dockImages = canvas.slice(canvas.indexOf("const applyAgentDockImages = useCallback"), canvas.indexOf("const applyAgentDockText = useCallback"));
  assert.match(dockImages, /const placed: CanvasNode\[\] = \[\];/);
  assert.match(dockImages, /openNodePosition\(desired, draft, placed\)/);
  const dockText = canvas.slice(canvas.indexOf("const applyAgentDockText = useCallback"), canvas.indexOf("const addNodeReference = useCallback"));
  assert.match(dockText, /openNodePosition\(\{ x: draft\.x, y: draft\.y \}, draft\)/);
  const imageBranch = canvas.slice(canvas.indexOf("const createImageBranchFromText = useCallback"), canvas.indexOf("const createVideoBranchFromText = useCallback"));
  assert.match(imageBranch, /openNodePosition\(origin, imageNode\)/);
  const videoBranch = canvas.slice(canvas.indexOf("const createVideoBranchFromText = useCallback"), canvas.indexOf("const useAgentResponseAsImagePrompt = useCallback"));
  assert.match(videoBranch, /openNodePosition\(origin, videoNode\)/);
});

test("the collapsed rail reports the failed nodes on the canvas", () => {
  // 收起后只剩一枚 rail：画布上有失败时它要看得出来，否则用户以为一切正常。
  assert.match(component, /\$\{!busy && status\.failed \? " is-failed" : ""\}/);
  assert.match(component, /画布上有 \$\{status\.failed\} 个失败节点，点开面板定位/);
  assert.match(styles, /\.canvas-agent-dock-rail\.is-failed\{[^}]*var\(--danger\)/);
});

test("the canvas hands a selection to the dock with one click", () => {
  // 画布一侧的入口：选中节点后直接开面板并聚焦输入框，选中内容自动成为上下文。
  assert.match(canvas, /const askAgentAboutSelection = useCallback\(\(\) => \{/);
  assert.ok(canvas.includes('notify("先在画布上选中要对 Agent 说的节点", "error")'));
  assert.match(canvas, /applyAgentDockOpen\(true\);\s*\r?\n    setAgentDockFocusSignal\(\(value\) => value \+ 1\);/);
  // 单节点快捷工具栏和多选工具条都接这个入口。
  assert.match(canvas, /id: "ask-agent",[\s\S]{0,140}?label: "问 Agent",/);
  assert.match(canvas, /icon: "agent",/);
  assert.match(canvas, /case "agent":/);
  assert.ok(canvas.includes('title="打开 Agent 助手，用这些选中节点作为上下文"'));
  // 信号传给面板：展开后光标落在输入框里，不用再点一次。
  assert.match(canvas, /focusSignal=\{agentDockFocusSignal\}/);
  assert.match(component, /focusSignal\?: number;/);
  assert.match(component, /if \(!open \|\| !focusSignal\) return;\s*\r?\n    focusEditorEnd\(\);/);
});

test("the blank canvas and the keyboard can hand the whole canvas to the dock", () => {
  // 右键空白处没有可选的节点，不能沿用“先选中”的入口：整张画布就是上下文。
  assert.match(canvas, /const askAgentAboutCanvas = useCallback\(\(\) => \{\s*\r?\n    applyAgentDockOpen\(true\);/);
  assert.doesNotMatch(canvas, /const askAgentAboutCanvas = useCallback\(\(\) => \{[\s\S]{0,200}?notify\(/);
  assert.ok(canvas.includes("canvas-menu-item canvas-menu-item-agent"));
  // 「画布操作」菜单是紧凑列表：不加描述行，也不多加分隔线。
  const toolsStart = canvas.indexOf('ariaLabel="画布操作菜单"');
  const toolsMenu = canvas.slice(toolsStart, canvas.indexOf("</CanvasContextMenuFrame>", toolsStart));
  assert.ok(toolsMenu.includes("<b>问 Agent</b>"));
  assert.ok(toolsMenu.includes("Ctrl/Cmd + K"));
  // 菜单项和快捷键共用这条入口：从哪进去，面板的状态都一样。
  assert.match(canvas, /\} else if \(!event\.repeat && modifier && key === "k"\) \{\s*\r?\n[\s\S]{0,160}?askAgentAboutCanvas\(\);/);
  assert.match(canvas, /\{ keys: \["Ctrl", "K"\], label: "打开 Agent 助手并聚焦输入框，选中的节点会作为上下文" \},/);
  assert.match(canvas, /aria-keyshortcuts="Control\+K"/);
});

test("quick questions about the selection are only offered when there is a selection", () => {
  // 没选中节点时问“总结选中”，模型只能回一句“看不到选中对象”，所以先置灰。
  assert.match(component, /const needsSelection = selectedNodeTotal === 0;/);
  assert.match(component, /disabled: needsSelection/);
  assert.match(component, /disabled=\{busy \|\| action\.disabled\}/);
  assert.match(component, /title=\{action\.title\}/);
  // 空选中区要说清“没有选中时 Agent 读整张画布”。
  assert.ok(component.includes("没有选中时，Agent 读整张画布的概况。"));
});
test("a reply that lands while the dock is collapsed lights up the rail", () => {
  // 收起面板不等于看不到结果：这一轮跑完要在 rail 上留个提示。
  assert.match(component, /const \[unreadReply, setUnreadReply\] = useState\(false\)/);
  assert.match(component, /\$\{!busy && !status\.failed && unreadReply \? " is-unread" : ""\}/);
  assert.match(component, /if \(!openRef\.current\) setUnreadReply\(true\);/);
  assert.match(component, /openRef\.current = open;/);
  assert.ok(component.includes("Agent 答完了，点开面板看新回答"));
  assert.ok(component.includes("Agent 有新回答，展开面板查看"));
  assert.ok(component.includes("画布上有 ${status.failed} 个失败节点，展开面板定位"));
  assert.match(styles, /\.canvas-agent-dock-rail\.is-unread\{/);
});

test("the dock names the web modes the way the rest of the app does", async () => {
  // 同一件事在主对话页、节点参数面板和面板里必须是同一个说法。
  assert.ok(component.includes('off: "关闭联网"'));
  assert.ok(component.includes('auto: "智能联网"'));
  assert.ok(component.includes('always: "始终联网"'));
  assert.doesNotMatch(component, /按需联网|总是联网|不联网/);
  // 这枚按钮是循环切换：提示要写清当前状态，并预告下一档。
  assert.match(component, /const WEB_MODE_ORDER: AgentWebMode\[\] = \["off", "auto", "always"\];/);
  assert.ok(component.includes("title={`联网：${WEB_MODE_LABELS[webMode]}"));
  assert.ok(component.includes("aria-label={`联网模式：${WEB_MODE_LABELS[webMode]}`}"));
  assert.match(styles, /\.canvas-agent-dock-web\.always:not\(:disabled\)\{/);
  const params = await readFile(new URL("../components/CreationParameterEditor.tsx", import.meta.url), "utf8");
  assert.ok(params.includes('label: "智能联网"'));
});

test("focusing a node keeps it clear of the open agent panel", () => {
  // 面板是右侧浮层：定位节点、落下结果、适应视图都要按面板左边那块可见区域取景，否则有半边藏在面板后面。
  assert.match(canvas, /function canvasRightOverlayInset\(stage: HTMLElement \| null\) \{/);
  assert.ok(canvas.includes('window.document.querySelector(".canvas-agent-dock")'));
  // 默认值就是面板当前占位：所有取景入口都自动让位，不会漏掉哪一处。
  assert.ok(canvas.includes("(ids?: string[], rightInset = canvasRightOverlayInset(stageRef.current)) => {"));
  assert.match(canvas, /const viewWidth = width - Math\.min\(Math\.max\(rightInset, 0\), Math\.max\(0, width - 240\)\);/);
  assert.match(canvas, /camera: \{ x: viewWidth \/ 2, y: height \/ 2, zoom: 1 \}/);
  assert.match(canvas, /x: viewWidth \/ 2 - \(minX \+ \(maxX - minX\) \/ 2\) \* zoom,/);
  assert.doesNotMatch(canvas, /agentDockRightInset/);
  // 窄屏下面板是横在底部的一条，它没占右半边时不该让位。
  assert.match(canvas, /if \(rect\.width <= 0 \|\| rect\.left <= stageRect\.left \+ stageRect\.width \/ 2\) return 0;/);
});

test("canvas overlays step aside for the open agent panel", () => {
  // 节点工具栏和参数面板同样是右侧浮层：面板打开时要贴到面板左边，别被压在面板下面。
  assert.match(canvas, /function canvasVisibleStageWidth\(stage: HTMLElement \| null\) \{/);
  assert.match(canvas, /const inset = Math\.min\(canvasRightOverlayInset\(stage\), Math\.max\(0, width - 240\)\);/);
  assert.ok(canvas.includes("const placementStage = { ...stageSize, width: canvasVisibleStageWidth(stage) };"));
  assert.match(canvas, /placeCanvasGroupToolbar\(anchor, placementStage, overlay, 10\)/);
  assert.match(canvas, /placeCanvasNodeToolbar\(anchor, placementStage, overlay, 10\)/);
  assert.match(canvas, /\{ width: canvasVisibleStageWidth\(stage\), height: stageHeight \},/);
});

test("storing a reply as a node brings it into view", () => {
  // 「存为节点」把回复放在选中节点右侧：不把视图挪过去，新节点就藏在面板后面。
  const dockText = canvas.slice(canvas.indexOf("const applyAgentDockText = useCallback"), canvas.indexOf("const addNodeReference = useCallback"));
  assert.match(dockText, /fitView\(\[node\.id\]\);/);
  assert.match(dockText, /^\s*fitView,$/m);
});
