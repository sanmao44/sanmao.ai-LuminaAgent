import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const loader = createTsRequire(process.cwd(), {
  '@/components/ModelPicker': { __esModule: true, default: () => null },
  '@/components/SelectMenu': { __esModule: true, default: () => null },
  '@/components/audio/model-options': {
    supportedTranscriptionModels: (state) => state.models.filter((model) => model.capabilities.includes('transcription')),
  },
  '@/lib/generation-log-client': { listGenerationLogs: async () => [] },
  './AudioTranscription.module.css': { __esModule: true, default: { result: 'result', transcript: 'transcript', details: 'details', segments: 'segments', fileInput: 'fileInput', upload: 'upload', advanced: 'advanced', temperature: 'temperature' } },
});
const module = loader('./components/AudioTranscription');

test('transcription model discovery requires the dedicated capability', () => {
  const models = module.audioTranscriptionModels({
    models: [
      { id: 'tts', capabilities: ['speech'] },
      { id: 'asr', capabilities: ['transcription'] },
    ],
    providers: [],
  });
  assert.deepEqual(models.map((model) => model.id), ['asr']);
});

test('transcription history displays selectable text and verbose timestamp segments', () => {
  const markup = renderToStaticMarkup(createElement(module.AudioTranscriptionHistory, {
    logs: [{
      id: 'log-1', createdAt: '2026-11-18T12:00:00.000Z', status: 'success', mode: 'audio', prompt: '音频转写：meeting.wav',
      sourceAudioName: 'meeting.wav', modelName: 'Muse 语音识别', textResult: '会议开始。请大家就座。',
      transcriptionSegments: [{ start: 2.8, end: 4.4, text: '会议开始。' }],
    }],
    onCopy: () => undefined,
  }));

  assert.match(markup, /会议开始。请大家就座。/);
  assert.match(markup, /查看分段时间/);
  assert.match(markup, /00:02–00:04/);
  assert.match(markup, /复制文字/);
  assert.match(markup, /下载文字/);
});
