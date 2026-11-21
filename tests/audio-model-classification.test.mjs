import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const classifier = createTsRequire(process.cwd())('./lib/audio-model-classification');

test('official purpose wins over ambiguous model names', () => {
  const result = classifier.classifyAudioModelPurpose({
    modelId: 'audio-chat-tts',
    officialPurposes: ['conversation'],
    declaredCapabilities: ['tts'],
  });
  assert.deepEqual(result.purposes, ['conversation']);
  assert.equal(result.source, 'official');
  assert.equal(result.confidence, 'high');
  assert.equal(result.requiresReview, false);
});

test('Cangyuan official model profiles distinguish speech, dialogue, music, sound effects, conversion, and isolation', () => {
  const { inferModel } = createTsRequire(process.cwd())('./lib/store');
  const dialogue = inferModel('mu1-muse-audio', 'cangyuan');
  const soundEffect = inferModel('elevenlabs-sound-effects-v3', 'cangyuan');
  const music = inferModel('lyria-3.5', 'cangyuan');
  const voiceChanger = inferModel('elevenlabs-voice-changer', 'cangyuan');
  const audioIsolation = inferModel('elevenlabs-audio-isolation', 'cangyuan');

  assert.deepEqual(dialogue.classification?.purposes, ['conversation']);
  assert.ok(dialogue.capabilities.includes('audio-conversation'));
  assert.deepEqual(soundEffect.classification?.purposes, ['sound-effect']);
  assert.ok(soundEffect.capabilities.includes('sound-effect'));
  assert.equal(soundEffect.capabilities.includes('music-generate'), false);
  assert.deepEqual(music.classification?.purposes, ['music']);
  assert.deepEqual(voiceChanger.classification?.purposes, ['voice-conversion']);
  assert.ok(voiceChanger.capabilities.includes('voice-conversion'));
  assert.equal(voiceChanger.capabilities.includes('speech'), false);
  assert.deepEqual(audioIsolation.classification?.purposes, ['audio-isolation']);
  assert.ok(audioIsolation.capabilities.includes('audio-isolation'));
  assert.equal(audioIsolation.capabilities.includes('speech'), false);
});

test('generic audio models remain audio models without being routed to speech', () => {
  const { inferModel } = createTsRequire(process.cwd())('./lib/store');
  const result = inferModel('vendor-audio-v1');
  assert.equal(result.kind, 'audio');
  assert.deepEqual(result.capabilities, []);
  assert.equal(result.classification?.requiresReview, true);
});

test('provider metadata separates speech, transcription, music, and sound effects', () => {
  assert.deepEqual(classifier.classifyAudioModelPurpose({ modelId: 'a', declaredCapabilities: ['speech'] }).purposes, ['speech']);
  assert.deepEqual(classifier.classifyAudioModelPurpose({ modelId: 'a', declaredCapabilities: ['text-to-speech'] }).purposes, ['speech']);
  assert.deepEqual(classifier.classifyAudioModelPurpose({ modelId: 'b', declaredCapabilities: ['speech-to-text'] }).purposes, ['transcription']);
  assert.deepEqual(classifier.classifyAudioModelPurpose({ modelId: 'c', declaredCapabilities: ['music-generation'] }).purposes, ['music']);
  assert.deepEqual(classifier.classifyAudioModelPurpose({ modelId: 'd', declaredCapabilities: ['sound-effects'] }).purposes, ['sound-effect']);
});

test('official purpose resolves conflicting provider capability flags', () => {
  const { inferModel } = createTsRequire(process.cwd())('./lib/store');
  const result = inferModel('audio-model-v1', 'provider', undefined, {
    classification: {
      purposes: ['transcription'], source: 'official', confidence: 'high',
      evidence: [{ kind: 'official', value: '语音转写' }], requiresReview: false,
    },
    capabilities: ['speech', 'transcription'],
  });
  assert.deepEqual(result.capabilities, ['transcription']);
  assert.deepEqual(result.classification?.purposes, ['transcription']);
});

test('unknown audio models remain reviewable instead of entering a task panel', () => {
  const result = classifier.classifyAudioModelPurpose({ modelId: 'vendor-audio-v1' });
  assert.deepEqual(result.purposes, []);
  assert.equal(result.requiresReview, true);
  assert.equal(result.confidence, 'low');
});

test('local AI suggestions are parsed but cannot override deterministic classification', () => {
  const suggestion = classifier.parseAudioModelClassificationSuggestion('{"purposes":["music"],"confidence":"medium","reason":"说明含音乐生成"}');
  assert.deepEqual(suggestion?.purposes, ['music']);
  const unresolved = classifier.classifyAudioModelPurpose({ modelId: 'vendor-audio-v1' });
  const suggested = classifier.applyAudioModelClassificationSuggestion(unresolved, suggestion);
  assert.deepEqual(suggested.purposes, ['music']);
  assert.equal(suggested.source, 'local-ai-suggested');
  assert.equal(suggested.requiresReview, true);
  const official = classifier.classifyAudioModelPurpose({ modelId: 'x', officialPurposes: ['speech'] });
  assert.deepEqual(classifier.applyAudioModelClassificationSuggestion(official, suggestion).purposes, ['speech']);
});
