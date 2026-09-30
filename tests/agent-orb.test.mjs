import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(
  new URL("../app/agent-orb.css", import.meta.url),
  "utf8",
);
const component = await readFile(
  new URL("../components/AgentOrb.tsx", import.meta.url),
  "utf8",
);
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const status = await readFile(new URL("../components/AgentOrbStatus.tsx", import.meta.url), "utf8");
const avatar = await readFile(new URL("../components/AgentMessageAvatar.tsx", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const dock = await readFile(
  new URL("../components/CanvasAgentDock.tsx", import.meta.url),
  "utf8",
);
const canvas = await readFile(
  new URL("../components/SuperCanvas.tsx", import.meta.url),
  "utf8",
);

test("agent orb stylesheet ships the shared state contract", () => {
  for (const state of [
    "idle",
    "connecting",
    "listening",
    "thinking",
    "speaking",
    "error",
    "disabled",
  ]) {
    assert.match(styles, new RegExp(`\\.agent-orb\\[data-state='${state}'\\]`));
  }
  assert.match(styles, /@property --aorb-halo-from/);
  assert.match(styles, /@property --aorb-halo-to/);
  assert.match(layout, /import '\.\/agent-orb\.css';/);
});

test("orb colors follow the project theme tokens", () => {
  assert.match(styles, /--aorb-color-from: var\(--accent, #6357e8\)/);
  // 第二个色相取画布同源的暖粉：亮色用 600 档，暗色主题再提亮一档。
  assert.match(styles, /--aorb-color-to: #db2777/);
  assert.match(styles, /html\[data-theme="dark"\] \.agent-orb \{[^}]*--aorb-color-to: #f472b6/);
  assert.match(
    styles,
    /\.agent-orb\[data-state='error'\] \{[^}]*var\(--danger, #c84555\)/,
  );
  assert.doesNotMatch(styles, /#818cf8|#fb7185|#f43f5e/);
});

test("orb sizing and motion follow project conventions", () => {
  assert.match(styles, /filter: blur\(calc\(var\(--aorb-size\) \* 0\.107\)\)/);
  assert.match(styles, /mask: radial-gradient\(farthest-side, transparent calc\(100% - var\(--aorb-size\)/);
  assert.match(styles, /--aorb-size: clamp\(92px, 16vh, 148px\)/);
  assert.equal(
    /prefers-reduced-motion/.test(styles),
    false,
    "project gates animation on data-motion, not the OS media query",
  );
  assert.match(styles, /html\[data-motion="off"\] \.agent-orb\[data-state='idle'\]/);
  assert.match(styles, /\.agent-orb-status \{/);
  assert.match(styles, /\.agent-orb-status\.agent-orb-status-error \{/);
});

test("orb component stays dependency free and pauses when idle", () => {
  assert.match(component, /export type AgentOrbState =/);
  assert.match(
    component,
    /export type AgentOrbState =\s*\|\s*'idle'\s*\|\s*'connecting'\s*\|\s*'listening'\s*\|\s*'thinking'\s*\|\s*'speaking'\s*\|\s*'error'\s*\|\s*'disabled';/,
  );
  assert.match(component, /IntersectionObserver/);
  assert.match(component, /visibilitychange/);
  assert.match(component, /attributeFilter: \['data-motion'\]/);
  assert.match(component, /document\.documentElement\.dataset\.motion === 'off'/);
  assert.doesNotMatch(component, /^import .* from '(?!react)/m);
});

test("assistant surfaces reuse the orb for every visible phase", async () => {
  assert.match(page, /import AgentOrb from '@\/components\/AgentOrb';/);
  const welcome = await readFile(new URL('../components/AgentWelcome.tsx', import.meta.url), 'utf8');
  assert.match(page, /const agentOrbStatus = useMemo/);
  assert.match(page, /phase: 'connecting'/);
  assert.match(page, /phase: 'thinking'/);
  assert.match(page, /phase: 'speaking'/);
  assert.match(page, /phase: 'error'/);
  assert.match(page, /import AgentOrbStatus from '@\/components\/AgentOrbStatus';/);
  assert.match(page, /import AgentMessageAvatar from '@\/components\/AgentMessageAvatar';/);
  assert.match(avatar, /message-avatar-orb/);
  assert.match(avatar, /brand-mark-welcome\.png/);
  assert.match(status, /className=\{`agent-orb-status \$\{isError \? 'agent-orb-status-error' : ''\}`\}/);
  assert.match(status, /<AgentOrb state=\{phase\} size=\{22\} label="" \/>/);
  assert.match(welcome, /className="agent-welcome-orb"/);
  assert.match(page, /\(activeAgentBusy \|\| agentOrbStatus\.phase === 'error'\) && .*AgentOrbStatus/);
  assert.match(avatar, /message-avatar-orb/);
  assert.doesNotMatch(page, /className: "hero-orb",/);
});

test("canvas agent marks reuse the live orb instead of a bare glyph", () => {
  assert.match(component, /export function busyOrbState\(/);
  assert.match(styles, /\.canvas-agent-dock-rail\.is-quiet \{/);
  assert.match(styles, /\.canvas-agent-button>\.agent-orb,/);
  assert.match(styles, /\.canvas-mode-switch button>\.agent-orb,/);
  assert.match(styles, /\.canvas-selection-toolbar button>\.agent-orb \{/);
  assert.match(styles, /\.canvas-node-kicker>span>\.agent-orb,/);
  /* 收起后的悬浮入口只留光球：没有动静时不再重复写「Agent」。 */
  assert.doesNotMatch(dock, /: "Agent"\}<\/em>/);
  assert.match(dock, /<AgentOrb state=\{dockOrbState\} size=\{30\} label="" \/>/);
  assert.match(dock, /<AgentOrb state=\{message\.error \? "error" : "idle"\} size=\{14\} label="" \/>/);
  assert.doesNotMatch(dock, /✦/);
  /* 画布顶栏、右键菜单、节点卡片都走 AgentOrb，不再自己画星星。 */
  assert.match(canvas, /import AgentOrb, \{ busyOrbState, type AgentOrbState \} from "@\/components\/AgentOrb";/);
  assert.match(canvas, /case "agent":\s*\n\s*return <AgentOrb state="idle" size=\{15\} label="" \/>;/);
  assert.match(canvas, /function canvasPromptOrbState\(status: string \| undefined\): AgentOrbState/);
  assert.match(canvas, /target\.node\.type === "prompt"\s*\n\s*\? <AgentOrb state=\{canvasPromptOrbState\(target\.node\.data\.status\)\}/);
  assert.doesNotMatch(canvas, /✦ 问 Agent|✦ Agent/);
});
