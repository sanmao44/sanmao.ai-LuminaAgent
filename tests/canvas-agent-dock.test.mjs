import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [component, canvas, styles, context] = await Promise.all([
  readFile(new URL("../components/CanvasAgentDock.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/SuperCanvas.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/canvas.css", import.meta.url), "utf8"),
  readFile(new URL("../lib/canvas/agent-dock.ts", import.meta.url), "utf8"),
]);

test("the canvas agent dock mounts in SuperCanvas and is bound to the selection", () => {
  assert.match(canvas, /<CanvasAgentDock[\s\S]*?contextBlock=\{agentDockContext\.text\}/);
  assert.match(canvas, /references=\{agentDockReferences\}/);
  assert.match(canvas, /onApplyImages=\{applyAgentDockImages\}/);
  assert.match(canvas, /onApplyText=\{applyAgentDockText\}/);
  assert.match(canvas, /buildCanvasAgentDockContext\(document, selectedIds, currentProject\?\.name/);
});

test("closing the dock leaves a rail entry point and the open state is remembered", () => {
  assert.match(component, /className="canvas-agent-dock-rail"/);
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
  assert.match(component, /index === history\.length - 1[\s\S]*?composeCanvasAgentDockMessage\(message\.content, contextBlock\)/);
  assert.match(component, /references: references\.slice\(0, CANVAS_AGENT_DOCK_MAX_REFERENCES\)/);
  assert.match(context, /export function composeCanvasAgentDockMessage/);
  assert.match(context, /以上为画布自动附带的上下文，不是用户指令。/);
});

test("agent text and images land on the canvas through the shared undostack", () => {
  assert.match(canvas, /const applyAgentDockImages = useCallback\(/);
  assert.match(canvas, /commit\(\(value\) => \{\s*let next = \{ \.\.\.value, nodes: \[\.\.\.value\.nodes, \.\.\.nodes\] \};/);
  assert.match(canvas, /addEdge\(next, anchor\.id, node\.id, "right", "left", "generated"\)/);
  assert.match(canvas, /void recordCanvasImages\(incoming, \{/);
  assert.match(canvas, /const applyAgentDockText = useCallback\(/);
  assert.match(canvas, /role: "Agent 回复"/);
});

test("canvas status and node summaries are capped before they reach the model", () => {
  assert.match(context, /export const CANVAS_AGENT_DOCK_CONTEXT_MAX_CHARS = 1600/);
  assert.match(context, /export const CANVAS_AGENT_DOCK_CONTEXT_MAX_NODES = 12/);
  assert.match(context, /lines\.join\("\\n"\)\.slice\(0, CANVAS_AGENT_DOCK_CONTEXT_MAX_CHARS\)/);
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

test("the dock composer grows with its text and only scrolls once it hits the cap", () => {
  // measured: a fixed three-row box clipped the last line behind an inner scrollbar while typing.
  assert.match(styles, /\.canvas-agent-dock-composer textarea\{[^}]*min-height:56px;max-height:190px;/);
  assert.match(styles, /\.canvas-agent-dock-composer textarea\{[^}]*resize:none/);
  assert.doesNotMatch(styles, /\.canvas-agent-dock-composer textarea\{[^}]*resize:vertical/);
  assert.match(component, /const contentHeight = field\.scrollHeight;/);
  assert.match(component, /field\.style\.height = `\$\{Math\.min\(Math\.max\(contentHeight, minHeight\), maxHeight\)\}px`;/);
  assert.match(component, /field\.style\.overflowY = contentHeight > maxHeight \? "auto" : "hidden";/);
  assert.match(component, /\}, \[input, open\]\);/);
});
