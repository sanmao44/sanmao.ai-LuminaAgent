import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/agent-upgrades.css", import.meta.url), "utf8");

test("生图等待卡片在整轮出图期间保持挂载", () => {
  assert.ok(page.includes("function showAgentImageLoadingCard(message) {"));
  assert.ok(page.includes("if (!message || (!message.pending && !message.retrying)) return false;"));
  assert.ok(page.includes("if (activity.imageFlow === true) return true;"));
  assert.ok(page.includes("return /^(?:image|caption)/.test(String(activity.stage || ''));"));
  assert.ok(page.includes("showAgentImageLoadingCard(message) ? /*#__PURE__*/ _jsx(AgentImageLoadingCard, {"));
  assert.equal(
    page.includes("message.pending && /^(?:image_|caption)/.test(message.activity?.stage || '')"),
    false,
    "旧的仅按 image_/caption 阶段渲染的判定应当被 showAgentImageLoadingCard 取代",
  );
});

test("生图请求在发起与进度刷新时都带 imageFlow 标记，且只在正文未输出时保留", () => {
  assert.ok(page.includes("activity: likelyImageRequest ? { stage: 'image_planning', message: '正在构思画面…', imageFlow: true }"));
  assert.ok(page.includes("...(likelyImageRequest && !agentRequest.partialText ? { imageFlow: true } : {})"));
});

test("正文开始流式输出后卡片立刻让位", () => {
  assert.ok(page.includes("updatePendingMessage({ content: nextContent, activity: undefined });"));
  assert.ok(page.includes("...(item.activity ? { activity: { ...item.activity, imageFlow: false } } : {})"));
});

test("重新生成生图消息同样从头显示扫光卡片", () => {
  assert.ok(page.includes("const retryImageFlow = message.deliverable === 'IMAGE' || message.deliverable === 'BOTH';"));
  assert.ok(page.includes("...(retryImageFlow ? { activity: { stage: 'image_planning', message: '正在构思画面…', imageFlow: true } } : {})"));
  assert.ok(page.includes("...(retryImageFlow && !agentRequest.partialText ? { imageFlow: true } : {})"));
  assert.ok(page.includes("retryActivity: message.retrying && !showAgentImageLoadingCard(message) ? message.activity?.message : undefined"));
});

test("卡片文案按生图阶段分三态，服务端阶段文案退到第二行", () => {
  assert.ok(page.includes("const imageGenerating = stage === 'image' || stage === 'image_generating';"));
  assert.ok(page.includes("const message = stage === 'caption' ? '图片已生成，正在整理创作建议…' : imageGenerating ? '正在生成图片…' : '正在构思画面…';"));
  assert.ok(page.includes("const note = details || (activity?.message && activity.message !== message ? activity.message : stage === 'caption' ? '马上展示图片与创作建议' : '正在处理本次创作请求');"));
  assert.ok(page.includes('/*#__PURE__*/ _jsx("small", { children: note })'));
});

test("输入区状态条与卡片文案保持一致", () => {
  assert.ok(page.includes("const imaging = activity.imageFlow === true || imageGenerating || activity.stage === 'image_planning';"));
  assert.ok(page.includes("title: imageGenerating ? '正在生成图片' : imaging ? '正在构思画面' : '正在思考',"));
});

test("扫光与骨架动画保持无限循环，不被长任务等到结束", () => {
  assert.match(css, /animation:agent-image-scan 2\.4s ease-in-out infinite/);
  assert.match(css, /animation:agent-image-shimmer 1\.8s linear infinite/);
  assert.match(css, /@keyframes agent-image-scan\{/);
  assert.match(css, /@keyframes agent-image-shimmer\{/);
});
