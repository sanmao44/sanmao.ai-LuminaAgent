import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/model-kind.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
}).outputText;
const modelKind = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('classifies common chat model families from their names', () => {
  assert.equal(modelKind.inferModelKind({ rawId: 'Shanghai_AI_Laboratory/Intern-S1' }), 'chat');
  assert.equal(modelKind.inferModelKind({ rawId: 'OpenGVLab/InternVL3_5-241B-A28B' }), 'chat');
  assert.equal(modelKind.inferModelKind({ displayName: 'Step-3.7-Flash' }), 'chat');
  assert.equal(modelKind.inferModelKind({ displayName: 'Hiy3' }), 'chat');
  assert.equal(modelKind.inferModelKind({ rawId: 'codex-mini-latest' }), 'chat');
  assert.equal(modelKind.inferModelKind({ rawId: 'Tencent-Hunyuan/Hy3' }), 'chat');
  assert.equal(modelKind.inferModelKind({ rawId: 'doubao-seedance-2-0' }), 'video');
});

test('recognizes image-edit-only model names without treating them as text-to-image', () => {
  assert.equal(modelKind.isImageEditOnlyModel({ rawId: 'MusePublic/Qwen-Image-Edit' }), true);
  assert.equal(modelKind.isImageEditOnlyModel({ displayName: 'Qwen Image Edit' }), true);
  assert.equal(modelKind.isImageEditOnlyModel({ rawId: 'gpt-image-2' }), false);
});

test('recognizes APIKL GPT Image Pro and 4K models as image models', () => {
  assert.equal(modelKind.inferModelKind({ rawId: 'gpt-image-2-pro' }), 'image');
  assert.equal(modelKind.inferModelKind({ rawId: 'gpt-image-2-4K' }), 'image');
});

test('uses discovered capabilities before name heuristics', () => {
  assert.equal(modelKind.inferModelKind({ rawId: 'vendor/custom-model', capabilities: ['video-generate'] }), 'video');
  assert.equal(modelKind.inferModelKind({ rawId: 'vendor/custom-model', capabilities: ['generate'] }), 'image');
  assert.equal(modelKind.inferModelKind({ rawId: 'vendor/custom-model', capabilities: ['chat'] }), 'chat');
});

test('keeps an explicit category even when capabilities overlap', () => {
  assert.equal(modelKind.resolveModelKind('chat', 'image', ['chat', 'generate']), 'chat');
  assert.equal(modelKind.resolveModelKind('image', 'chat', ['chat', 'video-generate']), 'image');
});

test('infers video before image for an unclassified video-capable model', () => {
  assert.equal(modelKind.resolveModelKind('unknown', 'image', ['generate', 'video-generate']), 'video');
});

test('recognizes common external video families from model ids alone', () => {
  for (const rawId of [
    'wan2.1-i2v-plus',
    'hunyuan-video',
    'cogvideo-x',
    'ltx-video-13b',
    'pixverse-v4',
    'vidu-2',
    'lumalabs-ray-2',
    'pika-2.2',
  ]) {
    assert.equal(modelKind.inferModelKind({ rawId }), 'video', rawId);
  }
});

test('infers image and chat for unclassified models from their capabilities', () => {
  assert.equal(modelKind.resolveModelKind('unknown', 'unknown', ['generate']), 'image');
  assert.equal(modelKind.resolveModelKind('unknown', 'unknown', ['chat', 'vision']), 'chat');
  assert.equal(modelKind.resolveModelKind('unknown', 'unknown', []), 'unknown');
});

test('classifies TTS families as audio without eating ASR or realtime chat audio', () => {
  for (const rawId of ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts', 'cosyvoice-v2', 'elevenlabs-multilingual-v2', 'fish-speech-1.5', 'mimo-audio-7b']) {
    assert.equal(modelKind.inferModelKind({ rawId }), 'audio', rawId);
  }
  for (const rawId of ['whisper-1', 'gpt-4o-audio-preview', 'gpt-4o-realtime-preview', 'speech-to-text-v1']) {
    assert.notEqual(modelKind.inferModelKind({ rawId }), 'audio', rawId);
  }
});

test('keeps an explicit category and the speech capability authoritative', () => {
  assert.equal(modelKind.resolveModelKind('unknown', 'unknown', ['speech']), 'audio');
  assert.equal(modelKind.resolveModelKind('chat', 'audio', ['speech']), 'chat');
});

test('认出国内平台把 TTS 关键词黏在词尾或带厂商前缀的配音模型', () => {
  // Gitee 模力方舟 / 硅基流动的语音合成清单：改名前只有一半能被识别成「配音」，
  // 结果就是模型库里明明有配音模型，克隆弹窗的配音下拉框却是空的。
  for (const rawId of [
    'GLM-TTS', 'Qwen3-TTS', 'CosyVoice2', 'CosyVoice3', 'FunAudioLLM/CosyVoice2-0.5B',
    'ChatTTS', 'TeleTTS-Mandarin', 'TeleTTS-MultiDialect', 'IndexTTS-2', 'VoxCPM2', 'VoxCPM2-Pro',
    'Spark-TTS-0.5B', 'Step-Audio-TTS-3B', 'AudioFly', 'microsoft/VibeVoice', 'minimax/speech-02-hd',
  ]) {
    assert.equal(modelKind.inferModelKind({ rawId }), 'audio', rawId);
  }
  for (const rawId of ['iic/SenseVoiceSmall', 'qwen3-omni-flash', 'gpt-4o-mini-transcribe']) {
    assert.notEqual(modelKind.inferModelKind({ rawId }), 'audio', rawId);
  }
});

test('带版本号后缀的视频模型不再被当成对话模型', () => {
  // \bveo\b 这类写法在 veo3 / hailuo02 / Wan2.2 / ViduQ3 上直接失效，
  // 结果视频模型被塞进对话模型下拉，克隆出片的「图生视频」也选不到它们。
  for (const rawId of [
    'veo3', 'veo3-pro', 'veo3.1-4k', 'Veo3.1-Components', 'hailuo02', 'Wan2.2-T2V-A14B',
    'Wan2_2-I2V-A14B', 'ViduQ3-Pro', 'ViduQ2-Turbo', 'LTX-2', 'InfiniteTalk', 'MiniMax/video-01',
  ]) {
    assert.equal(modelKind.inferModelKind({ rawId }), 'video', rawId);
  }
  // sora_image 是图片模型，不能因为带 sora 就被判成视频。
  assert.equal(modelKind.inferModelKind({ rawId: 'sora_image' }), 'image');
  assert.equal(modelKind.inferModelKind({ rawId: 'veomax-chat' }), 'chat');
});

test('向量 / 重排 / OCR / ASR 不再被当成对话模型', () => {
  for (const rawId of [
    'Qwen3-Embedding-8B', 'Qwen3-Reranker-4B', 'bge-reranker-v2-m3', 'bge-m3', 'qwen3.5-ocr',
    'HunyuanOCR', 'DeepSeek-OCR', 'GLM-ASR', 'FunASR', 'TeleASR-MultiDialect', 'whisper-large-v3',
    'SenseVoiceSmall', 'clip-vit', 'resnet-50', 'YOLOv8', 'jina-embeddings-v4',
  ]) {
    assert.equal(modelKind.inferModelKind({ rawId }), 'unknown', rawId);
  }
  // 正常对话模型不能被误伤（这三个名字里都带容易误伤的片段）。
  for (const rawId of ['MiniMax-M3', 'GLM-5.3', 'Qwen3.5-Plus', 'deepseek-v4-flash', 'kimi-k3']) {
    assert.equal(modelKind.inferModelKind({ rawId }), 'chat', rawId);
  }
});
