import type { LocalTranscriptionResult } from '@/packages/contracts/transcription';
import type { AudioTranscriptionModelSelection, AudioTranscriptionRequest, AudioTranscriptionResult } from '@/packages/contracts/audio-transcription';

export const AUDIO_TRANSCRIPTION_MAX_BYTES = 50 * 1024 * 1024;

const AUDIO_FILE_TYPES: Readonly<Record<string, string>> = Object.freeze({
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  webm: 'audio/webm',
  pcm: 'audio/pcm',
});

export class AudioTranscriptionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioTranscriptionInputError';
  }
}

export type AudioTranscriptionApplicationPorts = {
  transcribe: (input: AudioTranscriptionRequest, signal?: AbortSignal) => Promise<Omit<AudioTranscriptionResult, 'responseFormat' | 'temperature'>>;
  startLog: (input: { mode: 'audio'; taskKind: 'media'; mediaKind: 'audio'; prompt: string; requestedModelId: string; format: string; temperature: number; sourceAudioName: string; transcriptionLanguage?: string }) => Promise<string>;
  finishLog: (id: string, patch: { status: 'success' | 'error'; durationMs: number; modelId?: string; modelName?: string; textResult?: string; transcriptionSegments?: Array<{ start: number; end: number; text: string }>; transcriptionLanguage?: string; transcriptionResponseFormat?: string; temperature?: number; error?: string }) => Promise<void>;
};

function parseUploadedTranscription(input: unknown): AudioTranscriptionRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AudioTranscriptionInputError('转写请求格式无效。');
  const value = input as Record<string, unknown>;
  const modelId = typeof value.modelId === 'string' ? value.modelId.trim() : '';
  if (!modelId || modelId.length > 240) throw new AudioTranscriptionInputError('请选择有效的转写模型。');
  const file = value.file && typeof value.file === 'object' && !Array.isArray(value.file)
    ? value.file as Record<string, unknown>
    : {};
  const rawName = typeof file.name === 'string' ? file.name.replace(/\\/g, '/').split('/').pop() || '' : '';
  const extension = rawName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || '';
  const expectedMime = AUDIO_FILE_TYPES[extension];
  if (!expectedMime) throw new AudioTranscriptionInputError('音频仅支持 MP3、WAV、OGG、M4A、FLAC、WebM 或 PCM。');
  const suppliedMime = typeof file.mimeType === 'string' ? file.mimeType.split(';', 1)[0].trim().toLowerCase() : '';
  const mime = suppliedMime === 'audio/x-wav' ? 'audio/wav' : suppliedMime === 'audio/x-flac' ? 'audio/flac' : suppliedMime === 'audio/x-m4a' ? 'audio/mp4' : suppliedMime;
  if (mime && mime !== expectedMime && mime !== 'application/octet-stream'
    && !(extension === 'webm' && mime === 'video/webm')) {
    throw new AudioTranscriptionInputError('音频扩展名与文件格式不一致。');
  }
  const bytes = file.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new AudioTranscriptionInputError('音频文件为空。');
  if (bytes.byteLength > AUDIO_TRANSCRIPTION_MAX_BYTES) throw new AudioTranscriptionInputError('音频文件不能超过 50 MiB。');
  const language = typeof value.language === 'string' ? value.language.trim() : '';
  if (language && !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language)) throw new AudioTranscriptionInputError('语言代码格式无效。');
  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
  if (prompt.length > 12_000) throw new AudioTranscriptionInputError('识别提示最多 12,000 个字符。');
  const responseFormat = value.responseFormat === undefined ? 'verbose_json' : value.responseFormat;
  if (typeof responseFormat !== 'string' || !/^[a-z0-9_-]{1,80}$/i.test(responseFormat)) {
    throw new AudioTranscriptionInputError('转写结果格式无效。');
  }
  const temperature = value.temperature === undefined ? 0 : value.temperature;
  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
    throw new AudioTranscriptionInputError('温度范围应为 0 到 1。');
  }
  return {
    modelId,
    file: { name: rawName.slice(0, 180), mimeType: expectedMime, bytes },
    ...(language ? { language } : {}),
    ...(prompt ? { prompt } : {}),
    responseFormat,
    temperature,
  };
}

export async function transcribeUploadedAudio(
  input: unknown,
  ports: AudioTranscriptionApplicationPorts,
  signal?: AbortSignal,
): Promise<AudioTranscriptionResult> {
  const request = parseUploadedTranscription(input);
  const startedAt = Date.now();
  const logId = await ports.startLog({
    mode: 'audio', taskKind: 'media', mediaKind: 'audio',
    prompt: `音频转写：${request.file.name}`,
    requestedModelId: request.modelId,
    format: request.responseFormat || 'verbose_json',
    temperature: request.temperature ?? 0,
    sourceAudioName: request.file.name,
    ...(request.language ? { transcriptionLanguage: request.language } : {}),
  });
  try {
    const result = await ports.transcribe(request, signal);
    const output: AudioTranscriptionResult = {
      ...result,
      responseFormat: request.responseFormat || 'verbose_json',
      temperature: request.temperature ?? 0,
    };
    await ports.finishLog(logId, {
      status: 'success', durationMs: Date.now() - startedAt,
      modelId: output.modelId, modelName: output.modelName, textResult: output.text,
      ...(output.segments?.length ? { transcriptionSegments: output.segments } : {}),
      ...(output.language || request.language ? { transcriptionLanguage: output.language || request.language } : {}),
      transcriptionResponseFormat: output.responseFormat, temperature: output.temperature,
    }).catch(() => { output.historyError = '转写已完成，但记录保存失败。请先复制或下载本次文字。'; });
    return output;
  } catch (error) {
    await ports.finishLog(logId, {
      status: 'error', durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : '音频转写失败。',
    }).catch(() => undefined);
    throw error;
  }
}

export type AudioTranscriptionInput = {
  audio: { artifactId: string; name: string; mimeType: string; size?: number };
  referenceText?: string;
  modelSelection?: AudioTranscriptionModelSelection;
};

export type AudioTranscriptionEngine = 'local' | 'cloud' | 'cloud-with-local-timing';

export type AudioTranscriptionOutputFile = {
  name: string;
  mimeType: string;
  size: number;
  artifactId: string;
  downloadUrl: string;
};

export type AudioTranscriptionPorts = {
  transcribeAudio: (input: {
    artifactId: string;
    referenceText?: string;
    signal?: AbortSignal;
    onProgress?: (stage: 'loading-model' | 'transcribing') => void;
  }) => Promise<LocalTranscriptionResult>;
  getCloudTranscriber?: (selection?: AudioTranscriptionModelSelection) => Promise<((input: {
    artifactId: string;
    referenceText?: string;
    signal?: AbortSignal;
    onProgress?: (stage: 'loading-model' | 'transcribing') => void;
  }) => Promise<LocalTranscriptionResult>) | null>;
  alignCloudTranscript?: (
    cloud: LocalTranscriptionResult,
    local: LocalTranscriptionResult,
    referenceText?: string,
  ) => LocalTranscriptionResult | null;
  applyReferenceText?: (transcript: LocalTranscriptionResult, referenceText?: string) => LocalTranscriptionResult;
  formatSrt: (segments: readonly LocalTranscriptionResult['segments'][number][]) => string;
  saveSubtitle: (input: { name: string; mimeType: string; data: Uint8Array }) => Promise<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    downloadUrl: string;
  }>;
};

export type AudioRecognitionPorts = Pick<AudioTranscriptionPorts,
  'transcribeAudio' | 'getCloudTranscriber' | 'alignCloudTranscript' | 'applyReferenceText'>;

function hasTimedSegments(result: LocalTranscriptionResult) {
  return result.segments.some((segment) => (
    Number.isFinite(segment.start)
    && Number.isFinite(segment.end)
    && segment.end > segment.start
    && Boolean(segment.text.trim())
  ));
}

async function transcribeWithConfiguredProvider(
  input: { artifactId: string; referenceText?: string; modelSelection?: AudioTranscriptionModelSelection },
  ports: AudioRecognitionPorts,
  signal?: AbortSignal,
  onProgress?: (stage: 'loading-model' | 'transcribing') => void,
  requireTiming = true,
) {
  const localInput = { ...input, ...(signal ? { signal } : {}), ...(onProgress ? { onProgress } : {}) };
  const transcribeLocally = async () => ({
    transcript: await ports.transcribeAudio(localInput),
    engine: 'local' as const,
  });
  let cloudTranscriber: Awaited<ReturnType<NonNullable<AudioTranscriptionPorts['getCloudTranscriber']>>> = null;
  try { cloudTranscriber = await ports.getCloudTranscriber?.(input.modelSelection) || null; } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
  }
  if (signal?.aborted) throw signal.reason || new Error('Transcription cancelled');
  if (!cloudTranscriber) return transcribeLocally();

  let cloud: LocalTranscriptionResult;
  try {
    onProgress?.('transcribing');
    cloud = await cloudTranscriber(localInput);
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    return transcribeLocally();
  }
  if (hasTimedSegments(cloud)) return { transcript: ports.applyReferenceText?.(cloud, input.referenceText) || cloud, engine: 'cloud' as const };
  if (!cloud.text.trim()) return transcribeLocally();
  if (!requireTiming) return { transcript: ports.applyReferenceText?.(cloud, input.referenceText) || cloud, engine: 'cloud' as const };

  const localTiming = await ports.transcribeAudio(localInput);
  if (signal?.aborted) throw signal.reason || new Error('Transcription cancelled');
  const aligned = ports.alignCloudTranscript?.(cloud, localTiming, input.referenceText);
  return aligned && hasTimedSegments(aligned)
    ? { transcript: aligned, engine: 'cloud-with-local-timing' as const }
    : { transcript: localTiming, engine: 'local' as const };
}

function subtitleName(audioName: string) {
  const base = audioName.replace(/\\/g, '/').split('/').pop() || 'audio';
  const withoutExtension = base.replace(/\.[^.]+$/, '').trim() || 'audio';
  return `${withoutExtension}.srt`;
}

export async function recognizeAudio(
  input: AudioTranscriptionInput,
  ports: AudioRecognitionPorts,
  onProgress?: (stage: 'loading-model' | 'transcribing') => void,
  signal?: AbortSignal,
  options: { requireTiming?: boolean } = {},
) {
  if (!input.audio.artifactId.trim()) throw new Error('Audio attachment is missing or expired. Upload it again.');
  return transcribeWithConfiguredProvider({
    artifactId: input.audio.artifactId,
    ...(input.referenceText?.trim() ? { referenceText: input.referenceText.trim().slice(0, 12_000) } : {}),
    ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
  }, ports, signal, onProgress, options.requireTiming ?? false);
}

export async function generateAudioSubtitle(
  input: AudioTranscriptionInput,
  ports: AudioTranscriptionPorts,
  onProgress?: (stage: 'loading-model' | 'transcribing') => void,
  signal?: AbortSignal,
) {
  const { transcript, engine } = await recognizeAudio(input, ports, onProgress, signal, { requireTiming: true });
  const srt = ports.formatSrt(transcript.segments);
  if (!srt) throw new Error('No usable speech segments were recognized in the audio.');
  const saved = await ports.saveSubtitle({
    name: subtitleName(input.audio.name),
    mimeType: 'application/x-subrip;charset=utf-8',
    data: new TextEncoder().encode(srt),
  });
  return {
    transcript,
    engine,
    file: {
      name: saved.name,
      mimeType: saved.mimeType,
      size: saved.size,
      artifactId: saved.id,
      downloadUrl: saved.downloadUrl,
    } satisfies AudioTranscriptionOutputFile,
  };
}
