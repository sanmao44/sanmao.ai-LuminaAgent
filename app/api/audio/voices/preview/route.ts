import { isTrustedAppRequest } from '@/lib/auth';
import { beginRuntimeRequest, RuntimeDrainingError } from '@/lib/runtime-operation';
import {
  SpeechVoiceProviderError,
  SpeechVoiceRegistrationInputError,
  SpeechVoiceRegistrationUnavailableError,
} from '@/apps/api/audio-voice-registration-application';
import { previewConfiguredSpeechVoice } from '@/apps/api/audio-voice-registration-composition';

export const runtime = 'nodejs';
export const maxDuration = 40;

function responseForError(error: unknown) {
  if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message }, { status: 409 });
  if (error instanceof SpeechVoiceRegistrationInputError) return Response.json({ error: error.message }, { status: 400 });
  if (error instanceof SpeechVoiceRegistrationUnavailableError) return Response.json({ error: error.message }, { status: 422 });
  if (error instanceof SpeechVoiceProviderError) return Response.json({ error: error.message }, { status: error.resultUnconfirmed ? 504 : 502 });
  return Response.json({ error: error instanceof Error ? error.message : '音色试听失败。' }, { status: 502 });
}

export async function GET(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  let releaseRuntimeRequest = async () => {};
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('audio-voice-preview');
    const url = new URL(request.url);
    const preview = await previewConfiguredSpeechVoice({
      modelId: url.searchParams.get('modelId'),
      registrationModel: url.searchParams.get('registrationModel'),
      previewUrl: url.searchParams.get('previewUrl'),
    }, AbortSignal.any([request.signal, AbortSignal.timeout(35_000)]));
    return new Response(preview.body, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Length': String(preview.body.byteLength),
        'Content-Type': preview.contentType,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return responseForError(error);
  } finally {
    await releaseRuntimeRequest();
  }
}
