import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const capabilities = createTsRequire(process.cwd(), {
  '../creation/settings': {
    resolveAvailableCreationModel: (settings, runtime) => ({
      model: runtime?.models?.find((model) => model.id === settings.model) || null,
    }),
  },
})('./lib/canvas/video-capabilities');

test("projects model capability names into the canvas input contract", () => {
  const runtime = {
    models: [{
      id: "video-model",
      capabilities: ["video-generate", "video-audio"],
    }],
  };
  const result = capabilities.canvasVideoInputCapabilities(
    { kind: "video", model: "video-model" },
    runtime,
  );

  assert.equal(result.supportsReference, true);
  assert.equal(result.supportsFirstFrame, true);
  assert.equal(result.supportsFrames, true);
  assert.equal(result.supportsAudio, true);
  assert.equal(result.model.id, "video-model");
});

test("keeps unsupported optional capabilities disabled", () => {
  const runtime = {
    models: [{ id: "text-only-video", capabilities: ["video-reference"] }],
  };
  const result = capabilities.canvasVideoInputCapabilities(
    { kind: "video", model: "text-only-video" },
    runtime,
  );

  assert.equal(result.supportsReference, true);
  assert.equal(result.supportsFirstFrame, false);
  assert.equal(result.supportsFrames, false);
  assert.equal(result.supportsAudio, false);
});

test("treats an unavailable model as capability-neutral", () => {
  const result = capabilities.canvasVideoInputCapabilities(
    { kind: "video", model: "missing" },
    { models: [] },
  );

  assert.equal(result.model, null);
  assert.equal(result.supportsReference, true);
  assert.equal(result.supportsFirstFrame, true);
  assert.equal(result.supportsFrames, true);
  assert.equal(result.supportsAudio, true);
});

test('official video profiles govern first frames and media slots for historical configurations', () => {
  const project = (rawId) => capabilities.canvasVideoInputCapabilities(
    {kind: 'video', model: 'selected'},
    {models: [{id: 'selected', rawId, providerId: 'provider', capabilities: ['video-generate', 'video-audio']}],
     providers: [{id: 'provider', platform: 'custom', baseUrl: 'https://ai.cangyuansuanli.cn/v1', videoTransport: 'openai-videos'}]},
  );
  const gemini = project('gf1-gemini-omni-1.2-flash');
  assert.equal(gemini.supportsFirstFrame, true);
  assert.equal(gemini.supportsFrames, true);
  assert.equal(gemini.supportsAudio, false);
  const veo = project('veo-3.1-fast');
  assert.equal(veo.supportsReference, false);
  assert.equal(veo.supportsFirstFrame, true);
  assert.equal(veo.supportsFrames, true);
  const undocumented = project('unknown-video');
  assert.equal(undocumented.supportsFirstFrame, false);
  assert.equal(undocumented.supportsAudio, false);
});

test('audio-only reference capability retains the reference-material input mode', () => {
  const audioOnlyCapabilities = createTsRequire(process.cwd(), {
    '../creation/settings': {
      resolveAvailableCreationModel: () => ({ model: { id: 'audio-driven', rawId: 'audio-driven', providerId: 'provider', capabilities: ['video-generate'] } }),
    },
    '../cangyuan-video-capabilities': {
      getCangyuanVideoModelProfile: () => ({ supportsReferenceImages: false, supportsReferenceVideos: false, supportsReferenceAudios: true }),
    },
  })('./lib/canvas/video-capabilities');
  const result = audioOnlyCapabilities.canvasVideoInputCapabilities(
    { kind: 'video', model: 'audio-driven' },
    { providers: [{ id: 'provider', platform: 'cangyuan', videoTransport: 'cangyuan-videos' }] },
  );
  assert.equal(result.supportsReference, true);
  assert.equal(result.supportsAudio, true);
  assert.equal(result.supportsFirstFrame, false);
  assert.equal(result.supportsFrames, false);
});
