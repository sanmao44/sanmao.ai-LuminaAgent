import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

const load = createTsRequire(path.join(process.cwd(), "lib"));
const { createMedia, createPrompt } = load("./canvas/model");
const { applyCanvasMediaNaturalSizes } = load("./canvas/media-natural-size");

function documentWith(nodes) {
  return {
    version: "1",
    nodes,
    edges: [],
    groups: [],
    camera: { x: 0, y: 0, zoom: 1 },
  };
}

test("applies a frame of image measurements in one immutable document projection", () => {
  const first = createMedia("image", "/first.png", "First", { x: 0, y: 0 });
  const second = createMedia("image", "/second.png", "Second", { x: 500, y: 0 });
  const prompt = createPrompt({ x: 1000, y: 0 });
  const document = documentWith([first, second, prompt]);

  const next = applyCanvasMediaNaturalSizes(document, [
    { nodeId: first.id, sourceUrl: "/first.png", width: 1600, height: 900 },
    { nodeId: second.id, sourceUrl: "/second.png", width: 900, height: 1600 },
  ]);

  assert.notEqual(next, document);
  assert.notEqual(next.nodes, document.nodes);
  assert.equal(next.nodes[0].data.nativeWidth, 1600);
  assert.equal(next.nodes[0].data.nativeHeight, 900);
  assert.ok(Math.abs(next.nodes[0].w / (next.nodes[0].h - 48) - 16 / 9) < 0.02);
  assert.equal(next.nodes[1].data.nativeWidth, 900);
  assert.equal(next.nodes[1].data.nativeHeight, 1600);
  assert.equal(next.nodes[2], prompt);
});

test("ignores stale source loads and returns the same document when sizes are unchanged", () => {
  const image = createMedia("image", "/current.png", "Image", { x: 0, y: 0 });
  const document = documentWith([image]);

  assert.equal(applyCanvasMediaNaturalSizes(document, [
    { nodeId: image.id, sourceUrl: "/old.png", width: 900, height: 1600 },
  ]), document);
  const sized = applyCanvasMediaNaturalSizes(document, [
    { nodeId: image.id, sourceUrl: "/current.png", width: 1600, height: 900 },
  ]);
  assert.equal(applyCanvasMediaNaturalSizes(sized, [
    { nodeId: image.id, sourceUrl: "/current.png", width: 1600, height: 900 },
  ]), sized);
});

test("uses the latest measurement for the current source among duplicate load events", () => {
  const image = createMedia("image", "/current.png", "Image", { x: 0, y: 0 });
  const document = documentWith([image]);
  const next = applyCanvasMediaNaturalSizes(document, [
    { nodeId: image.id, sourceUrl: "/current.png", width: 1200, height: 800 },
    { nodeId: image.id, sourceUrl: "/old.png", width: 800, height: 1200 },
  ]);

  assert.equal(next.nodes[0].data.nativeWidth, 1200);
  assert.equal(next.nodes[0].data.nativeHeight, 800);
});

test("persists video dimensions, source duration, and trimmed playback duration", () => {
  const video = createMedia("video", "/clip.mp4", "Clip", { x: 0, y: 0 }, {
    videoClip: {
      version: 1,
      startTime: 2,
      endTime: 8,
      volume: 1,
      muted: false,
      playbackRate: 2,
      fit: "contain",
    },
  });
  const document = documentWith([video]);

  const next = applyCanvasMediaNaturalSizes(document, [
    {
      nodeId: video.id,
      sourceUrl: "/clip.mp4",
      width: 1920,
      height: 1080,
      durationSeconds: 10.123,
    },
  ]);

  const measured = next.nodes[0];
  assert.equal(measured.data.nativeWidth, 1920);
  assert.equal(measured.data.nativeHeight, 1080);
  assert.equal(measured.data.sourceDurationMs, 10123);
  assert.equal(measured.data.durationMs, 3000);
  assert.equal(measured.data.videoClip.endTime, 8);
  assert.equal(video.data.sourceDurationMs, undefined);
});

test("persists audio duration without inventing intrinsic dimensions", () => {
  const audio = createMedia("audio", "/voice.wav", "Voice", { x: 0, y: 0 });
  const next = applyCanvasMediaNaturalSizes(documentWith([audio]), [
    {
      nodeId: audio.id,
      sourceUrl: "/voice.wav",
      width: 0,
      height: 0,
      durationSeconds: 9.876,
    },
  ]);

  assert.equal(next.nodes[0].data.durationMs, 9876);
  assert.equal(next.nodes[0].data.nativeWidth, undefined);
  assert.equal(next.nodes[0].data.nativeHeight, undefined);
});
