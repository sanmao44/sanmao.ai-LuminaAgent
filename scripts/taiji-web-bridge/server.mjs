import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ORIGIN = 'https://ai.zhuangxiuyunying.xyz';
const API_KEY = 'local-bridge';
const MAX_BODY_BYTES = 1_000_000;
const MAX_CATALOG_MODELS = 500;
const MAX_PROMPT_CHARS = 120_000;
const MAX_RESPONSE_CHARS = 160_000;
const MAX_QUEUE_SIZE = 1;
const WORKER_FRESH_MS = 45_000;
const POLL_WAIT_MS = 20_000;
const DEFAULT_JOB_TIMEOUT_MS = 180_000;
const DEFAULT_DRAW_JOB_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_DRAW_IMAGES = 10;
const MAX_DRAW_IMAGE_BYTES = 24 * 1024 * 1024;
const JOB_KINDS = ['chat', 'draw'];
const DRAW_MODEL_PROVIDERS = new Set(['openai-draw', 'google-draw', 'mj', 'niji']);
const DRAW_IMAGE_HOSTS = new Set(['s3.taiyangai.cn', 'oss.filenest.top']);
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']);
const IMAGE_REQUEST_FIELDS = new Set(['model', 'prompt', 'n', 'size', 'quality', 'resolution', 'response_format', 'background']);
const REFERENCE_IMAGE_FIELDS = new Set(['image', 'images', 'image_url', 'image_urls', 'mask']);
const OPENAI_QUALITY_LEVELS = new Set(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);

function asHttpError(message, status = 400, code = 'invalid_request') {
  return Object.assign(new Error(message), { status, code });
}

export function formatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 100) {
    throw asHttpError('messages must contain between 1 and 100 entries.');
  }

  const formatted = messages.map((message) => {
    if (!message || !['system', 'user', 'assistant'].includes(message.role)) {
      throw asHttpError('Only system, user, and assistant messages are supported.', 422, 'unsupported_role');
    }
    if (typeof message.content !== 'string') {
      throw asHttpError('This web model accepts text messages only.', 422, 'unsupported_content');
    }
    return `<${message.role}>\n${message.content}`;
  });
  const prompt = formatted.join('\n\n');
  if (!prompt.trim()) throw asHttpError('messages cannot be empty.');
  if (prompt.length > MAX_PROMPT_CHARS) throw asHttpError('messages exceed the local bridge limit.', 413, 'prompt_too_large');
  return prompt;
}

function normalizeModelCatalog(input, expectedKind = null, allowEmpty = false) {
  if (!Array.isArray(input) || input.length > MAX_CATALOG_MODELS || (!allowEmpty && input.length === 0)) {
    throw asHttpError(`models must contain between 1 and ${MAX_CATALOG_MODELS} entries.`, 422, 'invalid_model_catalog');
  }

  const ids = new Set();
  const labels = new Set();
  return input.map((model) => {
    const kind = expectedKind || model?.kind || 'chat';
    const id = typeof model?.id === 'string' ? model.id.trim() : '';
    const label = typeof model?.label === 'string' ? model.label.trim() : '';
    const price = typeof model?.price === 'string' ? model.price.trim() : '';
    const providerKey = typeof model?.providerKey === 'string' ? model.providerKey.trim() : '';
    const providerName = typeof model?.providerName === 'string' ? model.providerName.trim() : '';
    const drawModel = typeof model?.drawModel === 'string' ? model.drawModel.trim() : '';
    const version = typeof model?.version === 'string' ? model.version.trim() : '';

    if (!JOB_KINDS.includes(kind) || (expectedKind && model?.kind && model.kind !== expectedKind)) {
      throw asHttpError('Every model must have a valid kind.', 422, 'invalid_model_catalog');
    }
    if (!id || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) {
      throw asHttpError('Every model must have a valid ID.', 422, 'invalid_model_catalog');
    }
    if (!label || label.length > 240 || /[\u0000-\u001f\u007f]/.test(label)) {
      throw asHttpError('Every model must have a valid display name.', 422, 'invalid_model_catalog');
    }
    if ((kind === 'chat' && !/^\d+(?:\.\d+)?\s*积分$/u.test(price))
      || (kind === 'draw' && price && !/^\d+(?:\.\d+)?\s*积分$/u.test(price))) {
      throw asHttpError('Every model must include the Taiji page price.', 422, 'invalid_model_catalog');
    }
    if (!providerKey || providerKey.length > 100 || providerName.length > 160) {
      throw asHttpError('Every model must include a valid provider.', 422, 'invalid_model_catalog');
    }
    if (kind === 'draw' && (!DRAW_MODEL_PROVIDERS.has(drawModel) || !version || version.length > 100)) {
      throw asHttpError('Every draw model must include a supported Taiji draw provider and version.', 422, 'invalid_model_catalog');
    }
    if (ids.has(`${kind}:${id}`) || labels.has(`${kind}:${label}`)) {
      throw asHttpError('Model IDs and display names must be unique.', 422, 'invalid_model_catalog');
    }
    ids.add(`${kind}:${id}`);
    labels.add(`${kind}:${label}`);
    const normalized = { kind, id, label, price, providerKey, providerName };
    if (kind === 'draw') {
      normalized.drawModel = drawModel;
      normalized.version = version;
      const qualityOptions = Array.isArray(model.qualityOptions)
        ? [...new Set(model.qualityOptions.filter((quality) => OPENAI_QUALITY_LEVELS.has(quality)))]
        : [];
      if (drawModel === 'openai-draw') normalized.qualityOptions = qualityOptions;
    }
    return normalized;
  });
}

function greatestCommonDivisor(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function parseImageSize(size) {
  if (size === undefined || size === 'auto') return { kind: 'auto' };
  if (typeof size !== 'string') throw asHttpError('size must be "auto" or WIDTHxHEIGHT.', 422, 'invalid_image_size');
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(size);
  if (!match) throw asHttpError('size must be "auto" or WIDTHxHEIGHT.', 422, 'invalid_image_size');
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 64 || height < 64 || width > 3840 || height > 3840) {
    throw asHttpError('Custom image dimensions must be between 64 and 3840 pixels.', 422, 'invalid_image_size');
  }
  const divisor = greatestCommonDivisor(width, height);
  const ratio = `${width / divisor}:${height / divisor}`;
  const [ratioWidth, ratioHeight] = ratio.split(':').map(Number);
  if (ratioWidth > 21 || ratioHeight > 21) {
    throw asHttpError('The requested image aspect ratio is outside Taiji draw limits.', 422, 'invalid_image_size');
  }
  return { kind: 'dimensions', width, height, ratio };
}

function buildTaijiDrawRequest(body, model) {
  const allowedFields = new Set([...IMAGE_REQUEST_FIELDS, ...REFERENCE_IMAGE_FIELDS]);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) throw asHttpError(`Unsupported image parameter: ${key}.`, 422, 'unsupported_image_parameter');
  }
  for (const field of REFERENCE_IMAGE_FIELDS) {
    if (body[field] !== undefined && body[field] !== null && body[field] !== false && body[field] !== '') {
      throw asHttpError('Reference images and masks are not supported by the Taiji web bridge.', 422, 'reference_images_unsupported');
    }
  }
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    throw asHttpError('prompt must be a non-empty string.', 422, 'invalid_image_prompt');
  }
  if (body.prompt.length > MAX_PROMPT_CHARS) throw asHttpError('prompt exceeds the local bridge limit.', 413, 'prompt_too_large');
  if (body.n !== undefined && body.n !== 1) throw asHttpError('Only one image request per call is supported.', 422, 'n_unsupported');
  if (body.response_format !== undefined && body.response_format !== 'b64_json') {
    throw asHttpError('The Taiji web bridge returns b64_json only.', 422, 'response_format_unsupported');
  }
  if (body.background !== undefined && !['auto', 'opaque', 'transparent'].includes(body.background)) {
    throw asHttpError('background must be auto, opaque, or transparent.', 422, 'background_unsupported');
  }

  const size = parseImageSize(body.size);
  const request = {
    model: model.drawModel,
    action: 'IMAGINE',
    public: false,
    fast: false,
    prompt: body.prompt.trim(),
    no: '',
  };

  if (model.drawModel === 'openai-draw') {
    const quality = body.quality ?? 'high';
    const allowedQuality = model.qualityOptions.length ? model.qualityOptions : ['auto', 'low', 'medium', 'high'];
    if (!allowedQuality.includes(quality)) throw asHttpError(`quality is not available for ${model.label}.`, 422, 'quality_unsupported');
    if (body.resolution !== undefined) throw asHttpError('resolution is not supported by this Taiji image model.', 422, 'resolution_unsupported');
    if (model.version === 'gpt-image-2' && body.background === 'transparent') {
      throw asHttpError('Transparent background is not supported by this Taiji image model.', 422, 'background_unsupported');
    }
    request.args = {
      version: model.version,
      area: size.kind === 'auto' ? 'auto' : `${size.width}x${size.height}`,
      output_max: 1,
      quality,
      moderation: 'auto',
      background: body.background ?? 'auto',
    };
    return request;
  }

  if (model.drawModel === 'google-draw') {
    if (body.quality !== undefined || body.background !== undefined) {
      throw asHttpError('quality and background are not supported by this Taiji Google image model.', 422, 'unsupported_image_parameter');
    }
    if (size.kind === 'dimensions' && size.ratio.includes(':')) {
      const allowedRatios = model.version === 'nano-banana-2'
        ? new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'])
        : new Set(['1:1', '4:3', '3:4', '5:4', '16:9', '9:16', '21:9']);
      if (!allowedRatios.has(size.ratio)) throw asHttpError('The requested aspect ratio is not supported by this Taiji Google image version.', 422, 'aspect_ratio_unsupported');
    }
    const resolution = String(body.resolution ?? '2K').toUpperCase();
    if (!['1K', '2K', '4K'].includes(resolution)) throw asHttpError('resolution must be 1K, 2K, or 4K.', 422, 'resolution_unsupported');
    request.args = {
      version: model.version,
      resolution,
      area: size.kind === 'auto' ? 'auto' : size.ratio,
    };
    return request;
  }

  if (body.quality !== undefined || body.resolution !== undefined || body.background !== undefined) {
    throw asHttpError('quality, resolution, and background are not supported by Taiji Midjourney image models.', 422, 'unsupported_image_parameter');
  }
  const versionFlag = model.drawModel === 'mj' ? '--v' : '--niji';
  const ratioFlag = size.kind === 'dimensions' ? ` --ar ${size.ratio}` : '';
  request.prompt = `${request.prompt}${ratioFlag} ${versionFlag} ${model.version}`;
  return request;
}

function taijiDrawImageUrls(status) {
  if (!status || typeof status !== 'object') throw asHttpError('Taiji draw status is missing.', 502, 'invalid_draw_status');
  if (!status.end) throw asHttpError('Taiji draw task has not reached a terminal state.', 502, 'draw_incomplete');
  if (status.status === 'ERROR') {
    const message = status.errorMessage || status.message || status.error?.message || 'Taiji image generation failed.';
    throw asHttpError(String(message).slice(0, 300), 502, 'draw_failed');
  }
  if (status.status !== 'COMPLETE') throw asHttpError('Taiji draw task did not complete successfully.', 502, 'draw_failed');

  const records = Array.isArray(status.outImages) ? status.outImages : [];
  const urls = records.map((image) => [image?.url, image?.imgUrl, image?.smallImgUrl]
    .find((value) => typeof value === 'string' && value.trim())
    ?.trim()).filter(Boolean);
  if (!urls.length) {
    const fallback = [status.imgUrl, status.smallImgUrl]
      .find((value) => typeof value === 'string' && value.trim());
    if (fallback) urls.push(fallback.trim());
  }
  if (!urls.length) throw asHttpError('Taiji completed the task without returning an image URL.', 502, 'empty_image_output');
  if (urls.length > MAX_DRAW_IMAGES) throw asHttpError('Taiji returned too many images for one request.', 502, 'too_many_images');
  return urls;
}

function validateTaijiImageUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw asHttpError('Taiji returned an invalid image URL.', 502, 'invalid_image_url'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !DRAW_IMAGE_HOSTS.has(url.hostname.toLowerCase())) {
    throw asHttpError('Taiji returned an image URL outside the verified CDN allowlist.', 502, 'image_url_denied');
  }
  return url;
}

async function fetchTaijiImage(value) {
  const url = validateTaijiImageUrl(value);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw asHttpError(`Taiji image download failed with HTTP ${response.status}.`, 502, 'image_download_failed');
  const mimeType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (!IMAGE_MIME_TYPES.has(mimeType)) throw asHttpError('Taiji returned a non-image resource.', 502, 'invalid_image_type');
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_DRAW_IMAGE_BYTES) throw asHttpError('Taiji image exceeds the local bridge size limit.', 502, 'image_too_large');
  const reader = response.body?.getReader();
  if (!reader) throw asHttpError('Taiji returned an empty image response.', 502, 'empty_image_output');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DRAW_IMAGE_BYTES) {
        await reader.cancel();
        throw asHttpError('Taiji image exceeds the local bridge size limit.', 502, 'image_too_large');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw asHttpError('Taiji returned an empty image response.', 502, 'empty_image_output');
  return { mimeType, bytes: Buffer.concat(chunks, size) };
}

function isLoopback(address) {
  const normalized = String(address || '').replace(/^::ffff:/i, '').replace(/^\[|\]$/g, '');
  return normalized === '127.0.0.1' || normalized === '::1';
}

function requestHostAllowed(request) {
  const header = String(request.headers.host || '').toLowerCase();
  const hostname = header.startsWith('[') ? header.slice(1, header.indexOf(']')) : header.split(':')[0];
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

function originAllowed(request) {
  const origin = request.headers.origin;
  return !origin || origin === SITE_ORIGIN;
}

function sendJson(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function sendError(response, status, message, code = 'bridge_error') {
  sendJson(response, status, { error: { message, type: 'bridge_error', code } });
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw asHttpError('Request body is too large.', 413, 'body_too_large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw asHttpError('Request body must be valid JSON.');
  }
}

function bearerToken(request) {
  const match = /^Bearer\s+(.+)$/i.exec(String(request.headers.authorization || ''));
  return match?.[1] || '';
}

function equalToken(actual, expected) {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function completeBody(job, content) {
  return {
    id: `chatcmpl-${job.id}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: job.model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  };
}

function sendStream(response, job, content) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const data = {
    id: `chatcmpl-${job.id}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: job.model,
    choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
  };
  response.write(`data: ${JSON.stringify(data)}\n\n`);
  response.write(`data: ${JSON.stringify({
    id: data.id,
    object: data.object,
    created: data.created,
    model: data.model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })}\n\n`);
  response.end('data: [DONE]\n\n');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function setupPage(pairCode, expiresAt, paired) {
  const expiry = new Date(expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>太极网页桥接</title>
<style>
  body{font:16px/1.6 system-ui,"Microsoft YaHei",sans-serif;margin:40px auto;padding:0 20px;max-width:720px;color:#17212b;background:#f4f7f8}
  main{background:#fff;border:1px solid #d7e0e4;border-radius:8px;padding:24px}
  h1{font-size:22px;margin:0 0 12px}p{margin:8px 0;color:#394b56}
  code{font:700 28px/1.3 ui-monospace,Consolas,monospace;letter-spacing:4px;padding:10px 14px;display:inline-block;background:#e9f2f1;border-radius:6px;color:#17665b}
  .grid{display:grid;grid-template-columns:170px minmax(0,1fr);gap:7px 14px;margin-top:22px}
  .label{color:#667780}.status{font-weight:700;color:${paired ? '#17665b' : '#98651a'}}
  @media(max-width:520px){body{margin:18px auto}main{padding:18px}.grid{grid-template-columns:1fr;gap:2px}.label{margin-top:8px}}
</style>
<main>
  <h1>太极网页账号桥接</h1>
  <p class="status">${paired ? '浏览器已配对' : '等待 ScriptCat 配对'}</p>
  <p>把下面的一次性配对码输入太极聊天页弹出的提示框。配对码仅在此服务运行期间有效，最多尝试 5 次。</p>
  <code>${escapeHtml(pairCode)}</code><p>有效至 ${escapeHtml(expiry)}</p>
  <div class="grid">
    <span class="label">SANMAO 服务商地址</span><code style="font-size:14px;letter-spacing:0">http://127.0.0.1:8787/v1</code>
    <span class="label">连接表单访问密钥</span><code style="font-size:14px;letter-spacing:0">local-bridge</code>
    <span class="label">模型目录</span><span>从已登录的太极聊天页同步；SANMAO 会显示每个模型的页面标价</span>
  </div>
  <p>桥接只绑定 127.0.0.1。每次 SANMAO 请求会在太极网站创建独立新会话；请求内容会发送到太极网站并由其账户计费。</p>
</main></html>`;
}

export function createBridgeServer(options = {}) {
  const token = options.token || randomBytes(32).toString('base64url');
  const pairCode = options.pairCode || String(randomInt(10_000_000, 100_000_000));
  const pairCodeExpiresAt = Date.now() + (options.pairCodeTtlMs ?? 10 * 60_000);
  const jobTimeoutMs = options.jobTimeoutMs ?? DEFAULT_JOB_TIMEOUT_MS;
  const drawJobTimeoutMs = options.drawJobTimeoutMs ?? DEFAULT_DRAW_JOB_TIMEOUT_MS;
  const pollWaitMs = options.pollWaitMs ?? POLL_WAIT_MS;
  const workerFreshMs = options.workerFreshMs ?? WORKER_FRESH_MS;
  const fetchImage = options.fetchImage || fetchTaijiImage;
  let pairAttempts = 0;
  let pairCodeUsed = false;
  let paired = false;
  const lastWorkerAt = { chat: 0, draw: 0 };
  const activeJobIds = { chat: '', draw: '' };
  const jobs = new Map();
  const queuedJobs = { chat: [], draw: [] };
  const pollWaiters = { chat: [], draw: [] };
  let modelCatalog = normalizeModelCatalog(Array.isArray(options.modelCatalog) ? options.modelCatalog : [], null, true);

  function removeQueuedJob(job) {
    const queue = queuedJobs[job.kind];
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
  }

  function settle(job, result) {
    if (!job || job.settled) return;
    job.settled = true;
    job.resolve(result);
  }

  function claimJob(job, response) {
    job.status = 'claimed';
    lastWorkerAt[job.kind] = Date.now();
    const publicJob = {
      id: job.id,
      kind: job.kind,
      model: job.model,
      label: job.label,
      price: job.price,
      prompt: job.prompt,
      createdAt: job.createdAt,
    };
    if (job.request) publicJob.request = job.request;
    sendJson(response, 200, {
      job: publicJob,
    });
  }

  function dispatch(job) {
    const waiters = pollWaiters[job.kind];
    while (waiters.length) {
      const waiter = waiters.shift();
      clearTimeout(waiter.timer);
      if (waiter.response.destroyed || waiter.response.writableEnded) continue;
      claimJob(job, waiter.response);
      return;
    }
    queuedJobs[job.kind].push(job);
  }

  function pollForJob(kind, response) {
    lastWorkerAt[kind] = Date.now();
    options.onWorkerPoll?.(kind);
    if (queuedJobs[kind].length) {
      claimJob(queuedJobs[kind].shift(), response);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const waiter = { response, resolve, timer: null };
      const cleanup = () => {
        const waiters = pollWaiters[kind];
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        resolve();
      };
      waiter.timer = setTimeout(() => {
        if (!response.writableEnded && !response.destroyed) response.writeHead(204, { 'cache-control': 'no-store' }).end();
        cleanup();
      }, pollWaitMs);
      response.once('close', cleanup);
      pollWaiters[kind].push(waiter);
    });
  }

  function enqueueJob({ kind, model, prompt, request: drawRequest }, response) {
    if (activeJobIds[kind] || queuedJobs[kind].length >= MAX_QUEUE_SIZE) {
      throw asHttpError('The Taiji web account bridge is already handling a request of this type.', 429, 'bridge_busy');
    }
    const job = {
      id: randomUUID(),
      kind,
      model: model.id,
      label: model.label,
      price: model.price,
      prompt,
      ...(drawRequest ? { request: drawRequest } : {}),
      status: 'queued',
      createdAt: new Date().toISOString(),
      settled: false,
      resolve: null,
    };
    activeJobIds[kind] = job.id;
    jobs.set(job.id, job);
    const completion = new Promise((resolve) => { job.resolve = resolve; });
    const timeoutMs = kind === 'draw' ? drawJobTimeoutMs : jobTimeoutMs;
    const timer = setTimeout(() => {
      removeQueuedJob(job);
      job.status = 'expired';
      settle(job, { error: 'No confirmed response arrived before the local timeout.', status: 504, code: 'browser_timeout' });
    }, timeoutMs);
    timer.unref?.();
    response.once('close', () => {
      if (response.writableEnded) return;
      if (job.status === 'queued') removeQueuedJob(job);
      job.status = 'abandoned';
      settle(job, { error: 'The SANMAO request closed before the result arrived.', status: 499, code: 'caller_disconnected' });
    });
    dispatch(job);
    return { job, completion, timer };
  }

  function finalizeJob(job, timer) {
    clearTimeout(timer);
    jobs.delete(job.id);
    if (activeJobIds[job.kind] === job.id) activeJobIds[job.kind] = '';
  }

  async function handleChatCompletions(request, response) {
    if (request.headers.origin) return sendError(response, 403, 'This endpoint accepts local server-to-server requests only.', 'origin_denied');
    if (!equalToken(bearerToken(request), API_KEY)) return sendError(response, 401, 'Use the local bridge key configured in SANMAO.', 'unauthorized');

    const body = await readJson(request);
    const selectedModel = modelCatalog.find((model) => model.kind === 'chat' && model.id === body.model)
      || (body.model === 'kimi-k3' ? modelCatalog.find((model) => model.kind === 'chat' && model.id === 'kimi::kimi-k3') : null);
    if (!selectedModel) {
      return sendError(response, 404, `Unsupported model: ${String(body.model || '')}`, 'model_not_found');
    }
    if (body.n !== undefined && body.n !== 1) return sendError(response, 422, 'Only one completion per request is supported.', 'n_unsupported');
    if (!paired || Date.now() - lastWorkerAt.chat > workerFreshMs) {
      return sendError(response, 503, 'Open the paired Taiji chat tab and keep it available.', 'browser_worker_offline');
    }

    const prompt = formatMessages(body.messages);
    const { job, completion, timer } = enqueueJob({ kind: 'chat', model: selectedModel, prompt }, response);
    const result = await completion;
    finalizeJob(job, timer);
    if (response.destroyed || response.writableEnded) return;
    if (result.error) return sendError(response, result.status || 502, result.error, result.code || 'upstream_error');
    if (typeof result.content !== 'string' || !result.content.trim()) {
      return sendError(response, 502, 'The Taiji page returned an empty response.', 'empty_completion');
    }
    if (result.content.length > MAX_RESPONSE_CHARS) {
      return sendError(response, 502, 'The Taiji response exceeds the local bridge limit.', 'response_too_large');
    }
    const completionBody = completeBody(job, result.content);
    if (body.stream === true) sendStream(response, job, result.content);
    else sendJson(response, 200, completionBody);
  }

  async function handleImageGenerations(request, response) {
    if (request.headers.origin) return sendError(response, 403, 'This endpoint accepts local server-to-server requests only.', 'origin_denied');
    if (!equalToken(bearerToken(request), API_KEY)) return sendError(response, 401, 'Use the local bridge key configured in SANMAO.', 'unauthorized');

    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendError(response, 422, 'Image request body must be a JSON object.', 'invalid_image_request');
    }
    const selectedModel = modelCatalog.find((model) => model.kind === 'draw' && model.id === body.model);
    if (!selectedModel) return sendError(response, 404, `Unsupported image model: ${String(body.model || '')}`, 'model_not_found');
    let drawRequest;
    try { drawRequest = buildTaijiDrawRequest(body, selectedModel); }
    catch (error) {
      return sendError(response, Number(error?.status) || 422, error instanceof Error ? error.message : 'Invalid image request.', error?.code || 'invalid_image_request');
    }
    if (!paired || Date.now() - lastWorkerAt.draw > workerFreshMs) {
      return sendError(response, 503, 'Open a paired Taiji draw tab and keep it available.', 'draw_worker_offline');
    }

    const { job, completion, timer } = enqueueJob({ kind: 'draw', model: selectedModel, prompt: drawRequest.prompt, request: drawRequest }, response);
    const result = await completion;
    finalizeJob(job, timer);
    if (response.destroyed || response.writableEnded) return;
    if (result.error) return sendError(response, result.status || 502, result.error, result.code || 'upstream_error');
    if (!Array.isArray(result.images) || result.images.length === 0) {
      return sendError(response, 502, 'The Taiji page returned no image data.', 'empty_image_output');
    }
    return sendJson(response, 200, {
      created: Math.floor(Date.now() / 1000),
      data: result.images.map((image) => ({ b64_json: image.bytes.toString('base64') })),
    });
  }

  function handleImageEdits(request, response) {
    if (request.headers.origin) return sendError(response, 403, 'This endpoint accepts local server-to-server requests only.', 'origin_denied');
    if (!equalToken(bearerToken(request), API_KEY)) return sendError(response, 401, 'Use the local bridge key configured in SANMAO.', 'unauthorized');
    return sendError(response, 422, 'Taiji web image models do not accept reference images or masks through this bridge.', 'reference_images_unsupported');
  }

  async function handleRequest(request, response) {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const pathname = url.pathname;
    if (!isLoopback(request.socket.remoteAddress) || !requestHostAllowed(request)) {
      return sendError(response, 403, 'The bridge is available from this machine only.', 'loopback_only');
    }
    if (request.method === 'OPTIONS') return sendError(response, 403, 'Cross-origin access is disabled.', 'cors_denied');

    if (request.method === 'GET' && (pathname === '/' || pathname === '/setup')) {
      if (!originAllowed(request)) return sendError(response, 403, 'Origin is not allowed.', 'origin_denied');
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
      });
      return response.end(setupPage(pairCode, pairCodeExpiresAt, paired));
    }
    if (request.method === 'GET' && pathname === '/taiji-web-bridge.user.js') {
      const scriptPath = fileURLToPath(new URL('./taiji-web-bridge.user.js', import.meta.url));
      const script = await readFile(scriptPath, 'utf8');
      response.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; script-src 'self'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
      });
      return response.end(script);
    }
    if (request.method === 'GET' && pathname === '/v1/models') {
      if (request.headers.origin) return sendError(response, 403, 'This endpoint accepts local server-to-server requests only.', 'origin_denied');
      if (!equalToken(bearerToken(request), API_KEY)) return sendError(response, 401, 'Use the local bridge key configured in SANMAO.', 'unauthorized');
      if (!modelCatalog.length) return sendError(response, 503, 'Open a paired Taiji tab to sync its model catalog.', 'model_catalog_unavailable');
      return sendJson(response, 200, {
        object: 'list',
        data: modelCatalog.map((model) => ({
          id: model.id,
          // SANMAO normalizes OpenAI-compatible names by stripping path segments.
          // Keep the page price visible without a slash so the display name is not truncated to "次".
          name: model.kind === 'draw' ? `${model.label} [Taiji 绘图]` : `${model.label} [${model.price}]`,
          object: 'model',
          created: 0,
          owned_by: model.providerKey || 'taiji-web',
          capabilities: model.kind === 'draw' ? ['generate'] : ['chat'],
        })),
      });
    }
    if (request.method === 'POST' && pathname === '/v1/chat/completions') {
      return handleChatCompletions(request, response);
    }
    if (request.method === 'POST' && pathname === '/v1/images/generations') {
      return handleImageGenerations(request, response);
    }
    if (request.method === 'POST' && pathname === '/v1/images/edits') {
      return handleImageEdits(request, response);
    }
    if (request.method === 'POST' && pathname === '/bridge/pair') {
      if (!originAllowed(request)) return sendError(response, 403, 'Origin is not allowed.', 'origin_denied');
      if (Date.now() > pairCodeExpiresAt || pairAttempts >= 5 || pairCodeUsed) {
        return sendError(response, 410, 'The pairing code has expired. Restart the bridge for a new code.', 'pairing_expired');
      }
      pairAttempts += 1;
      const body = await readJson(request);
      if (typeof body.code !== 'string' || !equalToken(body.code, pairCode)) {
        return sendError(response, 401, 'The pairing code is incorrect.', 'pairing_failed');
      }
      pairCodeUsed = true;
      paired = true;
      return sendJson(response, 200, { token, paired: true });
    }
    if (request.method === 'POST' && pathname === '/bridge/models/catalog') {
      if (!originAllowed(request)) return sendError(response, 403, 'Origin is not allowed.', 'origin_denied');
      if (!equalToken(bearerToken(request), token)) return sendError(response, 401, 'Pair this browser with the local bridge first.', 'unauthorized');
      const body = await readJson(request);
      const kind = body.kind ?? 'chat';
      if (!JOB_KINDS.includes(kind)) return sendError(response, 422, 'kind must be chat or draw.', 'invalid_model_catalog');
      const models = normalizeModelCatalog(body.models, kind, kind === 'draw');
      const otherModels = modelCatalog.filter((model) => model.kind !== kind);
      modelCatalog = kind === 'chat' ? [...models, ...otherModels] : [...otherModels, ...models];
      return sendJson(response, 200, { accepted: true, count: models.length });
    }
    if (request.method === 'GET' && pathname === '/bridge/jobs/next') {
      if (!originAllowed(request)) return sendError(response, 403, 'Origin is not allowed.', 'origin_denied');
      if (!equalToken(bearerToken(request), token)) return sendError(response, 401, 'Pair this browser with the local bridge first.', 'unauthorized');
      const kind = url.searchParams.get('kind') || 'chat';
      if (!JOB_KINDS.includes(kind)) return sendError(response, 422, 'kind must be chat or draw.', 'invalid_worker_kind');
      paired = true;
      return pollForJob(kind, response);
    }
    const resultMatch = /^\/bridge\/jobs\/([0-9a-f-]+)\/result$/i.exec(pathname);
    if (request.method === 'POST' && resultMatch) {
      if (!originAllowed(request)) return sendError(response, 403, 'Origin is not allowed.', 'origin_denied');
      if (!equalToken(bearerToken(request), token)) return sendError(response, 401, 'Pair this browser with the local bridge first.', 'unauthorized');
      const body = await readJson(request);
      const job = jobs.get(resultMatch[1]);
      if (!job || job.status !== 'claimed') return sendError(response, 410, 'The local request is no longer waiting for a result.', 'job_expired');
      if (job.kind === 'chat' && typeof body.content === 'string') {
        if (body.content.length > MAX_RESPONSE_CHARS) return sendError(response, 413, 'Response is too large.', 'response_too_large');
        job.status = 'completed';
        settle(job, { content: body.content });
      } else if (job.kind === 'draw' && body.status && typeof body.status === 'object') {
        try {
          const urls = taijiDrawImageUrls(body.status);
          const images = await Promise.all(urls.map(async (value) => {
            validateTaijiImageUrl(value);
            const image = await fetchImage(value);
            const bytes = Buffer.from(image?.bytes || []);
            const mimeType = typeof image?.mimeType === 'string' ? image.mimeType.split(';', 1)[0].trim().toLowerCase() : '';
            if (!IMAGE_MIME_TYPES.has(mimeType)) throw asHttpError('Taiji returned a non-image resource.', 502, 'invalid_image_type');
            if (!bytes.length) throw asHttpError('Taiji returned an empty image response.', 502, 'empty_image_output');
            if (bytes.length > MAX_DRAW_IMAGE_BYTES) throw asHttpError('Taiji image exceeds the local bridge size limit.', 502, 'image_too_large');
            return { mimeType, bytes };
          }));
          job.status = 'completed';
          settle(job, { images });
        } catch (error) {
          job.status = 'failed';
          settle(job, {
            error: error instanceof Error ? error.message.slice(0, 300) : 'Taiji image result could not be read.',
            status: Number(error?.status) || 502,
            code: error?.code || 'invalid_draw_result',
          });
        }
      } else if (typeof body.error === 'string') {
        job.status = 'failed';
        settle(job, { error: body.error.slice(0, 300), status: 502, code: 'browser_error' });
      } else {
        return sendError(response, 400, 'Result must contain the expected result for this worker type or an error.', 'invalid_result');
      }
      return sendJson(response, 202, { accepted: true });
    }
    return sendError(response, 404, 'Not found.', 'not_found');
  }

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      const status = Number(error?.status) || 500;
      sendError(response, status, error instanceof Error ? error.message : 'Local bridge error.', error?.code || 'bridge_error');
    });
  });

  return {
    server,
    pairCode,
    token,
    listen: (port = 8787) => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve(server.address());
      });
    }),
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function loadPersistentToken() {
  const statePath = path.resolve(process.cwd(), '.data', 'taiji-web-bridge', 'state.json');
  await mkdir(path.dirname(statePath), { recursive: true });
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    if (typeof state.token === 'string' && state.token.length >= 32) return state.token;
  } catch {
    // Create a local-only token on the first run.
  }
  const token = randomBytes(32).toString('base64url');
  await writeFile(statePath, JSON.stringify({ token }), { encoding: 'utf8', mode: 0o600 });
  return token;
}

async function start() {
  const token = await loadPersistentToken();
  const port = 8787;
  const bridge = createBridgeServer({ token });
  await bridge.listen(port);
  console.log(`Taiji web bridge listening at http://127.0.0.1:${port}/setup`);
  const close = () => void bridge.close().then(() => process.exit(0));
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Failed to start Taiji web bridge.');
    process.exitCode = 1;
  });
}
