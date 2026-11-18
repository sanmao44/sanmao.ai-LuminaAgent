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
  'elevenlabs-v4-tts': Object.freeze({
    Rachel: { url: '/audio/voice-samples/elevenlabs-v4-tts/rachel.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Aria: { url: '/audio/voice-samples/elevenlabs-v4-tts/aria.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Roger: { url: '/audio/voice-samples/elevenlabs-v4-tts/roger.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Sarah: { url: '/audio/voice-samples/elevenlabs-v4-tts/sarah.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Laura: { url: '/audio/voice-samples/elevenlabs-v4-tts/laura.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Charlie: { url: '/audio/voice-samples/elevenlabs-v4-tts/charlie.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    George: { url: '/audio/voice-samples/elevenlabs-v4-tts/george.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Callum: { url: '/audio/voice-samples/elevenlabs-v4-tts/callum.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    River: { url: '/audio/voice-samples/elevenlabs-v4-tts/river.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Liam: { url: '/audio/voice-samples/elevenlabs-v4-tts/liam.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Charlotte: { url: '/audio/voice-samples/elevenlabs-v4-tts/charlotte.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Alice: { url: '/audio/voice-samples/elevenlabs-v4-tts/alice.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Matilda: { url: '/audio/voice-samples/elevenlabs-v4-tts/matilda.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Will: { url: '/audio/voice-samples/elevenlabs-v4-tts/will.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Jessica: { url: '/audio/voice-samples/elevenlabs-v4-tts/jessica.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Eric: { url: '/audio/voice-samples/elevenlabs-v4-tts/eric.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Chris: { url: '/audio/voice-samples/elevenlabs-v4-tts/chris.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Brian: { url: '/audio/voice-samples/elevenlabs-v4-tts/brian.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Daniel: { url: '/audio/voice-samples/elevenlabs-v4-tts/daniel.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Lily: { url: '/audio/voice-samples/elevenlabs-v4-tts/lily.mp3', text: SAMPLE_TEXT, note: '模型样音' },
    Bill: { url: '/audio/voice-samples/elevenlabs-v4-tts/bill.mp3', text: SAMPLE_TEXT, note: '模型样音' },
  }),
});

export function getSpeechVoiceSample(publicModel: string, voice: string): SpeechVoiceSample | null {
  return SPEECH_VOICE_SAMPLES[String(publicModel || '')]?.[String(voice || '')] || null;
}
