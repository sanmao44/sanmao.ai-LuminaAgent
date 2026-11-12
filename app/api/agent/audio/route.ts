import { handleAudioAttachmentRequest } from '@/apps/api/audio-attachment-transport';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  return handleAudioAttachmentRequest(request);
}
