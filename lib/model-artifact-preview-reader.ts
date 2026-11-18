import { lookup as lookupDns } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import type { LookupAddress, LookupOptions } from 'node:dns';
import type { ModelArtifactPreviewAsset, ModelArtifactPreviewPort } from '@/packages/contracts/model-artifact-preview';

const MAX_MODEL_PREVIEW_BYTES = 200 * 1024 * 1024;
const BLOCKED_HOSTS = new Set(['localhost', 'metadata', 'metadata.google.internal', 'host.docker.internal']);
const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa', '.lan'];

const blockedAddresses = new BlockList();
const publicIpv6Addresses = new BlockList();
publicIpv6Addresses.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
  ['3fff::', 20], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) {
  blockedAddresses.addSubnet(address, prefix, 'ipv6');
}

export class ModelArtifactPreviewReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelArtifactPreviewReadError';
  }
}

type PinnedAddress = LookupAddress;
type FetchedAsset = { response: Response; dispose(): Promise<void> };
type ReaderDependencies = {
  resolveAddresses(hostname: string): Promise<LookupAddress[]>;
  fetchAsset(url: URL, addresses: LookupAddress[], signal: AbortSignal): Promise<FetchedAsset>;
};

function isBlockedAddress(address: string) {
  const normalized = address.replace(/^\[|\]$/g, '');
  const family = isIP(normalized);
  if (family === 6 && /^(?:::ffff:|0:0:0:0:0:ffff:)/i.test(normalized)) return true;
  if (family === 6 && (!publicIpv6Addresses.check(normalized, 'ipv6') || blockedAddresses.check(normalized, 'ipv6'))) return true;
  return family === 0 || blockedAddresses.check(normalized, family === 4 ? 'ipv4' : 'ipv6');
}

function parsePublicUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new ModelArtifactPreviewReadError('模型文件地址无效。'); }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')
    || BLOCKED_HOSTS.has(hostname) || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new ModelArtifactPreviewReadError('模型文件地址不安全，无法在线预览。');
  }
  return url;
}

async function resolvePublicAddresses(hostname: string) {
  const directFamily = isIP(hostname);
  const addresses = directFamily
    ? [{ address: hostname, family: directFamily }]
    : await lookupDns(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new ModelArtifactPreviewReadError('模型文件地址解析到非公网地址，已阻止预览。');
  }
  return addresses;
}

async function fetchPinnedAsset(url: URL, addresses: LookupAddress[], signal: AbortSignal) {
  const expectedHost = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const lookup = (
    hostname: string,
    options: LookupOptions,
    callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ) => {
    if (hostname.toLowerCase() !== expectedHost) {
      const error = Object.assign(new Error('Unexpected model artifact host.'), { code: 'EHOSTUNREACH' });
      callback(error, options.all ? [] : '', 0);
      return;
    }
    const candidates = options.family ? addresses.filter((address) => address.family === options.family) : addresses;
    if (!candidates.length) {
      const error = Object.assign(new Error('No public model artifact address.'), { code: 'EHOSTUNREACH' });
      callback(error, options.all ? [] : '', 0);
      return;
    }
    if (options.all) callback(null, candidates);
    else callback(null, candidates[0].address, candidates[0].family);
  };
  const dispatcher = new Agent({ connect: { lookup } });
  try {
    const response = await undiciFetch(url, {
      method: 'GET',
      headers: { Accept: 'model/gltf-binary, application/octet-stream;q=0.9, */*;q=0.1', 'Accept-Encoding': 'identity' },
      redirect: 'error',
      signal,
      dispatcher,
    });
    let disposed = false;
    return {
      response: response as unknown as Response,
      async dispose() {
        if (disposed) return;
        disposed = true;
        await dispatcher.destroy();
      },
    };
  } catch (error) {
    await dispatcher.destroy();
    throw error;
  }
}

function readUint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function combineChunks(chunks: Uint8Array[], length: number) {
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

async function disposeResponse(response: Response, dispose: () => Promise<void>) {
  await response.body?.cancel().catch(() => undefined);
  await dispose();
}

async function openGlb(
  response: Response,
  dispose: () => Promise<void>,
  refreshIdleTimeout: () => void,
): Promise<ModelArtifactPreviewAsset> {
  if (!response.ok || !response.body) {
    await disposeResponse(response, dispose);
    throw new ModelArtifactPreviewReadError(`模型文件服务返回 HTTP ${response.status}。`);
  }
  const declaredHeaderValue = response.headers.get('content-length');
  const declaredHeader = declaredHeaderValue === null ? null : Number(declaredHeaderValue);
  if (declaredHeader !== null && (!Number.isSafeInteger(declaredHeader) || declaredHeader < 12 || declaredHeader > MAX_MODEL_PREVIEW_BYTES)) {
    await disposeResponse(response, dispose);
    throw new ModelArtifactPreviewReadError('模型文件大小无效或超过 200 MiB，无法在线预览。');
  }

  const reader = response.body.getReader();
  const headerChunks: Uint8Array[] = [];
  let headerLength = 0;
  try {
    while (headerLength < 12) {
      refreshIdleTimeout();
      const { done, value } = await reader.read();
      if (done) throw new ModelArtifactPreviewReadError('模型文件不完整或不是有效的 GLB。');
      headerChunks.push(value);
      headerLength += value.byteLength;
    }
  } catch (error) {
    reader.releaseLock();
    throw error;
  }
  const firstChunk = combineChunks(headerChunks, headerLength);
  const signature = String.fromCharCode(...firstChunk.subarray(0, 4));
  const version = readUint32(firstChunk, 4);
  const contentLength = readUint32(firstChunk, 8);
  if (signature !== 'glTF' || version !== 2 || contentLength < 12 || contentLength > MAX_MODEL_PREVIEW_BYTES
    || declaredHeader !== null && declaredHeader !== contentLength || firstChunk.byteLength > contentLength) {
    reader.releaseLock();
    throw new ModelArtifactPreviewReadError('模型文件不完整或不是有效的 GLB。');
  }

  let sentBytes = 0;
  let firstPending = true;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (firstPending) {
          firstPending = false;
          sentBytes = firstChunk.byteLength;
          controller.enqueue(firstChunk);
          return;
        }
        refreshIdleTimeout();
        const { done, value } = await reader.read();
        if (done) {
          reader.releaseLock();
          await dispose();
          if (sentBytes !== contentLength) controller.error(new ModelArtifactPreviewReadError('模型文件下载不完整。'));
          else controller.close();
          return;
        }
        sentBytes += value.byteLength;
        if (sentBytes > contentLength || sentBytes > MAX_MODEL_PREVIEW_BYTES) {
          await reader.cancel();
          reader.releaseLock();
          await dispose();
          controller.error(new ModelArtifactPreviewReadError('模型文件大小与文件头信息不一致。'));
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        try { reader.releaseLock(); } catch {}
        await dispose();
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      try { reader.releaseLock(); } catch {}
      await dispose();
    },
  });
  return { body, contentLength, contentType: 'model/gltf-binary' };
}

export function createModelArtifactPreviewReader(dependencies: ReaderDependencies): ModelArtifactPreviewPort {
  return {
    async open(value: string) {
      const url = parsePublicUrl(value);
      const addresses = await dependencies.resolveAddresses(url.hostname.replace(/^\[|\]$/g, ''));
      if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) {
        throw new ModelArtifactPreviewReadError('模型文件地址解析到非公网地址，已阻止预览。');
      }
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const refreshIdleTimeout = () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => controller.abort(), 60_000);
      };
      refreshIdleTimeout();
      let fetched: FetchedAsset | null = null;
      let streamOwnsConnection = false;
      let disposed = false;
      const disposeFetched = async () => {
        if (disposed || !fetched) return;
        disposed = true;
        if (timeout) clearTimeout(timeout);
        timeout = null;
        await fetched.dispose();
      };
      try {
        fetched = await dependencies.fetchAsset(url, addresses as PinnedAddress[], controller.signal);
        const asset = await openGlb(fetched.response, disposeFetched, refreshIdleTimeout);
        streamOwnsConnection = true;
        return asset;
      } catch (error) {
        if (error instanceof ModelArtifactPreviewReadError) throw error;
        throw new ModelArtifactPreviewReadError('无法从模型存储读取 GLB 文件，请稍后重试。');
      } finally {
        if (!streamOwnsConnection) {
          if (timeout) clearTimeout(timeout);
          if (fetched) await disposeResponse(fetched.response, disposeFetched);
        }
      }
    },
  };
}

export const modelArtifactPreviewReader = createModelArtifactPreviewReader({
  resolveAddresses: resolvePublicAddresses,
  fetchAsset: fetchPinnedAsset,
});
