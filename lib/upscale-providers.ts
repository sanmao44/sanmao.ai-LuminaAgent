import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { UpscaleConnectionCredentials } from './store';
import type { UpscaleModelId, UpscaleOutputFormat, UpscaleProviderId } from './types';

export type UpscaleProviderErrorCode =
  | 'INVALID_CREDENTIAL'
  | 'SIGNATURE_INVALID'
  | 'NOT_PURCHASED'
  | 'PERMISSION_DENIED'
  | 'INSUFFICIENT_BALANCE'
  | 'IMAGE_TOO_LARGE'
  | 'INVALID_IMAGE'
  | 'TASK_TIMEOUT'
  | 'UPSTREAM_ERROR';

export class UpscaleProviderError extends Error {
  readonly code: UpscaleProviderErrorCode;
  readonly providerCode?: string;
  readonly status?: number;
  readonly requestId?: string;

  constructor(message: string, code: UpscaleProviderErrorCode, details: { providerCode?: string; status?: number; requestId?: string } = {}) {
    super(message);
    this.name = 'UpscaleProviderError';
    this.code = code;
    this.providerCode = details.providerCode;
    this.status = details.status;
    this.requestId = details.requestId;
  }
}

export type UpscaleInput = {
  imageUrl: string;
  scale: 1 | 2 | 3 | 4;
  modelId: UpscaleModelId;
  outputFormat?: UpscaleOutputFormat;
  outputQuality?: number;
  signal?: AbortSignal;
};

export type UpscaleBinaryResult = {
  status: 'succeeded';
  provider: UpscaleProviderId;
  model: UpscaleModelId;
  buffer: Buffer;
  mime: string;
  providerTaskId?: string;
  requestId?: string;
};

export type UpscaleQueuedResult = {
  status: 'queued' | 'processing';
  provider: UpscaleProviderId;
  model: UpscaleModelId;
  providerTaskId: string;
  requestId?: string;
};

export type UpscaleResult = UpscaleBinaryResult | UpscaleQueuedResult;

export type ConnectionResult = {
  ok: true;
  provider: UpscaleProviderId;
  bucket?: string;
  region?: string;
  buckets?: Array<{ name: string; region: string }>;
};

export type UpscaleProvider = {
  id: UpscaleProviderId;
  testConnection(): Promise<ConnectionResult>;
  upscale(input: UpscaleInput): Promise<UpscaleResult>;
  poll?(providerTaskId: string, input?: Pick<UpscaleInput, 'modelId' | 'signal'>): Promise<UpscaleResult>;
};

function rfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function cosEncode(value: string) {
  return rfc3986(value);
}

function encodeCosPath(value: string) {
  return value.split('/').map((part) => cosEncode(part)).join('/') || '/';
}

function sha1(value: string) {
  return createHash('sha1').update(value).digest('hex');
}

function hmacSha1(key: string, value: string) {
  return createHmac('sha1', key).update(value).digest('hex');
}

export function buildTencentCosAuthorization(options: {
  method: string;
  url: string;
  secretId: string;
  secretKey: string;
  nowSeconds?: number;
  expiresSeconds?: number;
  headers?: Array<[string, string]>;
}) {
  const parsed = new URL(options.url);
  const start = Math.floor(options.nowSeconds ?? Date.now() / 1000);
  const end = start + Math.max(60, Math.min(900, options.expiresSeconds ?? 600));
  const signTime = `${start};${end}`;
  const queryEntries = [...parsed.searchParams.entries()].map(([key, value]) => [key.toLowerCase(), value] as [string, string]).sort(([left], [right]) => left.localeCompare(right));
  const headerEntries: Array<[string, string]> = [['host', parsed.host.toLowerCase()], ...(options.headers || [])].map(([key, value]) => [key.toLowerCase(), value] as [string, string]).sort(([left], [right]) => left.localeCompare(right));
  const canonicalQuery = queryEntries.map(([key, value]) => `${cosEncode(key)}=${cosEncode(value)}`).join('&');
  const canonicalHeaders = headerEntries.map(([key, value]) => `${cosEncode(key)}=${cosEncode(value)}`).join('&');
  const httpString = `${options.method.toLowerCase()}\n${encodeCosPath(parsed.pathname)}\n${canonicalQuery}\n${canonicalHeaders}\n`;
  const signKey = hmacSha1(options.secretKey, signTime);
  const stringToSign = `sha1\n${signTime}\n${sha1(httpString)}\n`;
  const signature = hmacSha1(signKey, stringToSign);
  return `q-sign-algorithm=sha1&q-ak=${cosEncode(options.secretId)}&q-sign-time=${signTime}&q-key-time=${signTime}&q-header-list=${headerEntries.map(([key]) => cosEncode(key)).join(';')}&q-url-param-list=${queryEntries.map(([key]) => cosEncode(key)).join(';')}&q-signature=${signature}`;
}

function xmlUnescape(value: string) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function xmlValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? xmlUnescape(match[1].trim()) : '';
}

function xmlError(xml: string) {
  return { code: xmlValue(xml, 'Code'), message: xmlValue(xml, 'Message'), requestId: xmlValue(xml, 'RequestId') };
}

function mapProviderError(providerCode: string, status: number | undefined, requestId?: string, fallback = '云端高清处理失败', provider?: UpscaleProviderId) {
  const code = String(providerCode || '').toLowerCase();
  if (/invalidaccesskey|invalidcredential|unauthorized/.test(code) || status === 401) return new UpscaleProviderError('访问密钥无效，请检查后重新连接。', 'INVALID_CREDENTIAL', { providerCode, status, requestId });
  if (/signaturedoesnotmatch|authfailure|signatureinvalid/.test(code)) return new UpscaleProviderError('密钥验证失败，请确认 Secret 是否正确。', 'SIGNATURE_INVALID', { providerCode, status, requestId });
  if (/unsupported.?http.?method|method.?not.?allowed/.test(code) || status === 405) return new UpscaleProviderError('阿里云接口请求方式不兼容，请更新 SANMAO.AI 后重试。', 'UPSTREAM_ERROR', { providerCode, status, requestId });
  if (/notpurchase|notpurchased|service.?not.?enabled|unsubscribed/.test(code)) return new UpscaleProviderError('该 AI 服务尚未开通，请先前往官方控制台开通。', 'NOT_PURCHASED', { providerCode, status, requestId });
  if (/permission|forbidden|no.?permission|access.?denied/.test(code) || status === 403) return new UpscaleProviderError(provider === 'aliyun-viapi' ? '阿里云图像生产服务尚未开通，或当前 AccessKey 没有该能力权限。请先开通图像生产；如使用子账号，再配置 AliyunVIAPIFullAccess。' : provider === 'tencent-ci' ? '腾讯云暂无处理权限。请确认该存储桶已开启“数据万象（CI）”、已开通对应图像处理服务，且该桶属于当前账号。' : '当前账号没有调用此功能的权限，请检查云平台授权。', 'PERMISSION_DENIED', { providerCode, status, requestId });
  if (/balance|quota|insufficient|arrears/.test(code)) return new UpscaleProviderError('云平台余额或额度不足，请充值后再试。', 'INSUFFICIENT_BALANCE', { providerCode, status, requestId });
  if (/size|too.?large|oversize|filesize|image.?limit/.test(code) || status === 413) return new UpscaleProviderError('这张图片超过该模型支持的尺寸，请选择较小图片或其他模型。', 'IMAGE_TOO_LARGE', { providerCode, status, requestId });
  if (/image|url|format|parameter|invalidarg/.test(code) && status && status < 500) {
    const isAliyunUrl = provider === 'aliyun-viapi' && /invalidimage\.?url|invalid.?url|图片链接/.test(code);
    return new UpscaleProviderError(isAliyunUrl ? '阿里云超分要求图片先上传到其上海临时存储地址，系统已自动处理；若仍然失败，请重试或更换图片。' : '图片格式或参数不符合云端高清处理要求，请更换图片后重试。', 'INVALID_IMAGE', { providerCode, status, requestId });
  }
  return new UpscaleProviderError(fallback, 'UPSTREAM_ERROR', { providerCode, status, requestId });
}

function requestIdFromHeaders(headers: Headers) {
  return headers.get('x-request-id') || headers.get('x-cos-request-id') || headers.get('x-acs-request-id') || headers.get('request-id') || undefined;
}

function assertImageResponse(response: Response, provider: UpscaleProviderId) {
  const mime = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (!response.ok) throw new UpscaleProviderError(provider === 'tencent-ci' ? '腾讯云高清处理失败，请检查数据万象是否已开通。' : '阿里云高清处理失败，请检查图像生产服务状态。', 'UPSTREAM_ERROR', { status: response.status, requestId: requestIdFromHeaders(response.headers) });
  if (!mime.startsWith('image/')) throw new UpscaleProviderError('云端返回的不是有效图片，请稍后重试。', 'UPSTREAM_ERROR', { status: response.status, requestId: requestIdFromHeaders(response.headers) });
  return mime;
}

async function downloadImage(url: string, provider: UpscaleProviderId, signal?: AbortSignal) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new UpscaleProviderError('云端没有返回有效的图片地址。', 'UPSTREAM_ERROR'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new UpscaleProviderError('云端返回的图片地址无效。', 'UPSTREAM_ERROR');
  const response = await fetch(parsed, { signal: signal || AbortSignal.timeout(60_000), redirect: 'error' });
  const mime = assertImageResponse(response, provider);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > 100 * 1024 * 1024) throw new UpscaleProviderError('高清图片超过 100MB，无法保存。', 'IMAGE_TOO_LARGE');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.byteLength > 100 * 1024 * 1024) throw new UpscaleProviderError('高清图片超过 100MB，无法保存。', 'IMAGE_TOO_LARGE');
  return { buffer, mime };
}

function aliyunOutputParams(input: UpscaleInput, defaultFormat: UpscaleOutputFormat) {
  const outputFormat: UpscaleOutputFormat = input.outputFormat === 'png' || input.outputFormat === 'jpg' || input.outputFormat === 'bmp' ? input.outputFormat : defaultFormat;
  const params: Record<string, string> = { OutputFormat: outputFormat };
  if (outputFormat === 'jpg') {
    const quality = Number(input.outputQuality);
    params.OutputQuality = String(Number.isFinite(quality) ? Math.max(30, Math.min(100, Math.round(quality))) : 95);
  }
  return params;
}

async function listTencentBuckets(credentials: UpscaleConnectionCredentials, signal?: AbortSignal) {
  const url = 'https://service.cos.myqcloud.com/';
  const secretId = credentials.secretId || '';
  const secretKey = credentials.secretKey || '';
  const response = await fetch(url, {
    method: 'GET',
    headers: { Host: 'service.cos.myqcloud.com', Authorization: buildTencentCosAuthorization({ method: 'GET', url, secretId, secretKey }) },
    signal: signal || AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    const error = xmlError(text);
    throw mapProviderError(error.code, response.status, error.requestId || requestIdFromHeaders(response.headers), '腾讯云凭证验证失败，请检查 SecretId 和 SecretKey。', 'tencent-ci');
  }
  const buckets: Array<{ name: string; region: string }> = [];
  const matches = text.match(/<Bucket>[\s\S]*?<\/Bucket>/gi) || [];
  for (const item of matches) {
    const name = xmlValue(item, 'Name');
    const region = xmlValue(item, 'Location') || xmlValue(item, 'Region');
    if (name) buckets.push({ name, region });
  }
  return buckets;
}

function tencentCosExtension(mime: string) {
  const value = String(mime || '').split(';', 1)[0].trim().toLowerCase();
  if (value === 'image/jpeg' || value === 'image/jpg') return '.jpg';
  if (value === 'image/png') return '.png';
  if (value === 'image/webp') return '.webp';
  return '.jpg';
}

async function resolveTencentBucket(credentials: UpscaleConnectionCredentials, signal?: AbortSignal): Promise<{ bucket: string; region: string }> {
  let bucket = credentials.bucket;
  let region = credentials.region;
  if (bucket && region) return { bucket, region };
  const buckets = await listTencentBuckets(credentials, signal);
  let selected = bucket ? buckets.find((item) => item.name === bucket) : undefined;
  if (!selected && buckets.length === 1) selected = buckets[0];
  if (!bucket && !selected) throw new UpscaleProviderError('请先在腾讯云连接向导中选择存储桶。', 'PERMISSION_DENIED');
  if (bucket && !selected) throw new UpscaleProviderError('当前腾讯云账号找不到已保存的存储桶，请重新选择。', 'PERMISSION_DENIED');
  const nextBucket = bucket || selected!.name;
  const nextRegion = region || selected!.region;
  if (!nextRegion) throw new UpscaleProviderError('未能识别腾讯云存储桶所在区域，请重新检测连接并选择存储桶。', 'PERMISSION_DENIED');
  return { bucket: nextBucket, region: nextRegion };
}

function tencentCiObjectUrl(bucket: string, region: string, sourceUrl: string, scale: number) {
  const source = new URL(sourceUrl);
  const host = `${bucket}.cos.${region}.myqcloud.com`;
  const url = new URL(`https://${host}/`);
  url.pathname = source.pathname;
  url.searchParams.set('ci-process', 'AISuperResolution');
  url.searchParams.set('magnify', String(scale));
  return url.toString();
}

/** Uploads prepared image bytes to the user's own COS bucket and returns the object URL. */
export async function uploadTencentImageToCos(credentials: UpscaleConnectionCredentials, bytes: Buffer, mime: string, signal?: AbortSignal) {
  const secretId = credentials.secretId || '';
  const secretKey = credentials.secretKey || '';
  if (!secretId || !secretKey) throw new UpscaleProviderError('请填写腾讯云 SecretId 和 SecretKey。', 'INVALID_CREDENTIAL');
  const { bucket, region } = await resolveTencentBucket(credentials, signal);
  const contentType = String(mime || 'image/jpeg');
  const objectKey = `super-resolution-input/${secretId}/${randomUUID()}/upload-${Date.now()}${tencentCosExtension(contentType)}`;
  const host = `${bucket}.cos.${region}.myqcloud.com`;
  const url = `https://${host}/${objectKey}`;
  const authorization = buildTencentCosAuthorization({ method: 'PUT', url, secretId, secretKey, headers: [['content-type', contentType]] });
  const response = await fetch(url, { method: 'PUT', signal: signal || AbortSignal.timeout(60_000), headers: { Host: host, Authorization: authorization, 'Content-Type': contentType }, body: new Uint8Array(bytes) });
  if (!response.ok) {
    const text = await response.text();
    const error = xmlError(text);
    throw new UpscaleProviderError('腾讯云临时图片上传失败，请稍后重试。', 'UPSTREAM_ERROR', { providerCode: error.code, status: response.status, requestId: error.requestId || requestIdFromHeaders(response.headers) });
  }
  return url.toString();
}

function createTencentProvider(credentials: UpscaleConnectionCredentials): UpscaleProvider {
  return {
    id: 'tencent-ci',
    async testConnection() {
      if (!credentials.secretId || !credentials.secretKey) throw new UpscaleProviderError('请填写腾讯云 SecretId 和 SecretKey。', 'INVALID_CREDENTIAL');
      const buckets = await listTencentBuckets(credentials);
      if (credentials.bucket) {
        const selected = buckets.find((bucket) => bucket.name === credentials.bucket);
        if (!selected) throw new UpscaleProviderError('当前腾讯云账号找不到已保存的存储桶，请重新选择。', 'PERMISSION_DENIED');
        return { ok: true, provider: 'tencent-ci', bucket: selected.name, region: selected.region, buckets };
      }
      if (buckets.length === 1) return { ok: true, provider: 'tencent-ci', bucket: buckets[0].name, region: buckets[0].region, buckets };
      return { ok: true, provider: 'tencent-ci', buckets };
    },
    async upscale(input) {
      const { bucket, region } = await resolveTencentBucket(credentials, input.signal);
      const url = tencentCiObjectUrl(bucket, region, input.imageUrl, input.scale);
      const authorization = buildTencentCosAuthorization({ method: 'GET', url, secretId: credentials.secretId || '', secretKey: credentials.secretKey || '' });
      const response = await fetch(url, { headers: { Host: new URL(url).host, Authorization: authorization }, signal: input.signal || AbortSignal.timeout(180_000) });
      if (!response.ok) {
        const error = xmlError(await response.text());
        throw mapProviderError(error.code, response.status, error.requestId || requestIdFromHeaders(response.headers), '腾讯云高清处理失败，请检查数据万象是否已开通。', 'tencent-ci');
      }
      const mime = assertImageResponse(response, 'tencent-ci');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new UpscaleProviderError('腾讯云没有返回图片结果。', 'UPSTREAM_ERROR');
      return { status: 'succeeded', provider: 'tencent-ci', model: input.modelId, buffer: bytes, mime, requestId: requestIdFromHeaders(response.headers) };
    },
  };
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function nestedValue(root: unknown, keys: string[]): string {
  if (!root || typeof root !== 'object') return '';
  const object = asObject(root);
  for (const key of keys) if (object[key] !== undefined) {
    const value = stringValue(object[key]);
    if (value) return value;
  }
  for (const child of Object.values(object)) {
    const result = nestedValue(child, keys);
    if (result) return result;
  }
  return '';
}

export function buildAliyunRpcSignature(options: { method?: string; action: string; accessKeyId: string; accessKeySecret: string; params?: Record<string, string>; timestamp?: string; nonce?: string; version?: string }) {
  const common: Record<string, string> = {
    AccessKeyId: options.accessKeyId,
    Action: options.action,
    Format: 'JSON',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: options.nonce || randomUUID(),
    SignatureVersion: '1.0',
    Timestamp: options.timestamp || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: options.version || '2019-09-30',
    ...(options.params || {}),
  };
  const canonicalQuery = Object.keys(common).sort().map((key) => `${rfc3986(key)}=${rfc3986(common[key])}`).join('&');
  const method = (options.method || 'POST').toUpperCase();
  const stringToSign = `${method}&${rfc3986('/')}&${rfc3986(canonicalQuery)}`;
  const signature = createHmac('sha1', `${options.accessKeySecret}&`).update(stringToSign).digest('base64');
  const query = `${canonicalQuery}&Signature=${rfc3986(signature)}`;
  return { query, signature, canonicalQuery, stringToSign };
}

function aliError(payload: JsonObject, status: number, requestId?: string) {
  const code = stringValue(payload.Code || payload.code || nestedValue(payload, ['Code', 'code']));
  return mapProviderError(code, status, requestId || stringValue(payload.RequestId || payload.requestId), '阿里云图像生产请求失败，请检查服务状态或稍后重试。', 'aliyun-viapi');
}

async function aliyunRpc(credentials: UpscaleConnectionCredentials, action: string, params: Record<string, string>, signal?: AbortSignal, rpcOptions?: { endpoint?: string; version?: string }): Promise<{ payload: JsonObject; requestId?: string }> {
  if (!credentials.accessKeyId || !credentials.accessKeySecret) throw new UpscaleProviderError('请填写阿里云 AccessKey ID 和 AccessKey Secret。', 'INVALID_CREDENTIAL');
  const endpoint = rpcOptions?.endpoint || 'https://imageenhan.cn-shanghai.aliyuncs.com/';
  const method = 'POST';
  const signed = buildAliyunRpcSignature({ method, action, accessKeyId: credentials.accessKeyId, accessKeySecret: credentials.accessKeySecret, params, version: rpcOptions?.version });
  const response = await fetch(`${endpoint}?${signed.query}`, { method, signal: signal || AbortSignal.timeout(60_000), headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } });
  const requestId = requestIdFromHeaders(response.headers);
  const text = await response.text();
  let payload: JsonObject = {};
  try { payload = asObject(text ? JSON.parse(text) as unknown : {}); } catch { throw new UpscaleProviderError('阿里云返回了无法解析的结果。', 'UPSTREAM_ERROR', { status: response.status, requestId }); }
  if (!response.ok || payload.Code || payload.code || payload.ErrorCode) throw aliError(payload, response.status, requestId);
  return { payload, requestId: requestId || stringValue(payload.RequestId || payload.requestId) || undefined };
}

function resultUrl(payload: JsonObject) {
  const candidate = nestedValue(payload, ['ResultUrl', 'ResultURL', 'resultUrl', 'result_url', 'ImageUrl', 'ImageURL', 'imageUrl', 'image_url', 'Url', 'url', 'Result', 'result']);
  if (/^https?:\/\//i.test(candidate)) return candidate;
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object') {
        const nested = nestedValue(parsed, ['resultUrl', 'result_url', 'url', 'imageUrl', 'ImageUrl', 'ResultUrl', 'URL']);
        if (/^https?:\/\//i.test(nested)) return nested;
      }
    } catch {}
  }
  return '';
}

function jobId(payload: JsonObject) {
  return nestedValue(payload, ['JobId', 'JobID', 'jobId', 'TaskId', 'taskId', 'RequestId', 'requestId']);
}

function aliTaskState(payload: JsonObject): 'queued' | 'processing' | 'succeeded' | 'failed' {
  const status = nestedValue(payload, ['Status', 'status', 'State', 'state', 'JobStatus', 'jobStatus']).toUpperCase();
  if (/SUCCESS|SUCCEEDED|COMPLETED|FINISH/.test(status)) return 'succeeded';
  if (/FAIL|ERROR|CANCEL/.test(status)) return 'failed';
  if (/RUN|PROCESS|DOING/.test(status)) return 'processing';
  return 'queued';
}

const ALIYUN_OSS_BUCKET = 'viapi-customer-temp';
const ALIYUN_OSS_HOST = 'viapi-customer-temp.oss-cn-shanghai.aliyuncs.com';
const ALIYUN_OSS_ENDPOINT = `https://${ALIYUN_OSS_HOST}/`;

function aliyunOssExtension(mime: string) {
  const value = String(mime || '').split(';', 1)[0].trim().toLowerCase();
  if (value === 'image/jpeg' || value === 'image/jpg') return '.jpg';
  if (value === 'image/png') return '.png';
  if (value === 'image/bmp') return '.bmp';
  if (value === 'image/webp') return '.webp';
  return '.jpg';
}

function buildAliyunOssSignature(options: { method: string; url: string; bucket: string; accessKeyId: string; accessKeySecret: string; securityToken?: string; contentType?: string; contentMd5?: string; date?: string }) {
  const parsed = new URL(options.url);
  const resource = `/${options.bucket}${parsed.pathname}`;
  const headers: Array<{ name: string; value: string }> = [];
  if (options.securityToken) headers.push({ name: 'x-oss-security-token', value: options.securityToken });
  headers.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const canonicalizedHeaders = headers.length ? headers.map((header) => `${header.name.toLowerCase()}:${header.value}`).join('\n') + '\n' : '';
  const stringToSign = `${options.method.toUpperCase()}\n${options.contentMd5 || ''}\n${options.contentType || ''}\n${options.date || ''}\n${canonicalizedHeaders}${resource}`;
  return createHmac('sha1', options.accessKeySecret).update(stringToSign).digest('base64');
}

async function getAliyunOssStsToken(credentials: UpscaleConnectionCredentials, signal?: AbortSignal) {
  const response = await aliyunRpc(credentials, 'GetOssStsToken', {}, signal, { endpoint: 'https://viapiutils.cn-shanghai.aliyuncs.com/', version: '2020-04-01' });
  const data = asObject(response.payload.Data ?? response.payload.data);
  const accessKeyId = stringValue(data.AccessKeyId ?? data.accessKeyId);
  const accessKeySecret = stringValue(data.AccessKeySecret ?? data.accessKeySecret);
  const securityToken = stringValue(data.SecurityToken ?? data.securityToken ?? data.StsToken ?? data.stsToken);
  if (!accessKeyId || !accessKeySecret || !securityToken) throw new UpscaleProviderError('阿里云返回的临时凭证不完整，请稍后重试。', 'UPSTREAM_ERROR', { requestId: response.requestId });
  return { accessKeyId, accessKeySecret, securityToken };
}

/** Uploads prepared image bytes to the shared VIAPI OSS bucket and returns the public OSS URL. */
export async function uploadAliyunImageToOss(credentials: UpscaleConnectionCredentials, bytes: Buffer, mime: string, signal?: AbortSignal) {
  const sts = await getAliyunOssStsToken(credentials, signal);
  const contentType = String(mime || 'image/jpeg');
  const objectKey = `${credentials.accessKeyId}/${randomUUID()}/upload-${Date.now()}${aliyunOssExtension(contentType)}`;
  const url = new URL(`${ALIYUN_OSS_ENDPOINT}${objectKey}`);
  const contentMd5 = createHash('md5').update(bytes).digest('base64');
  const date = new Date().toUTCString();
  const signature = buildAliyunOssSignature({ method: 'PUT', url: url.toString(), bucket: ALIYUN_OSS_BUCKET, accessKeyId: sts.accessKeyId, accessKeySecret: sts.accessKeySecret, securityToken: sts.securityToken, contentType, contentMd5, date });
  const response = await fetch(url, { method: 'PUT', signal: signal || AbortSignal.timeout(60_000), headers: { Authorization: `OSS ${sts.accessKeyId}:${signature}`, 'x-oss-security-token': sts.securityToken, 'Content-Type': contentType, 'Content-MD5': contentMd5, Date: date }, body: new Uint8Array(bytes) });
  if (!response.ok) {
    const text = await response.text();
    const error = xmlError(text);
    throw new UpscaleProviderError('阿里云临时图片上传失败，请稍后重试。', 'UPSTREAM_ERROR', { providerCode: error.code, status: response.status, requestId: error.requestId || requestIdFromHeaders(response.headers) });
  }
  return url.toString();
}

function createAliyunProvider(credentials: UpscaleConnectionCredentials): UpscaleProvider {
  const provider: UpscaleProvider = {
    id: 'aliyun-viapi',
    async testConnection() {
      await getAliyunOssStsToken(credentials);
      return { ok: true, provider: 'aliyun-viapi' };
    },
    async upscale(input) {
      if (input.modelId === 'aliyun-generative-super-resolution') {
        const response = await aliyunRpc(credentials, 'GenerateSuperResolutionImage', { ImageUrl: input.imageUrl, Scale: String(input.scale), ...aliyunOutputParams(input, 'jpg') }, input.signal);
        const immediate = resultUrl(response.payload);
        if (immediate) {
          const downloaded = await downloadImage(immediate, 'aliyun-viapi', input.signal);
          return { status: 'succeeded', provider: 'aliyun-viapi', model: input.modelId, ...downloaded, requestId: response.requestId };
        }
        const task = jobId(response.payload);
        if (!task) throw new UpscaleProviderError('阿里云没有返回生成式超分任务编号。', 'UPSTREAM_ERROR', { requestId: response.requestId });
        return { status: 'queued', provider: 'aliyun-viapi', model: input.modelId, providerTaskId: task, requestId: response.requestId };
      }
      const response = await aliyunRpc(credentials, 'MakeSuperResolutionImage', { Url: input.imageUrl, UpscaleFactor: String(input.scale), ...aliyunOutputParams(input, 'png') }, input.signal);
      const url = resultUrl(response.payload);
      if (!url) throw new UpscaleProviderError('阿里云没有返回标准超分结果地址。', 'UPSTREAM_ERROR', { requestId: response.requestId });
      const downloaded = await downloadImage(url, 'aliyun-viapi', input.signal);
      return { status: 'succeeded', provider: 'aliyun-viapi', model: input.modelId, ...downloaded, requestId: response.requestId };
    },
    async poll(providerTaskId, input) {
      const response = await aliyunRpc(credentials, 'GetAsyncJobResult', { JobId: providerTaskId }, input?.signal);
      const state = aliTaskState(response.payload);
      if (state === 'failed') throw new UpscaleProviderError('阿里云生成式高清处理失败，请稍后重试。', 'UPSTREAM_ERROR', { requestId: response.requestId });
      if (state !== 'succeeded') return { status: state, provider: 'aliyun-viapi', model: input?.modelId || 'aliyun-generative-super-resolution', providerTaskId, requestId: response.requestId };
      const url = resultUrl(response.payload);
      if (!url) throw new UpscaleProviderError('阿里云任务已完成，但没有返回结果图片。', 'UPSTREAM_ERROR', { requestId: response.requestId });
      const downloaded = await downloadImage(url, 'aliyun-viapi', input?.signal);
      return { status: 'succeeded', provider: 'aliyun-viapi', model: input?.modelId || 'aliyun-generative-super-resolution', providerTaskId, ...downloaded, requestId: response.requestId };
    },
  };
  return provider;
}

export function createUpscaleProvider(provider: UpscaleProviderId, credentials: UpscaleConnectionCredentials): UpscaleProvider {
  return provider === 'tencent-ci' ? createTencentProvider(credentials) : createAliyunProvider(credentials);
}

export function isUpscaleProviderError(error: unknown): error is UpscaleProviderError {
  return error instanceof UpscaleProviderError;
}
