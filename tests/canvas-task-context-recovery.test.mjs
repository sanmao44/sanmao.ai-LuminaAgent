import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const load = createTsRequire(path.join(process.cwd(), 'lib'));
const { canPreserveCanvasAudioDraft, canRestoreCanvasTaskContext, canvasAudioGenerationRecoveryDraft, canvasImageGenerationRecoveryDraft, createCanvasAudioRecoveryDraftNode, restorableCanvasTaskLogs } = load('./canvas/task-context-recovery');

const defaults = {
  kind: 'image', model: 'default-model', aspect: '1:1', customAspectWidth: 16,
  customAspectHeight: 9, sizeMode: 'system', resolution: '1K', width: 1024,
  height: 1024, count: 1, quality: '自动', outputFormat: 'png',
  backgroundMode: 'auto', upscaleScale: 2, upscaleTarget: 'auto', upscaleSeed: 42,
  upscaleColorCorrection: 'wavelet', upscaleAlgorithm: 'lanczos', mask: { url: '/old-mask.png' },
};

test('restores an image-generation task as an editable Canvas draft without carrying a stale mask', () => {
  const result = canvasImageGenerationRecoveryDraft({
    id: 'task-1', mode: 'generate', status: 'error', prompt: '  product scene  ',
    modelId: 'image-model', aspectRatio: '16:9', count: 3, resolution: '2K',
    references: [{ id: 'reference-1', name: 'style', url: '/assets/style.png' }],
  }, defaults);

  assert.equal(result.draft.prompt, 'product scene');
  assert.equal(result.draft.params.model, 'image-model');
  assert.equal(result.draft.params.aspect, '16:9');
  assert.equal(result.draft.params.count, 3);
  assert.equal(result.draft.params.resolution, '2K');
  assert.equal(result.draft.params.mask, undefined);
  assert.equal(result.draft.sourceNodeId, undefined);
  assert.equal(result.draft.operation, 'generate');
  assert.deepEqual(result.draft.references, [{
    id: 'reference-1', kind: 'image', name: 'style', origin: 'upload', url: '/assets/style.png',
  }]);
  assert.equal(result.unavailableReferenceCount, 0);
});

test('reports saved reference metadata whose source is no longer available', () => {
  const result = canvasImageGenerationRecoveryDraft({
    id: 'task-2', mode: 'generate', status: 'error', prompt: 'scene',
    references: [
      { id: 'available', name: 'available', url: '/assets/available.png' },
      { id: 'missing', name: 'missing', url: '' },
    ],
  }, defaults);

  assert.equal(result.draft.references.length, 1);
  assert.equal(result.unavailableReferenceCount, 1);
});

test('does not invent a Canvas retry draft for image edits or other media', () => {
  assert.equal(canvasImageGenerationRecoveryDraft({ mode: 'edit', status: 'error', prompt: 'edit' }, defaults), null);
  assert.equal(canvasImageGenerationRecoveryDraft({ mode: 'video', status: 'error', prompt: 'video' }, defaults), null);
});

test('does not offer context restoration while a provider result is unconfirmed', () => {
  assert.equal(canRestoreCanvasTaskContext({ mode: 'generate', status: 'error', errorCode: 'provider_result_unconfirmed' }), false);
  assert.equal(canRestoreCanvasTaskContext({ mode: 'generate', status: 'error', errorCode: 'provider_rejected' }), true);
  assert.equal(canRestoreCanvasTaskContext({ mode: 'video', status: 'error' }), true);
  assert.equal(canRestoreCanvasTaskContext({ mode: 'audio', status: 'error' }), true);
  assert.equal(canRestoreCanvasTaskContext({ mode: 'llm', status: 'error' }), false);
});

test('offers local audio draft preservation for an unconfirmed provider result', () => {
  assert.equal(canPreserveCanvasAudioDraft({ mode: 'audio', errorCode: 'provider_result_unconfirmed' }), true);
  assert.equal(canPreserveCanvasAudioDraft({ mode: 'generate', mediaKind: 'image', errorCode: 'provider_result_unconfirmed' }), false);
  assert.equal(canPreserveCanvasAudioDraft({ mode: 'audio', errorCode: 'provider_rejected' }), false);
});

test('restores failed audio text, requested voice, and model without submitting a new task', () => {
  const draft = canvasAudioGenerationRecoveryDraft({
    prompt: '恢复这段旁白',
    createdAt: '2026-11-08T10:00:00.000Z',
    requestedModelId: 'speech-model-a',
    voice: 'warm-voice',
  }, undefined, undefined, 1234);

  assert.deepEqual(draft, {
    text: '恢复这段旁白',
    voice: 'warm-voice',
    modelId: 'speech-model-a',
    updatedAt: 1234,
  });
});

test('preserves an audio draft edited after the failed request', () => {
  const currentDraft = {
    text: '用户后来编辑的旁白',
    voice: 'new-voice',
    modelId: 'new-model',
    updatedAt: Date.parse('2026-11-08T10:01:00.000Z'),
  };
  const restored = canvasAudioGenerationRecoveryDraft({
    prompt: '旧任务旁白',
    createdAt: '2026-11-08T10:00:00.000Z',
    requestedModelId: 'old-model',
    voice: 'old-voice',
  }, currentDraft, undefined, 1234);

  assert.equal(restored, currentDraft);
});

test('keeps automatic model preference when restoring a new audio failure', () => {
  const restored = canvasAudioGenerationRecoveryDraft({
    prompt: '自动模型旁白',
    createdAt: '2026-11-08T10:00:00.000Z',
    requestedModelId: 'auto',
  }, undefined, { text: '上次旁白', engine: 'provider', requestedModelId: 'previous-model', createdAt: 10 }, 1234);

  assert.equal(restored.modelId, 'auto');
});

test('creates an editable audio recovery node without a generated result or task', () => {
  const node = createCanvasAudioRecoveryDraftNode({
    id: 'audio-log-1',
    taskId: 'audio-task-1',
    prompt: '恢复这段旁白',
    createdAt: '2026-11-08T10:00:00.000Z',
    requestedModelId: 'speech-model-a',
    voice: 'warm-voice',
  }, { x: 120, y: 240 }, 1234);

  assert.equal(node.type, 'media');
  assert.equal(node.x, 120);
  assert.equal(node.y, 240);
  assert.equal(node.data.kind, 'audio');
  assert.equal(node.data.url, '');
  assert.equal(node.data.status, 'draft');
  assert.equal(node.data.speechDraft.text, '恢复这段旁白');
  assert.equal(node.data.speechDraft.voice, 'warm-voice');
  assert.equal(node.data.speechDraft.modelId, 'speech-model-a');
  assert.equal(node.data.speechGeneration, undefined);
  assert.equal(node.data.jobId, undefined);
  assert.equal(node.data.recoveryTaskId, 'audio-task-1');
});

test('filters the recovery queue to explicit image, video, and audio failures', () => {
  const logs = [
    { id: 'image', mode: 'generate', mediaKind: 'image', status: 'error', errorCode: 'provider_rejected' },
    { id: 'video', mode: 'video', status: 'error' },
    { id: 'audio', mode: 'audio', status: 'error' },
    { id: 'unconfirmed', mode: 'generate', mediaKind: 'image', status: 'error', errorCode: 'provider_result_unconfirmed' },
    { id: 'llm', mode: 'llm', status: 'error' },
    { id: 'running', mode: 'video', status: 'pending' },
  ];

  assert.deepEqual(restorableCanvasTaskLogs(logs).map((log) => log.id), ['image', 'video', 'audio']);
  assert.equal(logs.length, 6);
});
