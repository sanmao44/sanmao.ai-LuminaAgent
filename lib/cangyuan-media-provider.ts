import { CANGYUAN_TRIPO3D_PUBLIC_MODEL, getCangyuan3DModelProfile, parseCangyuan3DOptions, validateCangyuanMusicInput, type Cangyuan3DOptions, type CangyuanMediaKind, type CangyuanMediaOutput, type CangyuanMediaTaskInput, type CangyuanMusicOptions } from '../packages/contracts/cangyuan-media';

export type CangyuanMediaClient = {
  baseUrl: string;
  headers: Record<string, string>;
  fetcher?: typeof fetch;
};

export type CangyuanProviderTask = {
  id?: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  providerStatus?: string;
  outputs: CangyuanMediaOutput[];
  error?: string;
};

export function cangyuanMediaUrl(baseUrl: string, kind: CangyuanMediaKind, taskId?: string) {
  const root = String(baseUrl || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
  if (!/^https?:\/\//i.test(root)) throw new Error('沧元算力 API 地址无效');
  const path = kind === 'music' ? '/v1/music' : '/v1/3d/generations';
  return `${root}${path}${taskId ? `/${encodeURIComponent(taskId)}` : ''}`;
}

export function buildCangyuanMusicPayload(model: string, input: { prompt: string } & CangyuanMusicOptions) {
  const normalized = validateCangyuanMusicInput(model, input);
  return {
    model,
    prompt: normalized.prompt,
    n: 1,
    ...(normalized.sourceTaskId ? { source_task_id: normalized.sourceTaskId } : {}),
    ...(normalized.sourceAudioId ? { source_audio_id: normalized.sourceAudioId } : {}),
    ...(normalized.instrumental !== undefined ? { instrumental: normalized.instrumental } : {}),
    ...('title' in normalized && normalized.title !== undefined ? { title: normalized.title } : {}),
    ...('lyrics' in normalized && normalized.lyrics !== undefined ? { lyrics: normalized.lyrics } : {}),
    ...('style_text' in normalized && normalized.style_text !== undefined ? { style_text: normalized.style_text } : {}),
    ...('duration' in normalized && normalized.duration !== undefined ? { duration: normalized.duration } : {}),
    ...('seed' in normalized && normalized.seed !== undefined ? { seed: normalized.seed } : {}),
    ...('bpm' in normalized && normalized.bpm !== undefined ? { bpm: normalized.bpm } : {}),
    ...('audio_format' in normalized && normalized.audio_format !== undefined ? { audio_format: normalized.audio_format } : {}),
    ...('audioWeight' in normalized && normalized.audioWeight !== undefined ? { audioWeight: normalized.audioWeight } : {}),
    ...('negativeTags' in normalized && normalized.negativeTags !== undefined ? { negativeTags: normalized.negativeTags } : {}),
    ...('personaId' in normalized && normalized.personaId !== undefined ? { personaId: normalized.personaId } : {}),
    ...('personaModel' in normalized && normalized.personaModel !== undefined ? { personaModel: normalized.personaModel } : {}),
    ...('styleWeight' in normalized && normalized.styleWeight !== undefined ? { styleWeight: normalized.styleWeight } : {}),
    ...('version' in normalized && normalized.version !== undefined ? { version: normalized.version } : {}),
    ...('vocalGender' in normalized && normalized.vocalGender !== undefined ? { vocalGender: normalized.vocalGender } : {}),
    ...('weirdnessConstraint' in normalized && normalized.weirdnessConstraint !== undefined ? { weirdnessConstraint: normalized.weirdnessConstraint } : {}),
    ...('sound_key' in normalized && normalized.sound_key !== undefined ? { sound_key: normalized.sound_key } : {}),
    ...('sound_loop' in normalized && normalized.sound_loop !== undefined ? { sound_loop: normalized.sound_loop } : {}),
    ...('sound_tempo' in normalized && normalized.sound_tempo !== undefined ? { sound_tempo: normalized.sound_tempo } : {}),
  };
}

export function buildCangyuanThreeDPayload(model: string, input: { prompt: string } & Cangyuan3DOptions) {
  const prompt = input.prompt.trim();
  const payload: Record<string, unknown> = { model, ...(prompt ? { prompt } : {}) };
  const { prompt: _prompt, ...rawOptions } = input;
  const options = parseCangyuan3DOptions(rawOptions);
  if (model.toLowerCase() === 'tripo3d' && model !== 'tripo3d') throw new Error('请使用精确公共模型名 tripo3d');
  const profile = getCangyuan3DModelProfile(model);
  if (!profile) throw new Error(`沧元三维模型尚未接入：${model}`);
  if (profile.modelId === CANGYUAN_TRIPO3D_PUBLIC_MODEL) {
    if (!prompt) throw new Error('Tripo3D 必须提供物体描述');
    if (options.textureSize !== undefined || options.seed !== undefined || options.meshSimplify !== undefined
      || options.ssGuidanceStrength !== undefined || options.ssSamplingSteps !== undefined
      || options.slatGuidanceStrength !== undefined || options.slatSamplingSteps !== undefined) {
      throw new Error('Tripo3D 不支持 Trellis 专属参数');
    }
    const mode = options.mode || profile.defaultMode;
    const texture = options.texture || profile.defaultTexture;
    const pbr = options.pbr ?? profile.defaultPbr;
    payload.mode = mode;
    if (mode === 'image-to-3d') {
      if (!options.imageUrl) throw new Error('Tripo3D 图生模式必须提供公网图片地址');
      payload.image_url = requirePublicImageUrl(options.imageUrl);
    } else if (options.imageUrl !== undefined) {
      throw new Error('Tripo3D 文生模式不能同时提交参考图片');
    }
    payload.texture = texture;
    payload.pbr = pbr;
  } else {
    if (options.mode !== undefined && options.mode !== 'image-to-3d') throw new Error('Trellis 仅支持图生三维');
    if (options.texture !== undefined || options.pbr !== undefined) throw new Error('Trellis 不支持 Tripo3D 的贴图档位或 PBR 参数');
    payload.image_url = requirePublicImageUrl(options.imageUrl || '');
    if (options.textureSize !== undefined) payload.texture_size = options.textureSize;
    if (options.seed !== undefined) payload.seed = options.seed;
    if (options.meshSimplify !== undefined) payload.mesh_simplify = options.meshSimplify;
    if (options.ssGuidanceStrength !== undefined) payload.ss_guidance_strength = options.ssGuidanceStrength;
    if (options.ssSamplingSteps !== undefined) payload.ss_sampling_steps = options.ssSamplingSteps;
    if (options.slatGuidanceStrength !== undefined) payload.slat_guidance_strength = options.slatGuidanceStrength;
    if (options.slatSamplingSteps !== undefined) payload.slat_sampling_steps = options.slatSamplingSteps;
  }
  return payload;
}

export function normalizeCangyuanTask(kind: CangyuanMediaKind, value: unknown): CangyuanProviderTask {
  const response = asRecord(value);
  const nested = asRecord(response.data);
  const task = asRecord(response.task);
  const taskId = firstText(response.task_id, response.taskId, response.id, nested.task_id, nested.taskId, nested.id, task.id);
  const rawStatus = firstText(response.status, response.state, response.task_status, nested.status, nested.state, nested.task_status, task.status).toLowerCase();
  const outputs = kind === 'music' ? musicOutputs(response) : threeDOutputs(response);
  const failed = /fail|error|cancel|reject|expired/.test(rawStatus);
  const done = outputs.length > 0 || /complete|success|^done$/.test(rawStatus);
  const status = failed ? 'failed' : done ? 'succeeded' : /progress|running|processing/.test(rawStatus) ? 'running' : 'pending';
  const errorRecord = asRecord(response.error || nested.error || task.error);
  const error = firstText(errorRecord.message, typeof response.error === 'string' ? response.error : '', response.error_message, nested.error_message, response.message);
  return {
    id: taskId || undefined,
    status,
    providerStatus: rawStatus || undefined,
    outputs,
    ...(status === 'failed' ? { error: error || `沧元${kind === 'music' ? '音乐' : '三维'}任务失败${rawStatus ? `：${rawStatus}` : ''}` } : {}),
  };
}

export async function submitCangyuanMediaTask(client: CangyuanMediaClient, kind: CangyuanMediaKind, model: string, input: CangyuanMediaTaskInput): Promise<CangyuanProviderTask> {
  const payload = kind === 'music'
    ? buildCangyuanMusicPayload(model, input as { prompt: string } & CangyuanMusicOptions)
    : buildCangyuanThreeDPayload(model, input as { prompt: string } & Cangyuan3DOptions);
  return requestTask(client, kind, undefined, { method: 'POST', headers: { ...client.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

export async function pollCangyuanMediaTask(client: CangyuanMediaClient, kind: CangyuanMediaKind, taskId: string): Promise<CangyuanProviderTask> {
  return requestTask(client, kind, taskId, { method: 'GET', headers: client.headers });
}

export function isRetryableCangyuanProviderError(error: unknown) {
  const status = Number((error as { status?: unknown } | null)?.status || 0);
  return !status || status === 408 || status === 429 || status >= 500;
}

async function requestTask(client: CangyuanMediaClient, kind: CangyuanMediaKind, taskId: string | undefined, init: RequestInit) {
  const response = await (client.fetcher || fetch)(cangyuanMediaUrl(client.baseUrl, kind, taskId), {
    ...init,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 300) }; }
  if (!response.ok) {
    const errorValue = asRecord(data).error;
    const detail = firstText(asRecord(errorValue).message, typeof errorValue === 'string' ? errorValue : '', asRecord(data).message, text);
    const error = new Error(`沧元算力任务接口失败：HTTP ${response.status}${detail ? `（${detail.slice(0, 200)}）` : ''}`) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return normalizeCangyuanTask(kind, data);
}

function musicOutputs(response: Record<string, unknown>): CangyuanMediaOutput[] {
  const data = asRecord(response.data);
  const urls = Array.isArray(response.music_url) ? response.music_url : Array.isArray(data.music_url) ? data.music_url : [];
  const extra = asRecord(response.extra ?? data.extra);
  return urls.flatMap((value, index) => {
    const url = typeof value === 'string' ? value.trim() : firstText(asRecord(value).url, asRecord(value).music_url);
    if (!/^https?:\/\//i.test(url)) return [];
    const jobId = firstText(arrayItem(extra.job_id, index));
    const audioId = firstText(arrayItem(extra.audio_id, index));
    const title = firstText(arrayItem(extra.title, index));
    const duration = arrayItem(extra.duration, index);
    return [{
      url,
      ...(jobId ? { jobId } : {}),
      ...(audioId ? { audioId } : {}),
      ...(title ? { title } : {}),
      ...(typeof duration === 'number' && Number.isFinite(duration) ? { duration } : {}),
    }];
  });
}

function arrayItem(value: unknown, index: number) {
  return Array.isArray(value) ? value[index] : undefined;
}

function threeDOutputs(response: Record<string, unknown>): CangyuanMediaOutput[] {
  const data = Array.isArray(response.data) ? response.data : Array.isArray(asRecord(response.result).data) ? asRecord(response.result).data as unknown[] : [];
  return data.flatMap((value) => {
    const url = firstText(asRecord(value).url);
    return /^https?:\/\//i.test(url) ? [{ url }] : [];
  });
}

function requirePublicImageUrl(value: string) {
  const imageUrl = String(value || '').trim();
  try {
    const parsed = new URL(imageUrl);
    if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error();
    if (isLocalOrPrivateHost(parsed.hostname)) throw new Error();
  } catch {
    throw new Error('三维参考图必须是公网图片地址；本地文件、Base64 和站内文件编号不可用');
  }
  return imageUrl;
}

function isLocalOrPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host.includes(':')) return host === '::' || host === '::1' || /^(?:fc|fd|fe[89ab])/.test(host) || /^::ffff:(?:0:)?(?:10\.|127\.|169\.254\.|192\.168\.)/.test(host);
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
    || (first === 100 && second >= 64 && second <= 127) || first >= 224;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstText(...values: unknown[]) {
  return String(values.find((value) => typeof value === 'string' && value.trim()) || '').trim();
}
