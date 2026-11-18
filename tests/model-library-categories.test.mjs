import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const categories = createTsRequire(process.cwd())('./lib/model-library-categories');

function model(kind, capabilities = [], source) {
  return { kind, capabilities, ...(source ? { source } : {}) };
}

test('separates speech, music generation, and transcription in the model library', () => {
  const speech = model('audio', ['speech']);
  const music = model('audio', ['music-generate']);
  const transcription = model('audio', ['transcription']);

  assert.equal(categories.modelMatchesLibraryCategory(speech, 'speech'), true);
  assert.equal(categories.modelMatchesLibraryCategory(speech, 'music'), false);
  assert.equal(categories.modelMatchesLibraryCategory(speech, 'transcription'), false);
  assert.equal(categories.modelMatchesLibraryCategory(music, 'music'), true);
  assert.equal(categories.modelMatchesLibraryCategory(music, 'speech'), false);
  assert.equal(categories.modelMatchesLibraryCategory(transcription, 'transcription'), true);
  assert.equal(categories.modelMatchesLibraryCategory(transcription, 'speech'), false);
  assert.equal(categories.modelLibraryCategoryLabel(speech), '配音模型');
  assert.equal(categories.modelLibraryCategoryLabel(music), '音乐生成模型');
  assert.equal(categories.modelLibraryCategoryLabel(transcription), '语音转写模型');
});

test('keeps video audio support out of standalone audio model categories', () => {
  const video = model('video', ['video-generate', 'video-audio']);
  assert.equal(categories.modelMatchesLibraryCategory(video, 'video'), true);
  assert.equal(categories.modelMatchesLibraryCategory(video, 'speech'), false);
  assert.equal(categories.modelMatchesLibraryCategory(video, 'music'), false);
});

test('separates sound effects and audio dialogue from music generation', () => {
  const soundEffect = model('audio', ['sound-effect', 'music-generate']);
  const conversation = model('audio', ['audio-conversation']);

  assert.equal(categories.modelMatchesLibraryCategory(soundEffect, 'sound-effect'), true);
  assert.equal(categories.modelMatchesLibraryCategory(soundEffect, 'music'), false);
  assert.equal(categories.modelMatchesLibraryCategory(conversation, 'conversation'), true);
  assert.equal(categories.modelMatchesLibraryCategory(conversation, 'speech'), false);
  assert.equal(categories.modelLibraryCategoryLabel(soundEffect), '音效模型');
  assert.equal(categories.modelLibraryCategoryLabel(conversation), '音频对话模型');
});

test('preserves legacy audio records as speech and reports multi-task audio explicitly', () => {
  assert.equal(categories.modelMatchesLibraryCategory(model('audio'), 'speech'), true);
  assert.equal(categories.modelMatchesLibraryCategory(model('audio'), 'transcription'), false);
  assert.equal(categories.modelLibraryCategoryLabel(model('audio', ['speech', 'music-generate'])), '多用途音频 · 配音 / 音乐生成');
  const unclassified = model('audio', [], 'discovered');
  assert.equal(categories.modelMatchesLibraryCategory(unclassified, 'speech'), false);
  assert.equal(categories.modelLibraryCategoryLabel(unclassified), '音频用途待确认');
});
