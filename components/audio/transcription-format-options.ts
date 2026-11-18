export const AUDIO_TRANSCRIPTION_FORMATS = Object.freeze([
  { value: 'verbose_json', label: '分段文本（含时间戳）' },
  { value: 'json', label: '结构化文本（JSON）' },
  { value: 'text', label: '纯文本' },
] as const);
