import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = path.join(ROOT, 'packages/contracts/minimax-system-voices.json');
const MANIFEST_PATH = path.join(ROOT, 'components/audio/voice-samples.manifest.json');
const OUTPUT_ROOT = path.join(ROOT, 'public/audio/voice-samples');
const PROVIDER_KEY = 'cangyuan';
const PREVIEW_TEXT = '你好，这是一段音色试听。';
const MODELS = [
  { id: 'minimax-speech-2.8-hd-tts', displayName: 'MiniMax 2.8 高保真配音' },
  { id: 'minimax-speech-2.8-turbo-tts', displayName: 'MiniMax 2.8 快速配音' },
];

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

function parsePositiveInteger(name, fallback) {
  const value = Number(argumentValue(name, fallback));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function expectedUrl(modelId, number) {
  return `/audio/voice-samples/${modelId}/${String(number).padStart(3, '0')}.mp3`;
}

async function atomicWrite(filePath, data) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, data);
  await rename(temporaryPath, filePath);
}

async function requestJson(origin, pathName, init = {}) {
  const response = await fetch(new URL(pathName, origin), {
    ...init,
    headers: { origin, ...(init.headers || {}) },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${pathName} returned HTTP ${response.status}.`);
  return result;
}

async function responseFailureMessage(response, modelId, voiceId) {
  const body = await response.text().catch(() => '');
  let detail = body;
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed.error === 'string') detail = parsed.error;
    else if (parsed.error && typeof parsed.error === 'object') detail = JSON.stringify(parsed.error);
  } catch { /* Keep the response body for non-JSON diagnostics. */ }
  detail = String(detail || '').replace(/\s+/gu, ' ').trim();
  detail = detail
    .replace(/((?:api[_ -]?key|access[_ -]?token|authorization|secret)\s*[:=]\s*)([^\s,;]+)/giu, '$1[已遮蔽]')
    .replace(/\bBearer\s+[^\s,;]+/giu, 'Bearer [已遮蔽]')
    .slice(0, 500);
  return `Sample request failed for ${modelId}/${voiceId} with HTTP ${response.status}${detail ? `: ${detail}` : ''}; stopped without retry.`;
}

function sampleIsValid(entry, voice, modelId, bytes) {
  return entry?.url === expectedUrl(modelId, voice.number)
    && entry?.text === PREVIEW_TEXT
    && entry?.provenance?.providerKey === PROVIDER_KEY
    && entry?.provenance?.modelId === modelId
    && entry?.provenance?.voiceId === voice.voiceId
    && entry?.provenance?.bytes === bytes.length
    && entry?.provenance?.sha256 === sha256(bytes);
}

async function main() {
  const all = process.argv.includes('--all');
  const limit = argumentValue('--limit', null);
  if (!all && limit === null) throw new Error('Pass --all to create the full catalog, or --limit N for a bounded verification run.');

  const origin = String(argumentValue('--origin', process.env.SANMAO_AUDIO_SAMPLE_API_ORIGIN || 'http://127.0.0.1:3213')).replace(/\/+$/, '');
  const concurrency = Math.min(4, parsePositiveInteger('--concurrency', 2));
  const useDefaultFormat = process.argv.includes('--default-format');
  const modelFilter = argumentValue('--model', null);
  const selectedModels = modelFilter ? MODELS.filter((model) => model.id === modelFilter) : MODELS;
  if (!selectedModels.length) throw new Error(`Unknown MiniMax TTS model: ${modelFilter}`);

  const catalog = JSON.parse(await readFile(CATALOG_PATH, 'utf8'));
  if (catalog.length !== 327 || new Set(catalog.map((voice) => voice.voiceId)).size !== 327) {
    throw new Error('The MiniMax voice catalog must contain 327 unique official voice IDs.');
  }
  const manifestText = await readFile(MANIFEST_PATH, 'utf8');
  const newline = manifestText.includes('\r\n') ? '\r\n' : '\n';
  const manifest = JSON.parse(manifestText);
  const state = await requestJson(origin, '/api/state');
  const configuredProviderId = process.env.SANMAO_CANGYUAN_SPEECH_PROVIDER_ID;
  const providers = state.providers.filter((provider) => provider.name === '沧元-配音');
  const provider = configuredProviderId
    ? providers.find((item) => item.id === configuredProviderId)
    : providers.length === 1 ? providers[0] : null;
  if (!provider) throw new Error('Could not identify one configured 沧元-配音 provider.');

  const connectionTest = await requestJson(origin, '/api/providers/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: provider.id }),
  });
  const discoveredIds = new Set((connectionTest.sample || []).map((item) => item.id));
  for (const model of selectedModels) {
    if (!discoveredIds.has(model.id)) throw new Error(`The configured provider did not report ${model.id} as available.`);
  }

  const registeredModels = new Map(state.models
    .filter((model) => model.providerId === provider.id)
    .map((model) => [model.rawId, model]));
  for (const model of selectedModels) {
    let registered = registeredModels.get(model.id);
    if (!registered) {
      const result = await requestJson(origin, `/api/providers/${provider.id}/models`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawId: model.id, displayName: model.displayName, kind: 'audio', audioTask: 'speech' }),
      });
      registered = result.model;
      registeredModels.set(model.id, registered);
      console.log(`Registered ${model.id} as a speech model.`);
    }
    if (!registered.capabilities?.includes('speech')) throw new Error(`${model.id} is not registered with speech capability.`);
    model.registryId = registered.id;
  }

  const tasks = selectedModels.flatMap((model) => catalog.slice(0, limit === null ? catalog.length : parsePositiveInteger('--limit', 1))
    .map((voice) => ({ model, voice })));
  let cursor = 0;
  let completed = 0;
  let skipped = 0;
  let firstFailure = null;
  let writeQueue = Promise.resolve();

  function saveManifest() {
    writeQueue = writeQueue.then(async () => {
      const serialized = `${JSON.stringify(manifest, null, 2)}\n`.replace(/\n/gu, newline);
      await atomicWrite(MANIFEST_PATH, serialized);
    });
    return writeQueue;
  }

  async function ensureModelDirectory(modelId) {
    const directory = path.join(OUTPUT_ROOT, modelId);
    await mkdir(directory, { recursive: true });
    return directory;
  }

  async function makeOne({ model, voice }) {
    const relativeUrl = expectedUrl(model.id, voice.number);
    const absolutePath = path.join(ROOT, 'public', relativeUrl.slice(1));
    const existingEntry = manifest[model.id]?.[voice.voiceId];
    try {
      const existingBytes = await readFile(absolutePath);
      if (sampleIsValid(existingEntry, voice, model.id, existingBytes)) {
        skipped += 1;
        return;
      }
      if (!existingEntry) throw new Error(`Refusing to overwrite an unmapped audio file: ${relativeUrl}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    await ensureModelDirectory(model.id);
    const response = await fetch(new URL('/api/audio/speech', origin), {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        preview: true,
        text: PREVIEW_TEXT,
        modelId: model.registryId,
        voiceId: voice.voiceId,
        ...(!useDefaultFormat ? { format: 'mp3' } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(await responseFailureMessage(response, model.id, voice.voiceId));
    }
    const responseModelId = response.headers.get('x-audio-model-id');
    const contentType = response.headers.get('content-type')?.split(';', 1)[0] || '';
    if (responseModelId !== model.registryId || !contentType.startsWith('audio/')) {
      throw new Error(`Response identity or audio type did not match ${model.id}/${voice.voiceId}; stopped without retry.`);
    }
    if (useDefaultFormat && contentType !== 'audio/mpeg') {
      throw new Error(`The documented default format returned ${contentType || 'an unknown audio type'} for ${model.id}/${voice.voiceId}; refusing to save it as MP3.`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 128) throw new Error(`Audio payload was too small for ${model.id}/${voice.voiceId}; stopped without retry.`);

    await atomicWrite(absolutePath, bytes);
    manifest[model.id] ||= {};
    manifest[model.id][voice.voiceId] = {
      url: relativeUrl,
      text: PREVIEW_TEXT,
      note: '按对应模型与系统音色编号生成的样音',
      provenance: {
        provider: provider.name,
        providerKey: PROVIDER_KEY,
        modelId: model.id,
        voiceId: voice.voiceId,
        routeModelId: model.registryId,
        responseModelId,
        generatedAt: new Date().toISOString(),
        contentType,
        bytes: bytes.length,
        sha256: sha256(bytes),
        requestOptions: { responseFormat: 'mp3' },
      },
    };
    await saveManifest();
    completed += 1;
    if (completed % 10 === 0 || completed + skipped === tasks.length) {
      console.log(`Progress ${completed + skipped}/${tasks.length}; generated ${completed}, reused ${skipped}.`);
    }
  }

  async function worker() {
    while (!firstFailure) {
      const index = cursor++;
      if (index >= tasks.length) return;
      try {
        await makeOne(tasks[index]);
      } catch (error) {
        firstFailure ||= error;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  await writeQueue;
  if (firstFailure) throw firstFailure;
  console.log(`Done. ${completed} generated, ${skipped} already verified, across ${selectedModels.length} model(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'MiniMax sample generation failed.');
  process.exitCode = 1;
});
