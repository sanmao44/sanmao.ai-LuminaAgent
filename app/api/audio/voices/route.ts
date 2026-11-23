import { isTrustedAppRequest } from '@/lib/auth';
import { beginRuntimeRequest, RuntimeDrainingError } from '@/lib/runtime-operation';
import {
  SpeechVoiceProviderError,
  SpeechVoiceRegistrationInputError,
  SpeechVoiceRegistrationUnavailableError,
} from '@/apps/api/audio-voice-registration-application';
import { listConfiguredSpeechVoices, registerConfiguredSpeechVoice } from '@/apps/api/audio-voice-registration-composition';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_REQUEST_BYTES = 24_000;

function responseForError(error: unknown) {
  if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message }, { status: 409 });
  if (error instanceof SpeechVoiceRegistrationInputError) return Response.json({ error: error.message }, { status: 400 });
  if (error instanceof SpeechVoiceRegistrationUnavailableError) return Response.json({ error: error.message }, { status: 422 });
  if (error instanceof SpeechVoiceProviderError) return Response.json({ error: error.message, resultUnconfirmed: error.resultUnconfirmed }, { status: error.resultUnconfirmed ? 504 : 502 });
  return Response.json({ error: error instanceof Error ? error.message : '声音接口请求失败。', resultUnconfirmed: true }, { status: 502 });
}

export async function GET(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  let releaseRuntimeRequest = async () => {};
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('audio-voice-list');
    const url = new URL(request.url);
    const voices = await listConfiguredSpeechVoices({
      modelId: url.searchParams.get('modelId'),
      registrationModel: url.searchParams.get('registrationModel'),
    }, AbortSignal.any([request.signal, AbortSignal.timeout(35_000)]));
    return Response.json({ voices }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return responseForError(error);
  } finally {
    await releaseRuntimeRequest();
  }
}

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) return Response.json({ error: '声音登记请求内容过大。' }, { status: 413 });
  let releaseRuntimeRequest = async () => {};
  try {
    releaseRuntimeRequest = await beginRuntimeRequest('audio-voice-registration');
    let body: unknown;
    try { body = await request.json(); } catch {
      return Response.json({ error: '声音登记请求格式无效。' }, { status: 400 });
    }
    const voice = await registerConfiguredSpeechVoice(body, AbortSignal.any([request.signal, AbortSignal.timeout(280_000)]));
    return Response.json({ voice }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return responseForError(error);
  } finally {
    await releaseRuntimeRequest();
  }
}
