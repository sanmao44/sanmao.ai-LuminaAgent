import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLibModules } from './lib-build.mjs';

const { main: application } = await buildLibModules(
  ['apps/api/audio-attachment-application'],
  'audio-attachment-application',
);

test('audio attachment stores a normalized descriptor without exposing local paths', async () => {
  let saved;
  const result = await application.uploadAudioAttachment({
    name: 'C:\\voice\\Interview.MP3',
    mimeType: 'audio/mpeg; codecs=mp3',
    data: new Uint8Array([1, 2, 3]),
  }, {
    save: async (input) => {
      saved = input;
      return { id: 'asset-1', name: input.name, mimeType: input.mimeType, size: input.data.byteLength, downloadUrl: '/api/artifacts/asset-1' };
    },
  });
  assert.equal(saved.name, 'Interview.mp3');
  assert.equal(saved.mimeType, 'audio/mpeg');
  assert.deepEqual(Array.from(saved.data), [1, 2, 3]);
  assert.deepEqual(result, {
    id: 'asset-1',
    name: 'Interview.mp3',
    mimeType: 'audio/mpeg',
    size: 3,
    artifactId: 'asset-1',
    downloadUrl: '/api/artifacts/asset-1',
  });
  assert.equal('path' in result, false);
});

test('audio attachment accepts common formats even when browsers omit their MIME type', async () => {
  let calls = 0;
  const storage = { save: async (input) => { calls += 1; return { id: String(calls), name: input.name, mimeType: input.mimeType, size: input.data.byteLength, downloadUrl: `/api/artifacts/${calls}` }; } };
  const mp3 = await application.uploadAudioAttachment({ name: 'speech.mp3', mimeType: '', data: new Uint8Array([1]) }, storage);
  const m4a = await application.uploadAudioAttachment({ name: 'speech.m4a', mimeType: 'application/octet-stream', data: new Uint8Array([1]) }, storage);
  const opus = await application.uploadAudioAttachment({ name: 'speech.opus', mimeType: 'audio/opus', data: new Uint8Array([1]) }, storage);
  assert.equal(mp3.mimeType, 'audio/mpeg');
  assert.equal(m4a.mimeType, 'audio/mp4');
  assert.equal(opus.mimeType, 'audio/opus');
  assert.equal(calls, 3);
});

test('audio attachment rejects unsupported types, mismatched MIME and invalid sizes before persistence', async () => {
  let calls = 0;
  const storage = { save: async () => { calls += 1; throw new Error('unexpected'); } };
  await assert.rejects(application.uploadAudioAttachment({ name: 'notes.pdf', mimeType: 'application/pdf', data: new Uint8Array([1]) }, storage), { status: 415 });
  await assert.rejects(application.uploadAudioAttachment({ name: 'voice.mp3', mimeType: 'audio/wav', data: new Uint8Array([1]) }, storage), { status: 415 });
  await assert.rejects(application.uploadAudioAttachment({ name: 'voice.wav', mimeType: 'audio/wav', data: new Uint8Array() }, storage), { status: 400 });
  await assert.rejects(application.uploadAudioAttachment({ name: 'voice.wav', mimeType: 'audio/wav', data: new Uint8Array(application.AUDIO_ATTACHMENT_MAX_BYTES + 1) }, storage), { status: 413 });
  assert.equal(calls, 0);
});
