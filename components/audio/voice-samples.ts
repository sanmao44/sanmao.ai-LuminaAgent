export type SpeechVoiceSample = {
  url: string;
  text: string;
  note: string;
  provenance: {
    provider: string;
    modelId: string;
    voiceId: string;
    generatedAt: string;
  };
};

export const SAMPLE_TEXT = '你好，这是一段音色试听。';

const SPEECH_VOICE_SAMPLES: Readonly<Record<string, Readonly<Record<string, SpeechVoiceSample>>>> = Object.freeze({
  'mu1-muse-tts': Object.freeze({
    alloy: { url: '/audio/voice-samples/mu1-muse-tts/alloy.mp3', text: SAMPLE_TEXT, note: '对应模型与音色编号生成的样音', provenance: { provider: '沧元算力', modelId: 'mu1-muse-tts', voiceId: 'alloy', generatedAt: '2026-11-19' } },
    aria: { url: '/audio/voice-samples/mu1-muse-tts/aria.mp3', text: SAMPLE_TEXT, note: '对应模型与音色编号生成的样音', provenance: { provider: '沧元算力', modelId: 'mu1-muse-tts', voiceId: 'aria', generatedAt: '2026-11-19' } },
    coral: { url: '/audio/voice-samples/mu1-muse-tts/coral.mp3', text: SAMPLE_TEXT, note: '对应模型与音色编号生成的样音', provenance: { provider: '沧元算力', modelId: 'mu1-muse-tts', voiceId: 'coral', generatedAt: '2026-11-19' } },
    nova: { url: '/audio/voice-samples/mu1-muse-tts/nova.mp3', text: SAMPLE_TEXT, note: '对应模型与音色编号生成的样音', provenance: { provider: '沧元算力', modelId: 'mu1-muse-tts', voiceId: 'nova', generatedAt: '2026-11-19' } },
    shimmer: { url: '/audio/voice-samples/mu1-muse-tts/shimmer.mp3', text: SAMPLE_TEXT, note: '对应模型与音色编号生成的样音', provenance: { provider: '沧元算力', modelId: 'mu1-muse-tts', voiceId: 'shimmer', generatedAt: '2026-11-19' } },
  }),
});

export function getSpeechVoiceSample(publicModel: string, voice: string): SpeechVoiceSample | null {
  return SPEECH_VOICE_SAMPLES[String(publicModel || '')]?.[String(voice || '')] || null;
}
