import voices from './cangyuan-minimax-voices.json';
import type { MiniMaxSystemVoice } from './minimax-system-voices';

/** Cangyuan publishes its own voice IDs; they are not interchangeable with MiniMax IDs. */
export type CangyuanMiniMaxVoice = MiniMaxSystemVoice & {
  previewUrl: string;
};

export const CANGYUAN_MINIMAX_VOICE_SOURCE = 'https://ai.cangyuansuanli.cn/docs/chapters/minimax-speech';
export const CANGYUAN_MINIMAX_VOICE_DOCUMENT_SOURCE = 'https://ai.cangyuansuanli.cn/docs-static/getting-started/chapters/minimax/minimax-speech.md';
export const CANGYUAN_MINIMAX_VOICE_PREVIEW_ROOT = 'https://tmp.cangyuansuanli.cn/docs/minimax-speech/';

export const CANGYUAN_MINIMAX_VOICES: readonly CangyuanMiniMaxVoice[] = Object.freeze(
  voices.map((voice) => Object.freeze({ ...voice })),
);

export const CANGYUAN_MINIMAX_VOICE_COUNT = CANGYUAN_MINIMAX_VOICES.length;

export function findCangyuanMiniMaxVoice(voiceId: string): CangyuanMiniMaxVoice | undefined {
  return CANGYUAN_MINIMAX_VOICES.find((voice) => voice.voiceId === voiceId);
}
