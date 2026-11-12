import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLibModules } from './lib-build.mjs';

const { main: application } = await buildLibModules(
  ['apps/api/audio-transcription-application'],
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

test('audio transcription fails without usable timed speech and rejects expired attachment ids', async () => {
  const ports = {
    transcribeAudio: async () => ({ text: '', words: [], segments: [], model: 'test-model' }),
    formatSrt,
    saveSubtitle: async () => { throw new Error('should not save'); },
  };
  await assert.rejects(application.generateAudioSubtitle({ audio: { artifactId: 'audio-id', name: 'voice.mp3', mimeType: 'audio/mpeg' } }, ports), /No usable speech segments/);
  await assert.rejects(application.generateAudioSubtitle({ audio: { artifactId: ' ', name: 'voice.mp3', mimeType: 'audio/mpeg' } }, ports), /Audio attachment is missing/);
});
