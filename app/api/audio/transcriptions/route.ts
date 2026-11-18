import { handleAudioTranscriptionRequest } from '@/apps/api/audio-transcription-transport';

export const runtime = 'nodejs';
export const maxDuration = 180;

export async function POST(request: Request) {
  return handleAudioTranscriptionRequest(request);
}
