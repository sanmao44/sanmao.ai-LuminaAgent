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
  assert.match(styles, /\.canvas-agent-dock\{[^}]*position:fixed[^}]*right:18px[^}]*top:86px/);
  assert.match(styles, /\.canvas-agent-dock-rail\{[^}]*position:fixed[^}]*right:18px/);
  assert.match(styles, /\.canvas-workspace:has\(\.canvas-agent-dock\) \.canvas-deck:not\(\.collapsed\)\{left:calc\(50% - 200px\)/);
  assert.match(styles, /\.canvas-workspace:has\(\.canvas-asset-drawer\) \.canvas-agent-dock\{right:434px\}/);
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
  assert.match(component, /canvas-agent-dock-head-actions[\s\S]*?<SkillManager disabled=\{busy\} icon=\{<span aria-hidden="true">★<\/span>\} \/>/);
  assert.match(styles, /\.canvas-agent-dock-head-actions>button\[data-tooltip\]::after\{left:auto;right:0;top:calc\(100% \+ 8px\)/);
});

test("dock toolbar button sizing never leaks into the skill dialog", () => {
  assert.doesNotMatch(styles, /\.canvas-agent-dock-head-actions button/);
});

test("opening the dock never shifts the compact canvas topbar", () => {
  assert.doesNotMatch(styles, /with-agent-dock/);
  assert.doesNotMatch(canvas, /with-agent-dock/);
  assert.match(styles, /\.canvas-topbar-main\{width:max-content;max-width:min\(1360px,calc\(100% - 28px\)\)/);
});

test("the dock composer calls the shared skill picker with slash and a toolbar button", () => {
  assert.match(component, /import AgentSkillMenu from "@\/components\/AgentSkillMenu";/);
  assert.match(component, /const slashQuery = skillSlashQuery\(value\);/);
  assert.match(component, /className=\{`canvas-agent-dock-skill \$\{skillMenuOpen \? "is-active" : ""\}`\}/);
  assert.match(component, /setInput\(\(value\) => skillMessageValue\(value, skill\.name\)\)/);
  assert.match(component, /<AgentSkillMenu[\s\S]*?emptyHint="还没有启用中的技能。点右上角的 ★ 可以安装或启用。"/);
  assert.match(styles, /\.canvas-agent-dock-skill\{/);
  assert.match(styles, /\.canvas-agent-dock-composer \.agent-skill-menu\{/);
});
