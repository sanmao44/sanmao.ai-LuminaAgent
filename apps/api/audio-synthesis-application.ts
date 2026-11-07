import type { AudioSynthesisPort, AudioSynthesisRequest, AudioSynthesisResult } from '@/packages/contracts/audio-synthesis';

const MAX_AUDIO_SYNTHESIS_TEXT_LENGTH = 5000;
export const MAX_AUDIO_SYNTHESIS_BYTES = 50 * 1024 * 1024;

export class AudioSynthesisInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioSynthesisInputError';
  }
}

export class AudioSynthesisUnavailableError extends Error {
  constructor(message = '当前没有可用的配音模型或本机语音引擎。请在模型库启用配音模型后重试。') {
    super(message);
    this.name = 'AudioSynthesisUnavailableError';
  }
}

function parseRequest(input: unknown): AudioSynthesisRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AudioSynthesisInputError('配音请求格式无效。');
  }
  const source = input as Record<string, unknown>;
  if (typeof source.text !== 'string' || !source.text.trim()) {
    throw new AudioSynthesisInputError('请先输入配音文本。');
  }
  const text = source.text.trim();
  if (text.length > MAX_AUDIO_SYNTHESIS_TEXT_LENGTH) {
    throw new AudioSynthesisInputError(`配音文本最多 ${MAX_AUDIO_SYNTHESIS_TEXT_LENGTH} 个字符。`);
  }
  const voice = typeof source.voice === 'string' ? source.voice.trim() : '';
  if (voice.length > 100) throw new AudioSynthesisInputError('音色名称最多 100 个字符。');
  const sourceName = source.source === 'workspace' || source.source === 'agent' || source.source === 'canvas'
    ? source.source
    : undefined;
  const projectId = typeof source.projectId === 'string' ? source.projectId.trim().slice(0, 160) : '';
  const canvasId = typeof source.canvasId === 'string' ? source.canvasId.trim().slice(0, 160) : '';
  const nodeId = typeof source.nodeId === 'string' ? source.nodeId.trim().slice(0, 160) : '';
  return {
    text,
    ...(voice ? { voice } : {}),
    ...(sourceName ? { source: sourceName } : {}),
    ...(projectId ? { projectId } : {}),
    ...(canvasId ? { canvasId } : {}),
    ...(nodeId ? { nodeId } : {}),
  };
}

function validateResult(result: AudioSynthesisResult): AudioSynthesisResult {
  if (!(result.data instanceof Uint8Array) || !result.data.byteLength) {
    throw new Error('配音服务没有返回有效音频。');
  }
  if (result.data.byteLength > MAX_AUDIO_SYNTHESIS_BYTES) {
    throw new Error('配音结果超过 50 MB，未写入画布。');
  }
  if (!/^audio\/[a-z0-9.+-]+$/i.test(result.contentType)) {
    throw new Error('配音服务返回了无法识别的音频格式。');
  }
  if (!/^[a-z0-9]{1,8}$/i.test(result.extension)) {
    throw new Error('配音服务返回了无法识别的文件扩展名。');
  }
  return result;
}

export async function synthesizeAudioRequest(
  input: unknown,
  port: AudioSynthesisPort,
  signal?: AbortSignal,
) {
  const request = parseRequest(input);
  return validateResult(await port.synthesize(request, signal));
}
