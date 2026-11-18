import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLibModules } from './lib-build.mjs';

const { main: application } = await buildLibModules(
  ['apps/api/audio-transcription-application', 'packages/contracts/audio-transcription'],
  'audio-transcription-application',
);

const formatSrt = (segments) => {
  const cues = segments
    .filter((segment) => segment.text.trim() && Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start)
    .map((segment, index) => {
      const milliseconds = Math.round(segment.start * 1000);
      const endMilliseconds = Math.round(segment.end * 1000);
      const stamp = (value) => `${String(Math.floor(value / 3600000)).padStart(2, '0')}:${String(Math.floor((value % 3600000) / 60000)).padStart(2, '0')}:${String(Math.floor((value % 60000) / 1000)).padStart(2, '0')},${String(value % 1000).padStart(3, '0')}`;
      return `${index + 1}\n${stamp(milliseconds)} --> ${stamp(endMilliseconds)}\n${segment.text.trim()}`;
    });
  return cues.length ? `${cues.join('\n\n')}\n` : '';
};

test('SRT keeps ASR timestamps, uses millisecond precision, and emits stable cue numbering', async () => {
  let saved;
  const result = await application.generateAudioSubtitle({
    audio: { artifactId: 'audio-id', name: 'interview.mp3', mimeType: 'audio/mpeg' },
  }, {
    transcribeAudio: async () => ({
      text: 'Hello. Again.',
      words: [],
      segments: [
        { start: 0.125, end: 1.4, text: 'Hello.' },
        { start: 3.2, end: 4.045, text: 'Again.' },
      ],
      model: 'test-model',
    }),
    formatSrt,
    saveSubtitle: async (input) => {
      saved = input;
      return { id: 'subtitle-id', name: input.name, mimeType: input.mimeType, size: input.data.byteLength, downloadUrl: '/api/artifacts/subtitle-id' };
    },
  });

  assert.equal(saved.name, 'interview.srt');
  assert.equal(saved.mimeType, 'application/x-subrip;charset=utf-8');
  assert.equal(new TextDecoder().decode(saved.data), '1\n00:00:00,125 --> 00:00:01,400\nHello.\n\n2\n00:00:03,200 --> 00:00:04,045\nAgain.\n');
  assert.deepEqual(result.file, {
    name: 'interview.srt',
    mimeType: 'application/x-subrip;charset=utf-8',
    size: saved.data.byteLength,
    artifactId: 'subtitle-id',
    downloadUrl: '/api/artifacts/subtitle-id',
  });
});

test('uploaded transcription validates documented settings and records structured output', async () => {
  const lifecycle = [];
  let providerInput;
  const result = await application.transcribeUploadedAudio({
    modelId: 'cangyuan-asr',
    file: { name: 'meeting.wav', mimeType: 'audio/wav', bytes: new Uint8Array([1, 2, 3]) },
    language: 'zh', prompt: '张小明、沧海', responseFormat: 'verbose_json', temperature: 0.15,
  }, {
    transcribe: async (input) => {
      providerInput = input;
      return { text: '会议开始。', modelId: 'cangyuan-asr', modelName: 'Muse ASR', language: 'zh', segments: [{ start: 0, end: 1.25, text: '会议开始。' }] };
    },
    startLog: async (input) => { lifecycle.push({ type: 'start', input }); return 'log-1'; },
    finishLog: async (id, patch) => { lifecycle.push({ type: 'finish', id, patch }); },
  });

  assert.equal(providerInput.file.name, 'meeting.wav');
  assert.equal(providerInput.language, 'zh');
  assert.equal(providerInput.prompt, '张小明、沧海');
  assert.equal(providerInput.responseFormat, 'verbose_json');
  assert.equal(providerInput.temperature, 0.15);
  assert.equal(result.text, '会议开始。');
  assert.deepEqual(result.segments, [{ start: 0, end: 1.25, text: '会议开始。' }]);
  assert.equal(lifecycle[0].input.sourceAudioName, 'meeting.wav');
  assert.equal(lifecycle[1].patch.textResult, '会议开始。');
  assert.deepEqual(lifecycle[1].patch.transcriptionSegments, [{ start: 0, end: 1.25, text: '会议开始。' }]);
});

test('uploaded transcription rejects unsupported audio and out-of-range temperature before creating history', async () => {
  let started = false;
  const ports = {
    transcribe: async () => { throw new Error('must not call provider'); },
    startLog: async () => { started = true; return 'log'; },
    finishLog: async () => {},
  };
  await assert.rejects(application.transcribeUploadedAudio({
    modelId: 'model', file: { name: 'track.aiff', mimeType: 'audio/aiff', bytes: new Uint8Array([1]) },
  }, ports), /仅支持 MP3、WAV、OGG、M4A、FLAC、WebM 或 PCM/);
  await assert.rejects(application.transcribeUploadedAudio({
    modelId: 'model', file: { name: 'track.mp3', mimeType: 'audio/mpeg', bytes: new Uint8Array([1]) }, temperature: 1.1,
  }, ports), /温度范围应为 0 到 1/);
  assert.equal(started, false);
});

test('audio transcription forwards bounded reference text and reports model stages', async () => {
  const stages = [];
  let transcribeInput;
  await application.generateAudioSubtitle({
    audio: { artifactId: 'audio-id', name: 'voice.wav', mimeType: 'audio/wav' },
    referenceText: 'A product glossary',
  }, {
    transcribeAudio: async (input) => {
      transcribeInput = input;
      input.onProgress('loading-model');
      input.onProgress('transcribing');
      return { text: 'Hi', words: [], segments: [{ start: 0, end: 1, text: 'Hi' }], model: 'test-model' };
    },
    formatSrt,
    saveSubtitle: async (input) => ({ id: 'subtitle-id', name: input.name, mimeType: input.mimeType, size: input.data.byteLength, downloadUrl: '/api/artifacts/subtitle-id' }),
  }, (stage) => stages.push(stage));

  assert.equal(transcribeInput.referenceText, 'A product glossary');
  assert.deepEqual(stages, ['loading-model', 'transcribing']);
});

test('audio transcription prefers a configured cloud provider and applies reference corrections to its timed result', async () => {
  const calls = [];
  const controller = new AbortController();
  let savedText = '';
  const cloudResult = {
    text: 'cloud transcript',
    words: [],
    segments: [{ start: 0.2, end: 1.4, text: 'cloud transcript' }],
    model: 'SenseVoiceSmall',
  };
  await application.generateAudioSubtitle({
    audio: { artifactId: 'audio-id', name: 'voice.mp3', mimeType: 'audio/mpeg' },
    referenceText: 'Reference document',
  }, {
    getCloudTranscriber: async () => async (input) => {
      calls.push(['cloud', input.referenceText, input.signal]);
      return cloudResult;
    },
    transcribeAudio: async () => {
      calls.push(['local']);
      throw new Error('local recognition should not run for a timed cloud result');
    },
    applyReferenceText: (transcript, referenceText) => {
      calls.push(['reference', referenceText]);
      return { ...transcript, text: 'reference corrected', segments: [{ ...transcript.segments[0], text: 'reference corrected' }] };
    },
    formatSrt: (segments) => {
      savedText = segments[0].text;
      return 'formatted';
    },
    saveSubtitle: async (input) => ({ id: 'subtitle-id', name: input.name, mimeType: input.mimeType, size: input.data.byteLength, downloadUrl: '/api/artifacts/subtitle-id' }),
  }, undefined, controller.signal);

  assert.equal(savedText, 'reference corrected');
  assert.deepEqual(calls, [
    ['cloud', 'Reference document', controller.signal],
    ['reference', 'Reference document'],
  ]);
});

test('audio transcription falls back locally when the cloud provider is missing or fails', async () => {
  const results = [];
  const localResult = { text: 'local', words: [], segments: [{ start: 0, end: 1, text: 'local' }], model: 'local-model' };
  const ports = (cloudTranscriber) => ({
    getCloudTranscriber: async () => cloudTranscriber,
    transcribeAudio: async () => {
      results.push('local');
      return localResult;
    },
    formatSrt,
    saveSubtitle: async (input) => ({ id: 'subtitle-id', name: input.name, mimeType: input.mimeType, size: input.data.byteLength, downloadUrl: '/api/artifacts/subtitle-id' }),
  });

  const noProvider = await application.generateAudioSubtitle({ audio: { artifactId: 'audio-id', name: 'voice.mp3', mimeType: 'audio/mpeg' } }, ports(null));
  const cloudFailure = await application.generateAudioSubtitle({ audio: { artifactId: 'audio-id', name: 'voice.mp3', mimeType: 'audio/mpeg' } }, ports(async () => { throw new Error('cloud unavailable'); }));

  assert.deepEqual(results, ['local', 'local']);
  assert.equal(noProvider.transcript.model, 'local-model');
  assert.equal(cloudFailure.transcript.model, 'local-model');
});

test('text-only cloud transcripts reuse local timing and aborts do not start a local retry', async () => {
  const calls = [];
  const localResult = { text: 'recognized locally', words: [], segments: [{ start: 2, end: 4, text: 'recognized locally' }], model: 'local-model' };
  const alignedResult = { text: 'cloud transcript', words: [], segments: [{ start: 2, end: 4, text: 'cloud transcript' }], model: 'SenseVoiceSmall' };
  const result = await application.generateAudioSubtitle({
    audio: { artifactId: 'audio-id', name: 'voice.mp3', mimeType: 'audio/mpeg' },
    referenceText: 'Reference document',
  }, {
    getCloudTranscriber: async () => async () => ({ text: 'cloud transcript', words: [], segments: [], model: 'SenseVoiceSmall' }),
    transcribeAudio: async () => { calls.push('local'); return localResult; },
    alignCloudTranscript: (cloud, local, referenceText) => {
      calls.push([cloud.text, local.model, referenceText]);
      return alignedResult;
    },
    formatSrt,
    saveSubtitle: async (input) => ({ id: 'subtitle-id', name: input.name, mimeType: input.mimeType, size: input.data.byteLength, downloadUrl: '/api/artifacts/subtitle-id' }),
  });
  assert.equal(result.transcript.model, 'SenseVoiceSmall');
  assert.deepEqual(calls, ['local', ['cloud transcript', 'local-model', 'Reference document']]);

  const controller = new AbortController();
  let localStarted = false;
  const aborted = application.generateAudioSubtitle({ audio: { artifactId: 'audio-id', name: 'voice.mp3', mimeType: 'audio/mpeg' } }, {
    getCloudTranscriber: async () => async () => {
      controller.abort(new Error('cancelled by user'));
      throw new Error('request aborted');
    },
    transcribeAudio: async () => { localStarted = true; return localResult; },
    formatSrt,
    saveSubtitle: async () => { throw new Error('cancelled transcription must not save'); },
  }, undefined, controller.signal);

  await assert.rejects(aborted, /cancelled by user/);
  assert.equal(localStarted, false);
});

test('audio transcription fails without usable timed speech and rejects expired attachment ids', async () => {
  const ports = {
    transcribeAudio: async () => ({ text: '', words: [], segments: [], model: 'test-model' }),
    formatSrt,
    saveSubtitle: async () => { throw new Error('should not save'); },
  };
  await assert.rejects(application.generateAudioSubtitle({ audio: { artifactId: 'audio-id', name: 'voice.mp3', mimeType: 'audio/mpeg' } }, ports), /No usable speech segments/);
  await assert.rejects(application.generateAudioSubtitle({ audio: { artifactId: ' ', name: 'voice.mp3', mimeType: 'audio/mpeg' } }, ports), /Audio attachment is missing/);
});
