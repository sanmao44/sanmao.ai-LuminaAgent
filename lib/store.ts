import { createCipheriv, createDecipheriv, randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppSettings, ModelCapability, ModelKind, ProviderConnection, ProviderPlatform, ProviderStatus, ProviderType, PublicState, RegistryModel, WebSearchApiProvider, NativeSearchDetection, NativeSearchOverride, NativeSearchProtocol } from './types';
import { selectAutomaticModel } from './model-selection';
import { inferNativeSearch } from './native-search-detection';

type StoredProvider = Omit<ProviderConnection, 'maskedKey' | 'enabledModelCount'> & {
  encryptedApiKey: string;
};

type StoreData = {
  schemaVersion: number;
  providers: StoredProvider[];
  models: RegistryModel[];
  settings: AppSettings;
  webSearch?: { provider: WebSearchApiProvider; encryptedApiKey: string };
};

const dataDir = process.env.SANMAO_DATA_DIR || path.join(process.cwd(), '.data');
const statePath = path.join(dataDir, 'state.json');
const keyPath = path.join(dataDir, 'master.key');
const CURRENT_SCHEMA_VERSION = 2;
const emptyState: StoreData = { schemaVersion: CURRENT_SCHEMA_VERSION, providers: [], models: [], settings: { agentModelId: null, defaultImageModelId: null, defaultProviderId: null, imageStoragePath: '' } };

let stateMutationChain: Promise<unknown> = Promise.resolve();
let stateCorruptionError = '';

async function ensureDir() {
  await mkdir(dataDir, { recursive: true });
}

async function getMasterKey(): Promise<Buffer> {
  const fromEnv = process.env.SANMAO_MASTER_KEY?.trim();
  if (fromEnv) {
    // 支持 64 位 hex；其他字符串通过 SHA-256 派生为 32 字节。
    if (/^[a-f0-9]{64}$/i.test(fromEnv)) return Buffer.from(fromEnv, 'hex');
    return createHash('sha256').update(fromEnv).digest();
  }
  await ensureDir();
  try {
    const raw = (await readFile(keyPath, 'utf8')).trim();
    if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
    throw new Error('主密钥文件格式无效，请从备份恢复或删除损坏的 master.key 后重试');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }
  const key = randomBytes(32);
  try {
    await writeFile(keyPath, `${key.toString('hex')}\n`, { mode: 0o600, flag: 'wx', flush: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
    const raw = (await readFile(keyPath, 'utf8')).trim();
    if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
    throw new Error('主密钥文件格式无效');
  }
  return key;
}

export async function encryptSecret(secret: string) {
  const key = await getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export async function decryptSecret(payload: string) {
  const [ivRaw, tagRaw, dataRaw] = payload.split('.');
  if (!ivRaw || !tagRaw || !dataRaw) throw new Error('访问密钥的加密数据格式无效');
  const key = await getMasterKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]).toString('utf8');
}

async function readState(): Promise<StoreData> {
  await ensureDir();
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8')) as Partial<StoreData>;
    if (!parsed || typeof parsed !== 'object' || (!Array.isArray(parsed.providers) && parsed.providers !== undefined) || (!Array.isArray(parsed.models) && parsed.models !== undefined) || (parsed.settings !== undefined && (!parsed.settings || typeof parsed.settings !== 'object'))) {
      throw new Error('state.json 数据结构无效');
    }
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      models: Array.isArray(parsed.models) ? parsed.models : [],
      settings: { ...emptyState.settings, ...(parsed.settings || {}) },
      webSearch: parsed.webSearch && typeof parsed.webSearch === 'object' && parsed.webSearch.encryptedApiKey && parsed.webSearch.provider === 'baidu-qianfan'
        ? { provider: 'baidu-qianfan', encryptedApiKey: parsed.webSearch.encryptedApiKey }
        : undefined,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      if (stateCorruptionError) throw new Error(stateCorruptionError);
      return structuredClone(emptyState);
    }
    if (error instanceof SyntaxError || (error instanceof Error && /state\.json 数据结构无效/.test(error.message))) {
      const corruptPath = `${statePath.replace(/\.json$/i, '')}.corrupt-${Date.now()}.json`;
      try { await rename(statePath, corruptPath); } catch {}
      stateCorruptionError = `服务端配置已损坏，原文件已保留为 ${path.basename(corruptPath)}，请从备份恢复`;
      throw new Error(stateCorruptionError);
    }
    throw error;
  }
}

async function writeStateDirect(data: StoreData) {
  await ensureDir();
  const tmp = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', flush: true });
  await rename(tmp, statePath);
}

async function mutateState<T>(mutator: (state: StoreData) => Promise<T> | T): Promise<T> {
  const operation = stateMutationChain.then(async () => {
    const state = await readState();
    const result = await mutator(state);
    await writeStateDirect(state);
    return result;
  });
  stateMutationChain = operation.then(() => undefined, () => undefined);
  return operation;
}

function maskKey(secret: string) {
  if (secret.length <= 8) return '••••••••';
  return `${secret.slice(0, 3)}••••${secret.slice(-4)}`;
}

export function inferModel(rawId: string, platform?: ProviderPlatform, nativeSearchProtocol?: NativeSearchProtocol): { kind: ModelKind; capabilities: ModelCapability[]; nativeSearchProtocol?: NativeSearchProtocol; nativeSearchDetection?: NativeSearchDetection } {
  const id = rawId.toLowerCase();
  const upscaleish = /(seed[-_ ]?vr2?|real[-_ ]?esrgan|swinir|upscal|super[-_ ]?resolution)/.test(id);
  if (upscaleish) return { kind: 'image', capabilities: ['edit', 'reference', 'upscale'] };
  const imageish = /(image|imagen|flux|sdxl|stable-diffusion|dall-e|ideogram|recraft|seedream|nano[-_ ]?banana)/.test(id);
  if (imageish) {
    const capabilities: ModelCapability[] = ['generate'];
    if (/(gpt-image|gemini.*image|nano|recraft|flux)/.test(id)) capabilities.push('edit', 'reference');
    if (/(gpt-image|gemini.*image|ideogram|recraft)/.test(id)) capabilities.push('typography');
    return { kind: 'image', capabilities };
  }
  const chatish = /(gpt|gemini|claude|deepseek|qwen|llama|mistral|glm|kimi|command-r|o[134]|sonar|perplexity)/.test(id);
  if (chatish) {
    const capabilities: ModelCapability[] = ['chat', 'vision'];
    const inferredNative = inferNativeSearch(rawId, platform);
    const protocol = nativeSearchProtocol || inferredNative.protocol;
    if (protocol || inferredNative.detected) capabilities.push('web-search');
    return { kind: 'chat', capabilities, ...(protocol ? { nativeSearchProtocol: protocol } : {}), ...(inferredNative.detection ? { nativeSearchDetection: inferredNative.detection } : {}) };
  }
  return { kind: 'unknown', capabilities: [] };
}

function normalizeModel(model: RegistryModel, platform?: ProviderPlatform): RegistryModel {
  const inferred = inferModel(model.rawId, platform, model.nativeSearchProtocol);
  const legacyNative = !model.nativeSearchOverride && model.capabilities?.includes('web-search');
  const nativeEnabled = model.nativeSearchOverride === 'enabled' || (model.nativeSearchOverride !== 'disabled' && (inferred.capabilities.includes('web-search') || Boolean(legacyNative)));
  const retained = (model.capabilities || []).filter((capability) => capability !== 'web-search');
  const capabilities = Array.from(new Set([...retained, ...inferred.capabilities.filter((capability) => capability !== 'web-search'), ...(nativeEnabled ? ['web-search' as const] : [])]));
  const imageLike = inferred.kind === 'image' || capabilities.includes('generate') || capabilities.includes('upscale');
  const nativeSearchProtocol = model.nativeSearchProtocol || inferred.nativeSearchProtocol;
  const nativeSearchDetection = model.nativeSearchOverride === 'enabled' || model.nativeSearchOverride === 'disabled'
    ? 'manual' as const
    : model.nativeSearchDetection || inferred.nativeSearchDetection;
  const normalizedKind = imageLike
    ? 'image'
    : model.kind === 'unknown'
      ? inferred.kind !== 'unknown' ? inferred.kind : capabilities.includes('chat') ? 'chat' : 'unknown'
      : model.kind;
  return { ...model, kind: normalizedKind, capabilities, ...(nativeSearchProtocol ? { nativeSearchProtocol } : {}), ...(nativeSearchDetection ? { nativeSearchDetection } : {}) };
}

export async function getPublicState(): Promise<PublicState> {
  const state = await readState();
  state.models = state.models.map((model) => normalizeModel(model, state.providers.find((provider) => provider.id === model.providerId)?.platform));
  const providers: ProviderConnection[] = await Promise.all(state.providers.map(async (p) => {
    let key = '';
    try { key = await decryptSecret(p.encryptedApiKey); } catch {}
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      platform: p.platform || (p.type === 'google-gemini' ? 'google-gemini' : 'custom'),
      baseUrl: p.baseUrl,
      modelsPath: p.modelsPath || '/models',
      chatPath: p.chatPath || '/chat/completions',
      imageGenerationPath: p.imageGenerationPath || '/images/generations',
      imageEditPath: p.imageEditPath || '/images/edits',
      imageUpscalePath: p.imageUpscalePath || p.imageEditPath || '/images/edits',
      imageUpscaleStatusPath: p.imageUpscaleStatusPath || '',
      responsesPath: p.responsesPath || (p.platform === 'deepseek' ? 'https://api.deepseek.com/beta/responses' : '/responses'),
      authHeader: p.authHeader || 'Authorization',
      authPrefix: p.authPrefix ?? 'Bearer ',
      status: p.status,
      lastSyncedAt: p.lastSyncedAt,
      createdAt: p.createdAt,
      enabledModelCount: state.models.filter((m) => m.providerId === p.id && m.enabled).length,
      maskedKey: key ? maskKey(key) : '••••••••',
    };
  }));
  let webSearchKey = '';
  try { webSearchKey = state.webSearch?.encryptedApiKey ? await decryptSecret(state.webSearch.encryptedApiKey) : ''; } catch {}
  const anySearchConfigured = Boolean(process.env.ANYSEARCH_API_KEY?.trim());
  const qianfanEnvConfigured = Boolean(process.env.QIANFAN_API_KEY?.trim());
  return {
    providers,
    models: state.models,
    settings: {
      ...state.settings,
      webSearchProvider: 'anysearch',
      webSearchConfigured: true,
      webSearchKeyMasked: webSearchKey ? maskKey(webSearchKey) : anySearchConfigured || qianfanEnvConfigured ? '环境变量已配置' : '',
      webSearchAnySearchConfigured: anySearchConfigured,
      webSearchQianfanConfigured: Boolean(qianfanEnvConfigured || (webSearchKey && state.webSearch?.provider === 'baidu-qianfan')),
    },
  };
}

export async function getWebSearchApiConfig() {
  const state = await readState();
  if (!state.webSearch?.encryptedApiKey) return null;
  try {
    return { provider: state.webSearch.provider, apiKey: await decryptSecret(state.webSearch.encryptedApiKey) };
  } catch {
    return null;
  }
}

export async function setWebSearchApiConfig(provider: WebSearchApiProvider, apiKey: string) {
  await mutateState(async (state) => {
    state.webSearch = { provider, encryptedApiKey: await encryptSecret(apiKey.trim()) };
  });
}

export async function clearWebSearchApiConfig() {
  await mutateState((state) => { delete state.webSearch; });
}

type ProviderInput = { name: string; type: ProviderType; platform?: ProviderPlatform; baseUrl: string; apiKey?: string; modelsPath?: string; chatPath?: string; imageGenerationPath?: string; imageEditPath?: string; imageUpscalePath?: string; imageUpscaleStatusPath?: string; responsesPath?: string; authHeader?: string; authPrefix?: string };

function normalizeEndpointPath(value: string | undefined, fallback: string) {
  const clean = String(value || fallback).trim();
  if (/^https?:\/\//i.test(clean)) return clean.replace(/\/+$/, '');
  return `/${clean.replace(/^\/+|\/+$/g, '')}`;
}

function normalizeOptionalEndpointPath(value: string | undefined) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean)) return clean.replace(/\/+$/, '');
  return `/${clean.replace(/^\/+|\/+$/g, '')}`;
}

export async function addProvider(input: ProviderInput & { apiKey: string }) {
  return mutateState(async (state) => {
    const provider: StoredProvider = {
      id: randomUUID(),
      name: input.name.trim(),
      type: input.type,
      platform: input.platform || (input.type === 'google-gemini' ? 'google-gemini' : 'custom'),
      baseUrl: input.baseUrl.replace(/\/+$/, ''),
      modelsPath: normalizeEndpointPath(input.modelsPath, '/models'),
      chatPath: normalizeEndpointPath(input.chatPath, '/chat/completions'),
      imageGenerationPath: normalizeEndpointPath(input.imageGenerationPath, '/images/generations'),
      imageEditPath: normalizeEndpointPath(input.imageEditPath, '/images/edits'),
      imageUpscalePath: normalizeEndpointPath(input.imageUpscalePath || input.imageEditPath, '/images/edits'),
      imageUpscaleStatusPath: normalizeOptionalEndpointPath(input.imageUpscaleStatusPath),
      responsesPath: normalizeEndpointPath(input.responsesPath, '/responses'),
      authHeader: String(input.authHeader || 'Authorization').trim(),
      authPrefix: input.authPrefix ?? 'Bearer ',
      encryptedApiKey: await encryptSecret(input.apiKey.trim()),
      status: 'idle',
      lastSyncedAt: '未同步',
      createdAt: new Date().toISOString(),
    };
    state.providers.push(provider);
    return provider.id;
  });
}

export async function updateProvider(id: string, input: ProviderInput) {
  await mutateState(async (state) => {
    const index = state.providers.findIndex((p) => p.id === id);
    if (index < 0) throw new Error('服务商不存在');
    const current = state.providers[index];
    state.providers[index] = {
      ...current,
      name: input.name.trim(),
      type: input.type,
      platform: input.platform || (input.type === 'google-gemini' ? 'google-gemini' : 'custom'),
      baseUrl: input.baseUrl.replace(/\/+$/, ''),
      modelsPath: normalizeEndpointPath(input.modelsPath, '/models'),
      chatPath: normalizeEndpointPath(input.chatPath, '/chat/completions'),
      imageGenerationPath: normalizeEndpointPath(input.imageGenerationPath, '/images/generations'),
      imageEditPath: normalizeEndpointPath(input.imageEditPath, '/images/edits'),
      imageUpscalePath: normalizeEndpointPath(input.imageUpscalePath || input.imageEditPath, '/images/edits'),
      imageUpscaleStatusPath: normalizeOptionalEndpointPath(input.imageUpscaleStatusPath),
      responsesPath: normalizeEndpointPath(input.responsesPath, '/responses'),
      authHeader: String(input.authHeader || 'Authorization').trim(),
      authPrefix: input.authPrefix ?? 'Bearer ',
      encryptedApiKey: input.apiKey?.trim() ? await encryptSecret(input.apiKey.trim()) : current.encryptedApiKey,
      status: 'idle',
      lastSyncedAt: '配置已更新，待同步',
    };
    state.models = state.models.map((m) => m.providerId === id ? { ...m, providerName: input.name.trim() } : m);
  });
}

export async function removeProvider(id: string) {
  await mutateState((state) => {
    state.providers = state.providers.filter((p) => p.id !== id);
    state.models = state.models.filter((m) => m.providerId !== id);
    if (state.settings.agentModelId && !state.models.some((m) => m.id === state.settings.agentModelId)) state.settings.agentModelId = null;
    if (state.settings.defaultImageModelId && !state.models.some((m) => m.id === state.settings.defaultImageModelId)) state.settings.defaultImageModelId = null;
    if (state.settings.defaultProviderId && !state.providers.some((provider) => provider.id === state.settings.defaultProviderId)) state.settings.defaultProviderId = null;
  });
}

export async function getProviderWithKey(id: string) {
  const state = await readState();
  const provider = state.providers.find((p) => p.id === id);
  if (!provider) return null;
  return { ...provider, apiKey: await decryptSecret(provider.encryptedApiKey) };
}

export async function setProviderStatus(id: string, status: ProviderStatus, lastSyncedAt?: string) {
  await mutateState((state) => { state.providers = state.providers.map((p) => p.id === id ? { ...p, status, lastSyncedAt: lastSyncedAt ?? p.lastSyncedAt } : p); });
}

export async function replaceProviderModels(providerId: string, providerName: string, rawModels: Array<{ id: string; name?: string; capabilities?: ModelCapability[]; nativeSearchProtocol?: NativeSearchProtocol; nativeSearchDetection?: NativeSearchDetection }>) {
  return mutateState((state) => {
    const existing = new Map(state.models.filter((m) => m.providerId === providerId).map((m) => [m.rawId, m]));
    const next = rawModels.map((raw) => {
      const previous = existing.get(raw.id);
      if (previous) {
        const inferred = inferModel(raw.id, state.providers.find((provider) => provider.id === providerId)?.platform, raw.nativeSearchProtocol);
        return normalizeModel({ ...previous, providerName, ...(raw.nativeSearchProtocol ? { nativeSearchProtocol: raw.nativeSearchProtocol } : {}), ...(raw.nativeSearchDetection ? { nativeSearchDetection: raw.nativeSearchDetection } : {}), capabilities: Array.from(new Set([...(previous.capabilities || []), ...(raw.capabilities || []), ...inferred.capabilities])) }, state.providers.find((provider) => provider.id === providerId)?.platform);
      }
      const platform = state.providers.find((provider) => provider.id === providerId)?.platform;
      const inferred = inferModel(raw.id, platform, raw.nativeSearchProtocol);
      return normalizeModel({
        id: randomUUID(), providerId, providerName, rawId: raw.id,
        displayName: raw.name?.split('/').pop() || raw.id.split('/').pop() || raw.id,
        kind: inferred.kind, enabled: false, published: false, capabilities: Array.from(new Set([...(raw.capabilities || []), ...inferred.capabilities])),
        ...(raw.nativeSearchProtocol ? { nativeSearchProtocol: raw.nativeSearchProtocol } : {}),
        ...(raw.nativeSearchDetection ? { nativeSearchDetection: raw.nativeSearchDetection } : {}),
      } satisfies RegistryModel, platform);
    });
    state.models = [...state.models.filter((m) => m.providerId !== providerId), ...next];
    return next;
  });
}

export async function patchModel(id: string, patch: Partial<Pick<RegistryModel, 'displayName' | 'kind' | 'enabled' | 'published' | 'capabilities' | 'nativeSearchOverride'>>) {
  return mutateState((state) => {
    state.models = state.models.map((model) => normalizeModel(model, state.providers.find((provider) => provider.id === model.providerId)?.platform));
    state.models = state.models.map((m) => {
      if (m.id !== id) return m;
      const next = { ...m, ...patch };
      if (patch.enabled === false) next.published = false;
      if (patch.published === true) next.enabled = true;
      return next;
    });
    const model = state.models.find((m) => m.id === id);
    if (!model) throw new Error('模型不存在');
    if (model.kind !== 'chat' && state.settings.agentModelId === id) state.settings.agentModelId = null;
    if (model.kind !== 'image' && state.settings.defaultImageModelId === id) state.settings.defaultImageModelId = null;
    return model;
  });
}

export async function patchSettings(patch: Partial<AppSettings>) {
  return mutateState((state) => {
    // 兼容旧配置：历史上部分带生图能力的模型可能仍保存为 chat/unknown，
    // 但前端和运行时已经按能力把它们展示为 image。设置默认模型时必须使用同一套归类。
    state.models = state.models.map((model) => normalizeModel(model, state.providers.find((provider) => provider.id === model.providerId)?.platform));
    if ('agentModelId' in patch) {
      const id = patch.agentModelId;
      if (id) {
        const model = state.models.find((m) => m.id === id && m.enabled && m.published && m.kind === 'chat');
        if (!model) throw new Error('请选择已启用、已发布的对话模型');
      }
      state.settings.agentModelId = id ?? null;
    }
    if ('defaultImageModelId' in patch) {
      const id = patch.defaultImageModelId;
      if (id) {
        const model = state.models.find((m) => m.id === id && m.enabled && m.published && m.kind === 'image');
        if (!model) throw new Error('请选择已启用、已发布的生图模型');
      }
      state.settings.defaultImageModelId = id ?? null;
    }
    if ('defaultProviderId' in patch) {
      const id = patch.defaultProviderId;
      if (id && !state.providers.some((provider) => provider.id === id)) throw new Error('请选择已存在的默认厂商');
      state.settings.defaultProviderId = id ?? null;
    }
    if ('imageStoragePath' in patch) state.settings.imageStoragePath = String(patch.imageStoragePath || '').trim();
    return state.settings;
  });
}

export async function getRuntimeModel(id: string | null | undefined, kind: ModelKind) {
  const state = await readState();
  const models = state.models.map((model) => normalizeModel(model, state.providers.find((provider) => provider.id === model.providerId)?.platform));
  const explicitId = id && id !== 'auto' ? id : null;
  const compatible = models.filter((m) => m.kind === kind && m.enabled && m.published);
  let model = explicitId ? models.find((m) => m.id === explicitId) : undefined;
  if (!explicitId) {
    const configuredDefaultId = kind === 'chat' ? state.settings.agentModelId : state.settings.defaultImageModelId;
    const providerModels = state.settings.defaultProviderId ? compatible.filter((m) => m.providerId === state.settings.defaultProviderId) : [];
    model = providerModels.find((m) => m.id === configuredDefaultId) || providerModels[0]
      || compatible.find((m) => m.id === configuredDefaultId)
      || compatible[0];
  }
  if (!model || !model.enabled || !model.published || model.kind !== kind) return null;
  const provider = state.providers.find((p) => p.id === model!.providerId);
  if (!provider) return null;
  return { model, provider: { ...provider, responsesPath: provider.responsesPath || (provider.platform === 'deepseek' ? 'https://api.deepseek.com/beta/responses' : '/responses'), apiKey: await decryptSecret(provider.encryptedApiKey) } };
}

export async function getRuntimeImageModelForCapability(id: string | null | undefined, capability: ModelCapability) {
  const state = await readState();
  const models = state.models.map((model) => normalizeModel(model, state.providers.find((provider) => provider.id === model.providerId)?.platform));
  const targetId = id && id !== 'auto' ? id : undefined;
  const compatible = models.filter((item) => item.kind === 'image' && item.enabled && item.published && item.capabilities.includes(capability));
  const model = targetId
    ? models.find((item) => item.id === targetId)
    : selectAutomaticModel(compatible, state.settings.defaultProviderId, state.settings.defaultImageModelId);
  if (!model || !model.enabled || !model.published || model.kind !== 'image' || !model.capabilities.includes(capability)) return null;
  const provider = state.providers.find((item) => item.id === model!.providerId);
  if (!provider) return null;
  return { model, provider: { ...provider, apiKey: await decryptSecret(provider.encryptedApiKey) } };
}

export async function getRuntimeImageGenerationModel(id: string | null | undefined) {
  const state = await readState();
  const models = state.models.map((model) => normalizeModel(model, state.providers.find((provider) => provider.id === model.providerId)?.platform));
  const explicit = id && id !== 'auto' ? models.find((item) => item.id === id) : undefined;
  const compatible = models.filter((item) => item.kind === 'image' && item.enabled && item.published && item.capabilities.includes('generate'));
  const model = explicit || selectAutomaticModel(compatible, state.settings.defaultProviderId, state.settings.defaultImageModelId);
  if (!model || !model.enabled || !model.published || model.kind !== 'image' || !model.capabilities.includes('generate')) return null;
  const provider = state.providers.find((item) => item.id === model.providerId);
  if (!provider) return null;
  return { model, provider: { ...provider, apiKey: await decryptSecret(provider.encryptedApiKey) } };
}
