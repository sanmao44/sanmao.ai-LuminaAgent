import voices from './minimax-system-voices.json';
import { CANGYUAN_MINIMAX_VOICES } from './cangyuan-minimax-voices';
import { cangyuanMiniMaxVoiceLabel } from './cangyuan-minimax-voice-labels';

export type MiniMaxSystemVoice = {
  number: number;
  language: string;
  languageLabel: string;
  voiceId: string;
  name: string;
  originalName?: string;
};

type OfficialVoice = Omit<MiniMaxSystemVoice, 'languageLabel'>;

const OFFICIAL_VOICES = voices as readonly OfficialVoice[];

const LANGUAGE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  '中文 (普通话)': '中文（普通话）',
  '中文 (粤语)': '中文（粤语）',
  '英文': '英语',
  '日文': '日语',
  '韩文': '韩语',
  '西班牙文': '西班牙语',
  '葡萄牙文': '葡萄牙语',
  '法文': '法语',
  '印尼文': '印度尼西亚语',
  '德文': '德语',
  '俄文': '俄语',
  '意大利文': '意大利语',
  '阿拉伯文': '阿拉伯语',
  '土耳其文': '土耳其语',
  '乌克兰文': '乌克兰语',
  '荷兰文': '荷兰语',
  '越南文': '越南语',
  '泰文': '泰语',
  '波兰文': '波兰语',
  '罗马尼亚文': '罗马尼亚语',
  '希腊文': '希腊语',
  '捷克文': '捷克语',
  '芬兰文': '芬兰语',
  '印地文': '印地语',
});

export const MINIMAX_SYSTEM_VOICE_SOURCE = 'https://platform.minimaxi.com/docs/faq/system-voice-id.md';
export const MINIMAX_SYSTEM_VOICE_COUNT = OFFICIAL_VOICES.length;

export const MINIMAX_SYSTEM_VOICES: readonly MiniMaxSystemVoice[] = Object.freeze(
  OFFICIAL_VOICES.map((voice) => Object.freeze({
    ...voice,
    languageLabel: LANGUAGE_LABELS[voice.language] || voice.language,
  })),
);

const CANGYUAN_DISPLAY_VOICES: readonly MiniMaxSystemVoice[] = Object.freeze(
  CANGYUAN_MINIMAX_VOICES.map((voice) => Object.freeze({
    ...voice,
    originalName: voice.name,
    name: cangyuanMiniMaxVoiceLabel(voice.name),
  })),
);

export function getMiniMaxSystemVoices(providerKey?: string): readonly MiniMaxSystemVoice[] {
  return providerKey === 'cangyuan' ? CANGYUAN_DISPLAY_VOICES : MINIMAX_SYSTEM_VOICES;
}

export function findMiniMaxSystemVoice(voiceId: string, providerKey?: string): MiniMaxSystemVoice | undefined {
  const voice = getMiniMaxSystemVoices(providerKey).find((voice) => voice.voiceId === voiceId);
  // Existing documents retain their exact original IDs; names never migrate an ID.
  return voice || (providerKey === 'cangyuan' ? MINIMAX_SYSTEM_VOICES.find((voice) => voice.voiceId === voiceId) : undefined);
}

export function searchMiniMaxSystemVoices(query: string, providerKey?: string): readonly MiniMaxSystemVoice[] {
  const normalized = String(query || '').trim().toLocaleLowerCase();
  const directory = getMiniMaxSystemVoices(providerKey);
  if (!normalized) return directory;
  return directory.filter((voice) => [
    voice.voiceId,
    voice.name,
    voice.originalName || '',
    voice.language,
    voice.languageLabel,
  ].some((candidate) => candidate.toLocaleLowerCase().includes(normalized)));
}
