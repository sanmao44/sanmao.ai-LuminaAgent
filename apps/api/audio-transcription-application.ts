import type { LocalTranscriptionResult } from '@/packages/contracts/transcription';

export type AudioTranscriptionInput = {
  audio: { artifactId: string; name: string; mimeType: string; size?: number };
  referenceText?: string;
};

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
  getCloudTranscriber?: () => Promise<((input: {
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

function hasTimedSegments(result: LocalTranscriptionResult) {
  return result.segments.some((segment) => (
    Number.isFinite(segment.start)
    && Number.isFinite(segment.end)
    && segment.end > segment.start
    && Boolean(segment.text.trim())
  ));
}

async function transcribeWithConfiguredProvider(
  input: { artifactId: string; referenceText?: string },
  ports: AudioTranscriptionPorts,
  signal?: AbortSignal,
  onProgress?: (stage: 'loading-model' | 'transcribing') => void,
) {
  const localInput = { ...input, ...(signal ? { signal } : {}), ...(onProgress ? { onProgress } : {}) };
  let cloudTranscriber: Awaited<ReturnType<NonNullable<AudioTranscriptionPorts['getCloudTranscriber']>>> = null;
  try { cloudTranscriber = await ports.getCloudTranscriber?.() || null; } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
  }
  if (signal?.aborted) throw signal.reason || new Error('Transcription cancelled');
  if (!cloudTranscriber) return ports.transcribeAudio(localInput);

  let cloud: LocalTranscriptionResult;
  try {
    onProgress?.('transcribing');
    cloud = await cloudTranscriber(localInput);
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    return ports.transcribeAudio(localInput);
  }
  if (hasTimedSegments(cloud)) return ports.applyReferenceText?.(cloud, input.referenceText) || cloud;
  if (!cloud.text.trim()) return ports.transcribeAudio(localInput);

  const localTiming = await ports.transcribeAudio(localInput);
  if (signal?.aborted) throw signal.reason || new Error('Transcription cancelled');
  const aligned = ports.alignCloudTranscript?.(cloud, localTiming, input.referenceText);
  return aligned && hasTimedSegments(aligned) ? aligned : localTiming;
}

function subtitleName(audioName: string) {
  const base = audioName.replace(/\\/g, '/').split('/').pop() || 'audio';
  const withoutExtension = base.replace(/\.[^.]+$/, '').trim() || 'audio';
  return `${withoutExtension}.srt`;
}

export async function generateAudioSubtitle(
  input: AudioTranscriptionInput,
  ports: AudioTranscriptionPorts,
  onProgress?: (stage: 'loading-model' | 'transcribing') => void,
  signal?: AbortSignal,
) {
  if (!input.audio.artifactId.trim()) throw new Error('Audio attachment is missing or expired. Upload it again.');
  const result = await transcribeWithConfiguredProvider({
    artifactId: input.audio.artifactId,
    ...(input.referenceText?.trim() ? { referenceText: input.referenceText.trim().slice(0, 12_000) } : {}),
  }, ports, signal, onProgress);
  const srt = ports.formatSrt(result.segments);
  if (!srt) throw new Error('No usable speech segments were recognized in the audio.');
  const saved = await ports.saveSubtitle({
    name: subtitleName(input.audio.name),
    mimeType: 'application/x-subrip;charset=utf-8',
    data: new TextEncoder().encode(srt),
  });
  return {
    transcript: result,
    file: {
      name: saved.name,
      mimeType: saved.mimeType,
      size: saved.size,
      artifactId: saved.id,
      downloadUrl: saved.downloadUrl,
    } satisfies AudioTranscriptionOutputFile,
  };
}
