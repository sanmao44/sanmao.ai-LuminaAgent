import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const contract = createTsRequire(process.cwd())('./packages/contracts/audio-transcription');

test('transcription choices keep local, Moark ASR and registered ASR models distinct', () => {
  assert.deepEqual(contract.audioTranscriptionSelectionForChoice('local-whisper'), { source: 'local' });
  assert.deepEqual(contract.audioTranscriptionSelectionForChoice('moark-sensevoice-small'), { source: 'moark', modelId: 'SenseVoiceSmall' });
  assert.deepEqual(contract.audioTranscriptionSelectionForChoice('registered-asr'), { source: 'provider', modelId: 'registered-asr' });
});

test('transcription selection parser validates new choices and keeps old modelId clients compatible', () => {
  assert.deepEqual(contract.parseAudioTranscriptionModelSelection({ source: 'local' }), { source: 'local' });
  assert.deepEqual(contract.parseAudioTranscriptionModelSelection({ source: 'moark', modelId: 'SenseVoiceSmall' }), { source: 'moark', modelId: 'SenseVoiceSmall' });
  assert.deepEqual(contract.parseAudioTranscriptionModelSelection({ source: 'provider', modelId: 'registered-asr' }), { source: 'provider', modelId: 'registered-asr' });
  assert.deepEqual(contract.parseAudioTranscriptionModelSelection({ modelId: 'registered-asr' }), { source: 'provider', modelId: 'registered-asr' });
  assert.equal(contract.parseAudioTranscriptionModelSelection({ source: 'moark', modelId: 'other-model' }), null);
  assert.equal(contract.parseAudioTranscriptionModelSelection({ source: 'provider', modelId: '   ' }), null);
});
