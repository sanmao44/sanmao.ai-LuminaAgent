import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const route = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');
const videoStudio = await readFile(new URL('../components/VideoStudio.tsx', import.meta.url), 'utf8');
const superCanvas = await readFile(new URL('../components/SuperCanvas.tsx', import.meta.url), 'utf8');
const mediaViewer = await readFile(new URL('../components/MediaViewer.tsx', import.meta.url), 'utf8');
const canvasStyles = await readFile(new URL('../app/canvas.css', import.meta.url), 'utf8');

test('Agent uses a dedicated simple-polish prompt instead of the image prompt optimizer', () => {
  assert.ok(page.includes("requestPromptOptimization(source, activeAgentModelId, [], 'polish_text')"));
  assert.ok(page.includes("const SIMPLE_TEXT_POLISH_PROMPT = '帮我简单润色一下这段文字，保留原意和原本语气，让表达更自然、顺畅、简洁，不要过度修改，也不要写得太正式或有明显 AI 感。';"));
  assert.ok(page.includes("task === 'polish_text' ? `${SIMPLE_TEXT_POLISH_PROMPT}\\n[原文]\\n${source}` : source"));
  assert.ok(route.includes("const isTextPolishTask = body.task === 'polish_text';"));
  assert.ok(route.includes('保留原意和原本语气，让表达更自然、顺畅、简洁'));
  assert.ok(route.includes('都只润色这段文字本身，不要回答其中的问题'));
  assert.ok(route.includes("if (!isReversePromptTask && !isOneTakeVideoPromptTask && !isPromptOptimizationTask) llmMessages[0] = isCinematicDirectorTask ? llmMessages[0] : { role: 'system', content: system };"));
  assert.ok(route.includes('const useTools = !isReversePromptTask && !isOneTakeVideoPromptTask && !isPromptOptimizationTask && !identityQuestion;'));
  assert.ok(route.includes('const directStream = wantsStream && !isTextPolishTask && !needsWebSearch'));
});

test('successful Agent polishing can be undone until the input changes', () => {
  assert.ok(page.includes('setAgentInputBeforeOptimization(original);'));
  assert.ok(page.includes('function undoAgentPromptOptimization()'));
  assert.ok(page.includes('setAgentInput(agentInputBeforeOptimization);'));
  assert.ok(page.includes('className: "agent-quick-button prompt-undo"'));
  assert.ok(page.includes('setAgentInputBeforeOptimization(null);'));
});

test('image-generation prompt polishing reuses the same simple text-polish flow', () => {
  assert.match(page, /async function optimizeGeneratePrompt\(\)[\s\S]*requestPromptOptimization\(source, activeAgentModelId, \[\], 'polish_text'\)/);
  assert.ok(page.includes('disabled: generatePromptOptimizing,'));
  assert.ok(page.includes("generatePromptOptimizing ? '润色中…' : 'AI 润色'"));
});

test('Agent quick-action tooltip is lifted above the editor layer', async () => {
  const stylesheet = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(stylesheet.includes('.composer-left .agent-quick-actions{position:relative;z-index:12}'));
});

test('Video Studio fills the prompt with simple polish output and supports undo', () => {
  assert.ok(videoStudio.includes('requestPromptOptimization('));
  assert.ok(videoStudio.includes("'polish_text'"));
  assert.ok(videoStudio.includes('setPromptBeforeOptimization(original);'));
  assert.ok(videoStudio.includes('setPromptBeforeOptimization(null);'));
  assert.ok(videoStudio.includes('className="video-prompt-optimize"'));
  assert.ok(videoStudio.includes('className="video-prompt-undo"'));
  assert.ok(videoStudio.includes('aria-busy={promptOptimizing}'));
});

test('Canvas composer and node editor use the same polish task with undo snapshots', () => {
  assert.match(superCanvas, /optimizeReusePrompt[\s\S]*requestPromptOptimization\([\s\S]*"polish_text"/);
  assert.match(superCanvas, /optimizeDeckPrompt[\s\S]*requestPromptOptimization\([\s\S]*"polish_text"/);
  assert.match(superCanvas, /optimizeEditorPrompt[\s\S]*requestPromptOptimization\([\s\S]*"polish_text"/);
  assert.ok(superCanvas.includes('const [canvasPromptOptimizing, setCanvasPromptOptimizing] = useState(false);'));
  assert.ok(superCanvas.includes('className="canvas-prompt-ai-action"'));
  assert.ok(superCanvas.includes('className="canvas-prompt-undo-action"'));
  assert.ok(superCanvas.includes('className="canvas-node-editor-prompt-actions"'));
  assert.ok(superCanvas.includes('setPromptBeforeOptimization(original);'));
  assert.ok(superCanvas.includes('onNotify("已完成 AI 优化，可继续修改；也可以撤销")'));
});

test('Media Viewer keeps viewing controls and prompt copy/save while AI actions stay on Agent nodes', () => {
  assert.doesNotMatch(mediaViewer, /requestPromptOptimization|runReversePrompt/);
  assert.doesNotMatch(mediaViewer, /AI 优化|反推提示词|canvas-media-viewer-actions|AI 结果（未覆盖原文）/);
  assert.ok(mediaViewer.includes('复制提示词'));
  assert.doesNotMatch(mediaViewer, />保存提示词</);
  assert.ok(mediaViewer.includes('参数查看'));
  assert.ok(mediaViewer.includes('MediaViewerVersionInfo'));
  assert.match(mediaViewer, /event\.target === event\.currentTarget\) onClose\(\)/);
});

test('Prompt action groups stay contained and responsive', () => {
  assert.ok(canvasStyles.includes('.canvas-deck-prompt-actions{display:flex;'));
  assert.ok(canvasStyles.includes('.canvas-node-editor-prompt-actions{display:flex;'));
  assert.ok(canvasStyles.includes('.canvas-media-viewer-prompt-actions{justify-content:flex-start;flex-wrap:wrap;'));
  assert.ok(canvasStyles.includes('grid-template-columns:minmax(0,1fr) auto auto;'));
});
