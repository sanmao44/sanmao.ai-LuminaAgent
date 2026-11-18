import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const module = createTsRequire(process.cwd())('./packages/agent-core/audio-subtitle-intent');

test('detects explicit subtitle and SRT generation requests', () => {
  assert.equal(module.isAudioSubtitleRequest('请根据这段配音生成字幕'), true);
  assert.equal(module.isAudioSubtitleRequest('把这段录音做成 SRT 字幕文件'), true);
  assert.equal(module.isAudioSubtitleRequest('Create an SRT subtitle file'), true);
});

test('keeps ordinary audio conversation and subtitle denials out of generation mode', () => {
  assert.equal(module.isAudioSubtitleRequest('这段音频里说了什么？帮我总结一下'), false);
  assert.equal(module.isAudioSubtitleRequest('不要生成字幕，只分析内容'), false);
  assert.equal(module.isAudioSubtitleRequest(''), false);
});
