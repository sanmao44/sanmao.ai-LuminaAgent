const MODEL_ID = 'Xenova/slimsam-77-uniform';
const MODEL_REVISION = '5850ab45f587c112167512ffef949107115e26a0';
const MODEL_ORIGIN = 'https://huggingface.co/';

const MODEL_FILES = new Map([
  ['config.json', { contentType: 'application/json', maxBytes: 256 * 1024 }],
  ['preprocessor_config.json', { contentType: 'application/json', maxBytes: 1024 * 1024 }],
  ['onnx/vision_encoder_quantized.onnx', { contentType: 'application/octet-stream', maxBytes: 32 * 1024 * 1024 }],
  ['onnx/prompt_encoder_mask_decoder_quantized.onnx', { contentType: 'application/octet-stream', maxBytes: 16 * 1024 * 1024 }],
]);

export type LocalSegmentationModelFetcher = (
  input: string | URL,
  init?: {
    method: 'GET';
    redirect: 'follow';
    headers: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  },
) => Promise<LocalSegmentationModelFetchResponse>;

type LocalSegmentationModelFetchResponse = {
  ok: boolean;
  status: number;
  headers: Pick<Headers, 'get'>;
  body: {
    getReader: () => {
      read: () => Promise<{ done: boolean; value?: Uint8Array }>;
      cancel: () => Promise<void>;
      releaseLock: () => void;
    };
    cancel: () => Promise<void>;
  } | null;
};

export type LocalSegmentationModelResource = {
  url: string;
  contentType: string;
  maxBytes: number;
};

export function resolveLocalSegmentationModelResource(path: readonly string[]): LocalSegmentationModelResource | null {
  if (path.length < 5 || path.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) return null;
  if (path[0] !== 'Xenova' || path[1] !== 'slimsam-77-uniform' || path[2] !== 'resolve' || path[3] !== MODEL_REVISION) return null;

  const filename = path.slice(4).join('/');
  const file = MODEL_FILES.get(filename);
  if (!file) return null;

  const encodedPath = [MODEL_ID, 'resolve', MODEL_REVISION, filename]
    .flatMap((part) => part.split('/'))
    .map(encodeURIComponent)
    .join('/');
  return {
    url: new URL(encodedPath, MODEL_ORIGIN).toString(),
    contentType: file.contentType,
    maxBytes: file.maxBytes,
  };
}

export function resolveLocalSegmentationProxy(environment: Record<string, string | undefined>) {
  const configured = String(environment.SANMAO_LOCAL_SEGMENTATION_PROXY || '').trim();
  if (!configured) return null;

  let proxy: URL;
  try {
    proxy = new URL(configured);
  } catch {
    throw new Error('SANMAO_LOCAL_SEGMENTATION_PROXY 必须是有效的 HTTP 或 HTTPS 代理地址');
  }
  if ((proxy.protocol !== 'http:' && proxy.protocol !== 'https:') || !proxy.hostname) {
    throw new Error('SANMAO_LOCAL_SEGMENTATION_PROXY 必须是有效的 HTTP 或 HTTPS 代理地址');
  }
  return proxy.toString();
}

async function readBoundedBody(response: LocalSegmentationModelFetchResponse, maxBytes: number) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('模型文件超过允许大小');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('模型文件为空');

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) throw new Error('模型文件读取失败');
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('模型文件超过允许大小');
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new Error('模型文件为空');

  const buffer = new ArrayBuffer(total);
  const output = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

export async function fetchLocalSegmentationModelFile(
  path: readonly string[],
  options: {
    environment?: Record<string, string | undefined>;
    fetcher?: LocalSegmentationModelFetcher;
    signal?: AbortSignal;
  } = {},
) {
  const resource = resolveLocalSegmentationModelResource(path);
  if (!resource) return Response.json({ error: '未找到本地智能点选模型文件' }, { status: 404 });

  let closeProxy: (() => Promise<unknown>) | null = null;
  try {
    let fetcher: LocalSegmentationModelFetcher = options.fetcher
      || ((input, init) => globalThis.fetch(input, init));
    const proxy = options.fetcher ? null : resolveLocalSegmentationProxy(options.environment || {});
    if (proxy) {
      const { fetch: proxyFetch, ProxyAgent } = await import('undici');
      const dispatcher = new ProxyAgent(proxy);
      closeProxy = () => dispatcher.close();
      fetcher = (input, init) => proxyFetch(input, { ...init, dispatcher });
    }

    const upstream = await fetcher(resource.url, {
      method: 'GET',
      redirect: 'follow',
      headers: { Accept: resource.contentType },
      signal: options.signal,
    });
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => undefined);
      return Response.json({ error: `模型文件源返回 HTTP ${upstream.status}` }, { status: 502 });
    }

    const body = await readBoundedBody(upstream, resource.maxBytes);
    const headers = new Headers({
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(body.byteLength),
      'Content-Type': resource.contentType,
      'X-Content-Type-Options': 'nosniff',
    });
    const etag = upstream.headers.get('etag');
    if (etag) headers.set('ETag', etag);
    return new Response(body, { headers });
  } catch {
    return Response.json({ error: '模型文件下载失败，请检查网络或代理设置' }, { status: 502 });
  } finally {
    await closeProxy?.().catch(() => undefined);
  }
}
