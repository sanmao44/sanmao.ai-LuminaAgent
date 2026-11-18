import type { SpeechOutputFormat } from '@/packages/contracts/audio-synthesis';

const SPEECH_FORMAT_LABELS: Readonly<Record<SpeechOutputFormat, string>> = Object.freeze({
  mp3: 'MP3（通用播放）',
  wav: 'WAV（适合后期编辑）',
  opus: 'Opus（适合网络播放）',
  aac: 'AAC（常见压缩音频）',
  flac: 'FLAC（无损压缩）',
  pcm: 'PCM（未压缩音频）',
});

export function speechOutputFormatLabel(format: SpeechOutputFormat) {
  return SPEECH_FORMAT_LABELS[format];
}
