import { getCangyuan3DModelProfile, validateCangyuan3DInput, validateCangyuanMusicInput, type Cangyuan3DOptions, type CangyuanMediaKind, type CangyuanMediaOutput, type CangyuanMediaTaskInput, type CangyuanMusicOptions } from '../packages/contracts/cangyuan-media';

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
  if (!/^https?:\/\//i.test(root)) throw new Error('服务商 API 地址无效');
  const path = kind === 'music' ? '/v1/music' : '/v1/3d/generations';
  return `${root}${path}${taskId ? `/${encodeURIComponent(taskId)}` : ''}`;
}

export function buildCangyuanMusicPayload(model: string, input: { prompt?: string } & CangyuanMusicOptions) {
  const normalized = validateCangyuanMusicInput(model, input);
  return {
    model,
    ...(normalized.prompt ? { prompt: normalized.prompt } : {}),
    ...(normalized.n !== undefined ? { n: normalized.n } : { n: 1 }),
    ...(normalized.uploadUrl ? { upload_url: normalized.uploadUrl } : {}),
    ...(normalized.uploadUrls ? { upload_urls: normalized.uploadUrls } : {}),
    ...(normalized.continueAt !== undefined ? { continue_at: normalized.continueAt } : {}),
    ...(normalized.infillStartS !== undefined ? { infill_start_s: normalized.infillStartS } : {}),
    ...(normalized.infillEndS !== undefined ? { infill_end_s: normalized.infillEndS } : {}),
    ...(normalized.audioUrl ? { audio_url: normalized.audioUrl } : {}),
    ...(normalized.stemType ? { type: normalized.stemType } : {}),
    ...(normalized.sourceTaskId ? { source_task_id: normalized.sourceTaskId } : {}),
    ...(normalized.sourceAudioId ? { source_audio_id: normalized.sourceAudioId } : {}),
    ...(normalized.sourceTrack !== undefined ? { source_track: normalized.sourceTrack } : {}),
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
    ...('personaName' in normalized && normalized.personaName !== undefined ? { persona_name: normalized.personaName } : {}),
    ...('personaDescription' in normalized && normalized.personaDescription !== undefined ? { persona_description: normalized.personaDescription } : {}),
    ...('personaModel' in normalized && normalized.personaModel !== undefined ? { personaModel: normalized.personaModel } : {}),
    ...('customMode' in normalized && normalized.customMode !== undefined ? { custom_mode: normalized.customMode } : {}),
    ...('tags' in normalized && normalized.tags !== undefined ? { tags: normalized.tags } : {}),
    ...('stemName' in normalized && normalized.stemName !== undefined ? { stem_name: normalized.stemName } : {}),
    ...('styleWeight' in normalized && normalized.styleWeight !== undefined ? { styleWeight: normalized.styleWeight } : {}),
    ...('version' in normalized && normalized.version !== undefined ? { version: normalized.version } : {}),
    ...('vocalGender' in normalized && normalized.vocalGender !== undefined ? { vocalGender: normalized.vocalGender } : {}),
    ...('weirdnessConstraint' in normalized && normalized.weirdnessConstraint !== undefined ? { weirdnessConstraint: normalized.weirdnessConstraint } : {}),
    ...('sound_key' in normalized && normalized.sound_key !== undefined ? { sound_key: normalized.sound_key } : {}),
    ...('sound_loop' in normalized && normalized.sound_loop !== undefined ? { sound_loop: normalized.sound_loop } : {}),
    ...('sound_tempo' in normalized && normalized.sound_tempo !== undefined ? { sound_tempo: normalized.sound_tempo } : {}),
  };
}

export function buildCangyuanThreeDPayload(model: string, input: { prompt?: string } & Cangyuan3DOptions) {
  if (model.toLowerCase() === 'tripo3d' && model !== 'tripo3d') throw new Error('请使用精确公共模型名 tripo3d');
  const profile = getCangyuan3DModelProfile(model);
  if (!profile) throw new Error(`三维模型尚未接入：${model}`);
  const normalized = validateCangyuan3DInput(model, input);
  const { prompt, ...options } = normalized;
  const mode = options.mode || profile.defaultMode;
  const payload: Record<string, unknown> = { model, ...(prompt ? { prompt } : {}) };

  if (mode === 'image-to-3d') payload.image_url = options.imageUrl;
  if (mode === 'multiview-to-3d') payload.inputs = options.multiviewImages;

  if (profile.modelId === 'tripo3d') {
    payload.mode = mode;
    payload.texture = options.texture || profile.defaultTexture;
    payload.pbr = options.pbr ?? profile.defaultPbr;
    return payload;
  }

  if (profile.family === 'trellis') {
    if (options.textureSize !== undefined) payload.texture_size = options.textureSize;
    if (options.seed !== undefined) payload.seed = options.seed;
    if (options.meshSimplify !== undefined) payload.mesh_simplify = options.meshSimplify;
    if (options.ssGuidanceStrength !== undefined) payload.ss_guidance_strength = options.ssGuidanceStrength;
    if (options.ssSamplingSteps !== undefined) payload.ss_sampling_steps = options.ssSamplingSteps;
    if (options.slatGuidanceStrength !== undefined) payload.slat_guidance_strength = options.slatGuidanceStrength;
    if (options.slatSamplingSteps !== undefined) payload.slat_sampling_steps = options.slatSamplingSteps;
    return payload;
  }

  payload.mode = mode;
  if (options.texture !== undefined) payload.texture = options.texture;
  if (options.pbr !== undefined) payload.pbr = options.pbr;
  if (options.faceLimit !== undefined) payload.face_limit = options.faceLimit;
  if (options.generateParts !== undefined) payload.generate_parts = options.generateParts;
  if (options.geometryQuality !== undefined) payload.geometry_quality = options.geometryQuality;
  if (options.textureQuality !== undefined) payload.texture_quality = options.textureQuality;
  if (options.textureVersion !== undefined) payload.texture_version = options.textureVersion;
  if (options.quad !== undefined) payload.quad = options.quad;
  return payload;
}

export function normalizeCangyuanTask(kind: CangyuanMediaKind, value: unknown): CangyuanProviderTask {
  const response = asRecord(value);
  const nested = asRecord(response.data);
  const task = asRecord(response.task);
  const taskId = firstText(response.task_id, response.taskId, response.id, nested.task_id, nested.taskId, nested.id, task.id);
  const rawStatus = firstText(response.status, response.state, response.task_status, nested.status, nested.state, nested.task_status, task.status).toLowerCase();
  const outputs = kind === 'music' ? musicOutputs(response) : threeDOutputs(response);
  const hasResultText = kind === 'music' && Boolean(firstText(response.text, nested.text, asRecord(response.result).text));
  const failed = /fail|error|cancel|reject|expired/.test(rawStatus);
  const done = outputs.length > 0 || hasResultText || /complete|success|^done$/.test(rawStatus);
  const status = failed ? 'failed' : done ? 'succeeded' : /progress|running|processing/.test(rawStatus) ? 'running' : 'pending';
  const errorRecord = asRecord(response.error || nested.error || task.error);
  const error = firstText(errorRecord.message, typeof response.error === 'string' ? response.error : '', response.error_message, nested.error_message, response.message);
  return {
    id: taskId || undefined,
    status,
    providerStatus: rawStatus || undefined,
    outputs: hasResultText && outputs.length === 0
      ? [{ text: firstText(response.text, nested.text, asRecord(response.result).text), artifactType: 'text' }]
      : outputs,
    ...(status === 'failed' ? { error: error || `${kind === 'music' ? '音乐' : '三维'}任务失败${rawStatus ? `：${rawStatus}` : ''}` } : {}),
  };
}

export async function submitCangyuanMediaTask(client: CangyuanMediaClient, kind: CangyuanMediaKind, model: string, input: CangyuanMediaTaskInput): Promise<CangyuanProviderTask> {
  const payload = kind === 'music'
    ? buildCangyuanMusicPayload(model, input as { prompt?: string } & CangyuanMusicOptions)
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
    const error = new Error(`媒体任务接口失败：HTTP ${response.status}${detail ? `（${detail.slice(0, 200)}）` : ''}`) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return normalizeCangyuanTask(kind, data);
}

function musicOutputs(response: Record<string, unknown>): CangyuanMediaOutput[] {
  const data = asRecord(response.data);
  const result = asRecord(response.result);
  const candidates = [response.music_url, data.music_url, response.audio_url, data.audio_url, response.wav_url, data.wav_url,
    response.midi_url, data.midi_url, response.artifact_url, data.artifact_url, response.file_url, data.file_url,
    response.outputs, data.outputs, result.outputs, result.data, response.result];
  const urls = candidates.flatMap((value) => Array.isArray(value) ? value : value === undefined ? [] : [value]);
  const extra = asRecord(response.extra ?? data.extra);
  const seen = new Set<string>();
  return urls.flatMap((value, index) => {
    const record = asRecord(value);
    const url = typeof value === 'string' ? value.trim() : firstText(record.url, record.music_url, record.audio_url, record.wav_url, record.midi_url, record.artifact_url, record.file_url);
    const text = firstText(record.text, record.lyrics, record.content);
    if (!url && !text) return [];
    if (url && !/^https?:\/\//i.test(url)) return [];
    const signature = url || `text:${text}`;
    if (seen.has(signature)) return [];
    seen.add(signature);
    const jobId = firstText(arrayItem(extra.job_id, index));
    const audioId = firstText(arrayItem(extra.audio_id, index));
    const title = firstText(arrayItem(extra.title, index));
    const duration = arrayItem(extra.duration, index);
    const artifactType = firstText(record.artifact_type, record.type).toLowerCase();
    const type: CangyuanMediaOutput['artifactType'] = /midi/.test(artifactType) || url.toLowerCase().endsWith('.mid') || url.toLowerCase().endsWith('.midi')
      ? 'midi'
      : /wav/.test(artifactType) || url.toLowerCase().endsWith('.wav') ? 'wav'
        : /stem|vocal|instrument/.test(artifactType) ? 'stem'
          : text && !url ? 'text' : 'audio';
    return [{
      ...(url ? { url } : {}),
      ...(text ? { text } : {}),
      ...(type !== 'audio' ? { artifactType: type } : {}),
      ...(firstText(record.name, record.filename) ? { name: firstText(record.name, record.filename) } : {}),
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstText(...values: unknown[]) {
  return String(values.find((value) => typeof value === 'string' && value.trim()) || '').trim();
}
