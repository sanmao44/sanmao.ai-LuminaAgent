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
    onProgress?: (stage: 'loading-model' | 'transcribing') => void;
  }) => Promise<LocalTranscriptionResult>;
  formatSrt: (segments: readonly LocalTranscriptionResult['segments'][number][]) => string;
  saveSubtitle: (input: { name: string; mimeType: string; data: Uint8Array }) => Promise<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    downloadUrl: string;
  }>;
};

function subtitleName(audioName: string) {
  const base = audioName.replace(/\\/g, '/').split('/').pop() || 'audio';
  const withoutExtension = base.replace(/\.[^.]+$/, '').trim() || 'audio';
  return `${withoutExtension}.srt`;
}

export async function generateAudioSubtitle(
  input: AudioTranscriptionInput,
  ports: AudioTranscriptionPorts,
  onProgress?: (stage: 'loading-model' | 'transcribing') => void,
) {
  if (!input.audio.artifactId.trim()) throw new Error('Audio attachment is missing or expired. Upload it again.');
  const result = await ports.transcribeAudio({
    artifactId: input.audio.artifactId,
    ...(input.referenceText?.trim() ? { referenceText: input.referenceText.trim().slice(0, 12_000) } : {}),
    onProgress,
  });
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
