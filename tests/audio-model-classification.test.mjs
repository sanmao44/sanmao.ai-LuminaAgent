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

test('Cangyuan official model profiles distinguish dialogue, music, and sound effects', () => {
  const { inferModel } = createTsRequire(process.cwd())('./lib/store');
  const dialogue = inferModel('mu1-muse-audio', 'cangyuan');
  const soundEffect = inferModel('elevenlabs-sound-effects-v3', 'cangyuan');
  const music = inferModel('lyria-3.5', 'cangyuan');

  assert.deepEqual(dialogue.classification?.purposes, ['conversation']);
  assert.ok(dialogue.capabilities.includes('audio-conversation'));
  assert.deepEqual(soundEffect.classification?.purposes, ['sound-effect']);
  assert.ok(soundEffect.capabilities.includes('sound-effect'));
  assert.ok(soundEffect.capabilities.includes('music-generate'));
  assert.deepEqual(music.classification?.purposes, ['music']);
});

test('provider metadata separates speech, transcription, music, and sound effects', () => {
  assert.deepEqual(classifier.classifyAudioModelPurpose({ modelId: 'a', declaredCapabilities: ['text-to-speech'] }).purposes, ['speech']);
  assert.deepEqual(classifier.classifyAudioModelPurpose({ modelId: 'b', declaredCapabilities: ['speech-to-text'] }).purposes, ['transcription']);
  assert.deepEqual(classifier.classifyAudioModelPurpose({ modelId: 'c', declaredCapabilities: ['music-generation'] }).purposes, ['music']);
  assert.deepEqual(classifier.classifyAudioModelPurpose({ modelId: 'd', declaredCapabilities: ['sound-effects'] }).purposes, ['sound-effect']);
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
