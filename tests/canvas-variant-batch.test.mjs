import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../lib/canvas/variant-batch.ts", import.meta.url);
const source = (await readFile(sourceUrl, "utf8"))
  .replace(/^import type \{[^}]+\} from "\.\/types";\r?\n/m, "")
  .replace(/^import \{ canvasVariantBatchStatus \} from "\.\/variant-status";\r?\n/m, `
function canvasVariantBatchStatus(states) {
  if (states.some((state) => state.status === "running")) return "running";
  if (states.some((state) => state.status === "failed")) return "failed";
  if (states.length && states.every((state) => state.status === "completed")) return "completed";
  return "queued";
}
`);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const batch = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("patches one variant while preserving its canonical requirement and aggregate status", () => {
  const result = batch.applyCanvasVariantStatePatch(
    [
      { id: "variant-1", instruction: "old", status: "pending", resultIds: [] },
      { id: "variant-2", instruction: "old 2", status: "completed", resultIds: ["image-2"] },
    ],
    ["canonical one", "canonical two"],
    0,
    { status: "failed", error: "provider error" },
    123,
  );

  assert.deepEqual(result.states, [
    {
      id: "variant-1",
      instruction: "canonical one",
      status: "failed",
      resultIds: [],
      error: "provider error",
      updatedAt: 123,
    },
    { id: "variant-2", instruction: "old 2", status: "completed", resultIds: ["image-2"] },
  ]);
  assert.equal(result.status, "failed");
});

test("normalizes pending, failed, done, and returned video task results", () => {
  assert.deepEqual(batch.canvasVideoTaskProgress({ status: "processing", progress: 42 }), {
    hasVideoResult: false,
    terminal: false,
    status: "running",
    progress: 42,
    url: undefined,
  });
  assert.deepEqual(batch.canvasVideoTaskProgress({ status: "failed", error: "provider" }), {
    hasVideoResult: false,
    terminal: true,
    status: "failed",
    progress: 0,
    url: undefined,
  });
  assert.deepEqual(batch.canvasVideoTaskProgress({ status: "done", videoUrls: ["/video.mp4"] }), {
    hasVideoResult: true,
    terminal: true,
    status: "completed",
    progress: 100,
    url: "/video.mp4",
  });
});

test("projects a submitted variant video task into stable node metadata", () => {
  const params = { kind: "video", model: "video-model", duration: 5 };
  const completed = batch.canvasVariantVideoNodeData({
    task: { id: "task-1", status: "done", progress: 100, videoUrls: ["/video.mp4"], modelId: "provider-model" },
    prompt: "cinematic scene",
    params,
    linkedIds: ["image-1", "prompt-1"],
    sourceGeneratorId: "generator-1",
    variantBatchId: "batch-1",
    variantIndex: 2,
    variantInstruction: "wide shot",
    generationStartedAt: 1000,
    now: 1450,
  });

  assert.deepEqual(completed, {
    role: "变体结果",
    model: "provider-model",
    jobId: "task-1",
    status: "completed",
    processingStartedAt: undefined,
    progress: 100,
    statusLabel: "视频已完成",
    generation: {
      kind: "video",
      prompt: "cinematic scene",
      params,
      referenceIds: ["image-1", "prompt-1"],
      sourceGeneratorId: "generator-1",
      variantBatchId: "batch-1",
      variantIndex: 2,
      variantInstruction: "wide shot",
      taskId: "task-1",
      createdAt: 1000,
      durationMs: 450,
    },
    referenceOrder: ["image-1", "prompt-1"],
  });
});

test("keeps a pending variant video task running without duration", () => {
  const pending = batch.canvasVariantVideoNodeData({
    task: { id: "task-2", status: "queued", progress: 10 },
    prompt: "scene",
    params: { kind: "video", model: "auto", duration: 5 },
    linkedIds: [],
    sourceGeneratorId: "generator-1",
    variantBatchId: "batch-1",
    variantIndex: 0,
    variantInstruction: "close shot",
    generationStartedAt: 1000,
    now: 1100,
  });

  assert.equal(pending.status, "running");
  assert.equal(pending.processingStartedAt, 1100);
  assert.equal(pending.progress, 10);
  assert.equal(pending.generation?.durationMs, undefined);
});

test("projects a polled video task onto existing node data", () => {
  const data = batch.canvasVariantVideoTaskData(
    {
      kind: "video",
      status: "running",
      url: "",
      generation: { kind: "video", createdAt: 1000 },
    },
    { status: "done", progress: 100, videoUrls: ["/finished.mp4"] },
    1750,
  );

  assert.equal(data.status, "completed");
  assert.equal(data.progress, 100);
  assert.equal(data.url, "/finished.mp4");
  assert.equal(data.generation?.durationMs, 750);
});

test("projects image variant provenance and duration without owning node creation", () => {
  const params = { kind: "image", model: "image-model", count: 1 };
  const data = batch.canvasVariantImageNodeData({
    prompt: "portrait",
    params,
    linkedIds: ["prompt-1", "image-1"],
    sourceGeneratorId: "generator-1",
    variantBatchId: "batch-1",
    variantIndex: 1,
    variantInstruction: "soft light",
    modelName: "provider-image-model",
    generationStartedAt: 2000,
    now: 2450,
  });

  assert.deepEqual(data, {
    role: "变体结果",
    model: "provider-image-model",
    generation: {
      kind: "image",
      prompt: "portrait",
      params,
      referenceIds: ["prompt-1", "image-1"],
      sourceGeneratorId: "generator-1",
      variantBatchId: "batch-1",
      variantIndex: 1,
      variantInstruction: "soft light",
      createdAt: 2450,
      durationMs: 450,
    },
    referenceOrder: ["prompt-1", "image-1"],
  });
});

test("maps image variant settings into the existing generation request shape", () => {
  const request = batch.canvasVariantImageRequest({
    taskId: "image-task-1",
    prompt: "portrait",
    params: {
      kind: "image",
      model: "image-model",
      aspect: "鑷畾涔?",
      customAspectWidth: 7,
      customAspectHeight: 5,
      sizeMode: "custom",
      width: 1400,
      height: 1000,
      resolution: "2K",
      count: 2,
      quality: "high",
      outputFormat: "png",
      backgroundMode: "api-transparent",
      mask: { url: "/mask.png", sourceUrl: "/guide.png" },
    },
    references: [{ url: "/source.png", name: "source" }],
  });

  assert.deepEqual(request, {
    taskId: "image-task-1",
    prompt: "portrait",
    model: "image-model",
    count: 2,
    aspect: "7:5",
    resolution: "2K",
    quality: "high",
    sizeMode: "custom",
    width: 1400,
    height: 1000,
    outputFormat: "png",
    background: "transparent",
    maskUrl: "/mask.png",
    moveGuideUrl: "/guide.png",
    references: [{ url: "/source.png", name: "source" }],
  });
});

test("maps resolved video inputs into the existing generation request shape", () => {
  const request = batch.canvasVariantVideoRequest({
    prompt: "cinematic scene",
    model: "video-model",
    modelRawId: "provider-video-model",
    params: {
      kind: "video",
      model: "video-model",
      operation: "edit",
      inputMode: "frames",
      duration: 5,
      aspect: "16:9",
      resolution: "1080p",
      audio: true,
      agnesWidth: 1152,
      agnesHeight: 768,
      agnesNumFrames: 81,
      agnesFrameRate: 24,
    },
    references: [{ url: "/first.png", name: "first" }],
    referenceVideos: [{ url: "/source.mp4", name: "source" }],
    firstFrame: "/first.png",
    lastFrame: "/last.png",
    referenceVideo: "/source.mp4",
    audios: [{ url: "/audio.mp3", name: "audio" }],
  });

  assert.deepEqual(request, {
    prompt: "cinematic scene",
    model: "video-model",
    modelRawId: "provider-video-model",
    operation: "edit",
    inputMode: "frames",
    duration: 5,
    aspect: "16:9",
    resolution: "1080p",
    agnesWidth: 1152,
    agnesHeight: 768,
    agnesNumFrames: 81,
    agnesFrameRate: 24,
    references: [{ url: "/first.png", name: "first" }],
    referenceVideos: [{ url: "/source.mp4", name: "source" }],
    firstFrame: "/first.png",
    lastFrame: "/last.png",
    referenceVideo: "/source.mp4",
    audios: [{ url: "/audio.mp3", name: "audio" }],
  });
});

test("prepares only requested failed variants and preserves retry results", () => {
  const retained = { id: "variant-1", instruction: "one", status: "completed", resultIds: ["image-1"] };
  const failed = { id: "variant-2", instruction: "old", status: "failed", resultIds: ["image-2"], taskIds: ["task-2"] };
  const result = batch.prepareCanvasVariantBatch(
    ["canonical one", "canonical two", "canonical three"],
    [retained, failed],
    [1, 1, 9, -1],
    "failed",
    789,
  );

  assert.deepEqual(result.requested, [1]);
  assert.equal(result.isRetry, true);
  assert.equal(result.isResume, false);
  assert.equal(result.initialStates[0], retained);
  assert.deepEqual(result.initialStates[1], {
    id: "variant-2",
    instruction: "canonical two",
    status: "pending",
    resultIds: ["image-2"],
    taskIds: ["task-2"],
    progress: 0,
    error: undefined,
    updatedAt: 789,
  });
});

test("an all-mode batch resets outputs for every requirement", () => {
  const result = batch.prepareCanvasVariantBatch(
    ["one", "two"],
    [
      { id: "variant-1", instruction: "old", status: "completed", resultIds: ["image-1"], taskIds: ["task-1"] },
      { id: "variant-2", instruction: "old 2", status: "failed", resultIds: ["image-2"], error: "old error" },
    ],
    undefined,
    "all",
    987,
  );

  assert.deepEqual(result.requested, [0, 1]);
  assert.deepEqual(result.initialStates.map((state) => ({
    instruction: state.instruction,
    status: state.status,
    resultIds: state.resultIds,
    taskIds: state.taskIds,
    progress: state.progress,
    error: state.error,
    updatedAt: state.updatedAt,
  })), [
    { instruction: "one", status: "pending", resultIds: [], taskIds: undefined, progress: 0, error: undefined, updatedAt: 987 },
    { instruction: "two", status: "pending", resultIds: [], taskIds: undefined, progress: 0, error: undefined, updatedAt: 987 },
  ]);
});

test("returns a fresh state array and marks all completed variants as completed", () => {
  const states = [
    { id: "variant-1", instruction: "one", status: "pending", resultIds: [] },
  ];
  const result = batch.applyCanvasVariantStatePatch(
    states,
    ["one"],
    0,
    { status: "completed", progress: 100 },
    456,
  );

  assert.notEqual(result.states, states);
  assert.equal(result.states[0].status, "completed");
  assert.equal(result.states[0].progress, 100);
  assert.equal(result.status, "completed");
});
