import type {
  AudioModelClassification,
  AudioModelClassificationSuggestion,
  AudioModelPurpose,
  ModelClassificationEvidence,
  ModelClassificationSource,
} from '@/packages/contracts/model-classification';
import { getSpeechModelProfile } from '@/packages/contracts/audio-synthesis';
import { getCangyuanMusicModelProfile } from '@/packages/contracts/cangyuan-media';

export type AudioModelClassificationInput = {
  modelId: string;
  displayName?: string;
  /** Provider-declared capabilities, endpoint metadata, or official catalog fields. */
  declaredCapabilities?: readonly string[];
  metadata?: unknown;
  endpoint?: string;
  providerPlatform?: string;
  /** A provider adapter may pass a confirmed purpose from its own catalog. */
  officialPurposes?: readonly AudioModelPurpose[];
  adapterPurposes?: readonly AudioModelPurpose[];
};

const PURPOSE_ORDER: readonly Exclude<AudioModelPurpose, 'unknown'>[] = [
  'speech',
  'transcription',
  'music',
  'sound-effect',
  'conversation',
];

const PURPOSE_LABELS: Record<AudioModelPurpose, string> = {
  speech: '配音',
  transcription: '语音转写',
  music: '音乐',
  'sound-effect': '音效',
  conversation: '音频对话',
  unknown: '音频用途待确认',
};

function uniquePurposes(values: readonly AudioModelPurpose[]) {
  const set = new Set(values.filter((value): value is Exclude<AudioModelPurpose, 'unknown'> => value !== 'unknown'));
  return PURPOSE_ORDER.filter((purpose) => set.has(purpose));
}

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try { return JSON.stringify(value) || ''; } catch { return ''; }
}

function declaredPurpose(value: string): AudioModelPurpose | null {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!normalized) return null;
  if (/(?:sound effect|sound effects|sfx|foley|音效)/.test(normalized)) return 'sound-effect';
  if (/(?:transcription|speech to text|automatic speech recognition|\basr\b|\bstt\b|语音识别|转写)/.test(normalized)) return 'transcription';
  if (/(?:text to speech|speech synthesis|voice synthesis|\btts\b|配音|语音合成)/.test(normalized)) return 'speech';
  if (/(?:music generation|music generate|text to music|song generation|音乐生成|音乐)/.test(normalized)) return 'music';
  if (/(?:dialogue|conversation|audio chat|audio conversation|音频对话)/.test(normalized)) return 'conversation';
  return null;
}

function declaredCapabilityPurpose(value: string): AudioModelPurpose | null {
  switch (value.trim().toLowerCase()) {
    case 'speech': return 'speech';
    case 'transcription': return 'transcription';
    case 'music-generate': return 'music';
    case 'sound-effect': return 'sound-effect';
    case 'audio-conversation': return 'conversation';
    default: return null;
  }
}

function endpointPurpose(value: string): AudioModelPurpose | null {
  const normalized = value.trim().toLowerCase();
  if (/\/(?:audio\/)?(?:transcriptions?|transcribe)(?:\/|$)|\basr\b|speech[-_ ]?to[-_ ]?text/.test(normalized)) return 'transcription';
  if (/\/(?:audio\/)?(?:speech|tts)(?:\/|$)|text[-_ ]?to[-_ ]?speech/.test(normalized)) return 'speech';
  if (/\/(?:music\/)?(?:generations?|generate)(?:\/|$)/.test(normalized) && /music|song/.test(normalized)) return 'music';
  if (/sound[-_ ]?effects?|\bsfx\b|foley/.test(normalized)) return 'sound-effect';
  return null;
}

function purposesFromValues(values: readonly unknown[]) {
  return uniquePurposes(values.flatMap((value) => {
    const text = String(value);
    const purpose = declaredCapabilityPurpose(text) || declaredPurpose(text);
    return purpose ? [purpose] : [];
  }));
}

function metadataText(input: AudioModelClassificationInput) {
  return [
    input.modelId,
    input.displayName || '',
    ...(input.declaredCapabilities || []),
    textFromUnknown(input.metadata),
  ].join(' ').toLowerCase();
}

function evidence(kind: ModelClassificationEvidence['kind'], values: readonly string[]) {
  return values.filter(Boolean).map((value) => ({ kind, value }));
}

function buildResult(
  purposes: readonly AudioModelPurpose[],
  source: ModelClassificationSource,
  confidence: AudioModelClassification['confidence'],
  evidenceItems: readonly ModelClassificationEvidence[],
): AudioModelClassification {
  const normalized = uniquePurposes(purposes);
  return {
    purposes: normalized,
    source,
    confidence,
    evidence: evidenceItems,
    requiresReview: normalized.length === 0 || source === 'local-ai-suggested' || confidence === 'low',
  };
}

/**
 * Classify an audio model without allowing a heuristic or local model to
 * override an official/provider declaration. Empty results stay out of task
 * panels until a human or adapter supplies a confirmed purpose.
 */
export function classifyAudioModelPurpose(input: AudioModelClassificationInput): AudioModelClassification {
  const catalogPurposes = input.providerPlatform === 'cangyuan' ? cangyuanCatalogPurposes(input.modelId) : [];
  const official = uniquePurposes([...(input.officialPurposes || []), ...catalogPurposes]);
  if (official.length) {
    return buildResult(official, 'official', 'high', evidence('official', official.map((purpose) => PURPOSE_LABELS[purpose])));
  }

  const adapter = uniquePurposes(input.adapterPurposes || []);
  if (adapter.length) {
    return buildResult(adapter, 'adapter', 'high', evidence('endpoint', adapter.map((purpose) => PURPOSE_LABELS[purpose])));
  }

  const declaredValues = [
    ...(input.declaredCapabilities || []),
    textFromUnknown(input.metadata),
  ];
  const metadataPurposes = purposesFromValues(declaredValues);
  if (metadataPurposes.length) {
    return buildResult(metadataPurposes, 'provider-metadata', 'high', [
      ...evidence('metadata', (input.declaredCapabilities || []).slice(0, 8).map((value) => `厂商能力字段：${value}`)),
      ...(input.metadata ? [{ kind: 'metadata' as const, value: '厂商模型说明或目录字段' }] : []),
    ]);
  }

  const endpointClassification = endpointPurpose(input.endpoint || '') || declaredPurpose(input.endpoint || '');
  if (endpointClassification) {
    return buildResult([endpointClassification], 'adapter', 'high', evidence('endpoint', [input.endpoint || '']));
  }

  const text = metadataText(input);
  const heuristicValues: Array<[AudioModelPurpose, RegExp]> = [
    ['sound-effect', /(?:sound[-_ ]?effect|sfx|foley)/],
    ['transcription', /(?:whisper|transcri|\basr\b|\bstt\b|speech[-_ ]?to[-_ ]?text)/],
    ['speech', /(?:tts|text[-_ ]?to[-_ ]?speech|speech[-_ ]?(?:synth|generation)|cosyvoice|elevenlabs|voice[-_ ]?clone)/],
    ['music', /(?:\bmusic\b|\bsong\b|suno|lyria|(?:^|[^a-z0-9])udio(?:[^a-z0-9]|$)|melody)/],
    ['conversation', /(?:dialogue|conversation|audio[-_ ]?chat|audio[-_ ]?conversation)/],
  ];
  const matched = heuristicValues.filter(([, pattern]) => pattern.test(text)).map(([purpose]) => purpose);
  if (matched.length) {
    return buildResult(matched, 'heuristic', 'medium', evidence('model-id', [input.modelId, input.displayName || '']));
  }

  return buildResult([], 'heuristic', 'low', evidence('model-id', [input.modelId, input.displayName || '']));
}

function cangyuanCatalogPurposes(modelId: string): AudioModelPurpose[] {
  const id = String(modelId || '').split('/').pop()?.split(':').pop()?.toLowerCase() || '';
  if (getSpeechModelProfile(id, 'cangyuan')) return ['speech'];
  if (id === 'mu1-muse-asr') return ['transcription'];
  if (id === 'mu1-muse-audio') return ['conversation'];
  const musicProfile = getCangyuanMusicModelProfile(id);
  if (!musicProfile) return [];
  return musicProfile.family === 'suno-sfx' || musicProfile.family === 'elevenlabs-sfx' ? ['sound-effect'] : ['music'];
}

/** Build a strict JSON-only prompt for an optional local model suggestion. */
export function buildAudioModelClassificationPrompt(input: AudioModelClassificationInput) {
  return [
    '请判断下面音频模型的用途，只能从 speech、transcription、music、sound-effect、conversation 中选择一个或多个。',
    '不要根据厂商名称猜测；优先依据模型名称、接口路径、能力字段和说明。无法确认时返回空数组。',
    '只返回 JSON，不要 Markdown：{"purposes":["speech"],"confidence":"medium","reason":"..."}',
    JSON.stringify({
      modelId: input.modelId,
      displayName: input.displayName || '',
      declaredCapabilities: input.declaredCapabilities || [],
      metadata: input.metadata || null,
      endpoint: input.endpoint || '',
    }),
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Parse, validate, and normalize a local model suggestion. */
export function parseAudioModelClassificationSuggestion(value: unknown): AudioModelClassificationSuggestion | null {
  let candidate: unknown = value;
  if (typeof value === 'string') {
    try { candidate = JSON.parse(value); } catch { return null; }
  }
  if (!isRecord(candidate) || !Array.isArray(candidate.purposes)) return null;
  const purposes = uniquePurposes(candidate.purposes.filter((item): item is AudioModelPurpose => typeof item === 'string'));
  if (!purposes.length) return null;
  const confidence = candidate.confidence === 'medium' || candidate.confidence === 'low' ? candidate.confidence : null;
  if (!confidence) return null;
  return {
    purposes,
    confidence,
    ...(typeof candidate.reason === 'string' && candidate.reason.trim() ? { reason: candidate.reason.trim().slice(0, 300) } : {}),
  };
}

/**
 * Apply an AI suggestion only when deterministic classification is unresolved.
 * The result remains reviewable and carries AI evidence; it is never promoted
 * to an official/provider classification automatically.
 */
export function applyAudioModelClassificationSuggestion(
  current: AudioModelClassification,
  suggestion: AudioModelClassificationSuggestion | null,
): AudioModelClassification {
  if (!suggestion || current.purposes.length || current.source === 'official' || current.source === 'provider-metadata' || current.source === 'adapter' || current.source === 'manual') return current;
  return buildResult(
    suggestion.purposes,
    'local-ai-suggested',
    suggestion.confidence,
    [
      ...current.evidence,
      { kind: 'ai', value: suggestion.reason || '本地大模型分类建议' },
    ],
  );
}

export function audioModelPurposeLabel(purpose: AudioModelPurpose) {
  return PURPOSE_LABELS[purpose];
}
