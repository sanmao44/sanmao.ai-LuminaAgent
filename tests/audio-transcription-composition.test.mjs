import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

function loadComposition(runtime) {
  const providerCalls = [];
  const storeCalls = [];
  const loader = createTsRequire(process.cwd(), {
    '@/lib/store': {
      getRuntimeModelCandidates: async (modelId, kind) => {
        storeCalls.push({ modelId, kind });
        return runtime ? [runtime] : [];
      },
    },
    '@/lib/audio-transcription-provider': {
      transcribeOpenAiCompatibleAudio: async (resolved, input, signal) => {
        providerCalls.push({ resolved, input, signal });
        return { text: 'recognized', modelId: resolved.model.id, modelName: resolved.model.displayName };
      },
    },
    '@/lib/generation-log': { startGenerationLog: async () => 'log', finishGenerationLog: async () => {} },
  });
  return { composition: loader('./apps/api/audio-transcription-composition'), providerCalls, storeCalls };
}

const request = {
  modelId: 'selected-asr',
  file: { name: 'speech.mp3', mimeType: 'audio/mpeg', bytes: new Uint8Array([1, 2]) },
  prompt: '参考专名',
  responseFormat: 'verbose_json',
  temperature: 0,
};

test('selected model resolution validates transcription capability and uses the shared audio adapter', async () => {
  const runtime = {
    model: { id: 'selected-asr', rawId: 'vendor-asr-raw', displayName: 'Vendor ASR', capabilities: ['transcription'] },
    provider: { type: 'openai-compatible' },
  };
  const fixture = loadComposition(runtime);
  const controller = new AbortController();

  const result = await fixture.composition.transcribeWithSelectedModel(request, controller.signal);

  assert.deepEqual(fixture.storeCalls, [{ modelId: 'selected-asr', kind: 'audio' }]);
  assert.equal(fixture.providerCalls.length, 1);
  assert.equal(fixture.providerCalls[0].resolved, runtime);
  assert.equal(fixture.providerCalls[0].input.prompt, '参考专名');
  assert.equal(fixture.providerCalls[0].signal, controller.signal);
  assert.equal(result.modelName, 'Vendor ASR');
});

test('selected model resolution rejects candidates without transcription capability or protocol support', async () => {
  const noCapability = loadComposition({
    model: { id: 'selected-asr', capabilities: ['speech'] },
    provider: { type: 'openai-compatible' },
  });
  await assert.rejects(noCapability.composition.transcribeWithSelectedModel(request), /不支持音频转写/);

  const wrongProtocol = loadComposition({
    model: { id: 'selected-asr', capabilities: ['transcription'] },
    provider: { type: 'custom' },
  });
  await assert.rejects(wrongProtocol.composition.transcribeWithSelectedModel(request), /接口协议尚未接入/);
});
