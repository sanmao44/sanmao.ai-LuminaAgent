export type SpeechVoiceSample = {
  url: string;
  text: string;
  note: string;
};

export const SAMPLE_TEXT = '你好，这是一段音色试听。';

const SPEECH_VOICE_SAMPLES: Readonly<Record<string, Readonly<Record<string, SpeechVoiceSample>>>> = Object.freeze({
  'gemini-tts': Object.freeze({
    Capella: { url: '/audio/voice-samples/gemini-tts/capella.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Ursa: { url: '/audio/voice-samples/gemini-tts/ursa.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Vega: { url: '/audio/voice-samples/gemini-tts/vega.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Eclipse: { url: '/audio/voice-samples/gemini-tts/eclipse.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Lyra: { url: '/audio/voice-samples/gemini-tts/lyra.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Orbit: { url: '/audio/voice-samples/gemini-tts/orbit.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Dipper: { url: '/audio/voice-samples/gemini-tts/dipper.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Nova: { url: '/audio/voice-samples/gemini-tts/nova.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Pegasus: { url: '/audio/voice-samples/gemini-tts/pegasus.mp3', text: SAMPLE_TEXT, note: '模型样音' },
  }),
  'mu1-muse-tts': Object.freeze({
    alloy: { url: '/audio/voice-samples/mu1-muse-tts/alloy.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    aria: { url: '/audio/voice-samples/mu1-muse-tts/aria.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    coral: { url: '/audio/voice-samples/mu1-muse-tts/coral.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    nova: { url: '/audio/voice-samples/mu1-muse-tts/nova.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    shimmer: { url: '/audio/voice-samples/mu1-muse-tts/shimmer.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    echo: { url: '/audio/voice-samples/mu1-muse-tts/echo.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    helio: { url: '/audio/voice-samples/mu1-muse-tts/helio.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    onyx: { url: '/audio/voice-samples/mu1-muse-tts/onyx.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    fable: { url: '/audio/voice-samples/mu1-muse-tts/fable.mp3', text: SAMPLE_TEXT, note: '模型样音' },
  }),
});

export function getSpeechVoiceSample(publicModel: string, voice: string): SpeechVoiceSample | null {
  return SPEECH_VOICE_SAMPLES[String(publicModel || '')]?.[String(voice || '')] || null;
}
