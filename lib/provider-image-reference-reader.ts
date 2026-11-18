import { lookup as lookupDns } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';

export const PROVIDER_IMAGE_REFERENCE_MAX_BYTES = 25 * 1024 * 1024;

const blockedIpv4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedIpv4.addSubnet(address, prefix, 'ipv4');

const publicIpv6 = new BlockList();
publicIpv6.addSubnet('2000::', 3, 'ipv6');
const blockedIpv6 = new BlockList();
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
  ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) blockedIpv6.addSubnet(address, prefix, 'ipv6');

const BLOCKED_HOSTS = new Set(['localhost', 'metadata', 'metadata.google.internal', 'host.docker.internal']);
const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa', '.lan'];

export class ProviderImageReferenceReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderImageReferenceReadError';
  }
}

type PinnedLookup = (
  hostname: string,
  options: LookupOptions,
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) => void;

type ImageReferenceReaderDependencies = {
  resolveAddresses(hostname: string): Promise<LookupAddress[]>;
  requestAsset(url: URL, init: UndiciRequestInit & { dispatcher: Agent }): Promise<Response>;
  createDispatcher?(lookup: PinnedLookup): Agent;
  maxBytes?: number;
};

function normalizedHostname(value: string) {
  return value.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

export function isPublicImageAddress(value: string) {
  const address = value.replace(/^\[|\]$/g, '');
  const family = isIP(address);
  if (family === 4) return !blockedIpv4.check(address, 'ipv4');
  if (family === 6) return publicIpv6.check(address, 'ipv6') && !blockedIpv6.check(address, 'ipv6');
  return false;
}

function parsePublicImageUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new ProviderImageReferenceReadError('图片地址无效。'); }
  const hostname = normalizedHostname(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol) || !hostname || url.username || url.password
    || BLOCKED_HOSTS.has(hostname) || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new ProviderImageReferenceReadError('图片地址必须是可公开访问的 HTTP 或 HTTPS 地址。');
  }
  return url;
}

async function resolvePublicAddresses(hostname: string) {
  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family }]
    : await lookupDns(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicImageAddress(address))) {
    throw new ProviderImageReferenceReadError('图片地址解析到了非公网地址，已阻止读取。');
  }
  return addresses;
}

function createPinnedLookup(expectedHostname: string, addresses: LookupAddress[]): PinnedLookup {
  return (
    hostname: string,
    options: LookupOptions,
    callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ) => {
    if (normalizedHostname(hostname) !== expectedHostname) {
      const error = Object.assign(new Error('Unexpected image reference host.'), { code: 'EHOSTUNREACH' });
      callback(error, options.all ? [] : '', 0);
      return;
    }
    const candidates = options.family ? addresses.filter((item) => item.family === options.family) : addresses;
    if (!candidates.length) {
      const error = Object.assign(new Error('No verified public image address.'), { code: 'EHOSTUNREACH' });
      callback(error, options.all ? [] : '', 0);
      return;
    }
    if (options.all) callback(null, candidates);
    else callback(null, candidates[0].address, candidates[0].family);
  };
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderImageReferenceReadError(`图片不能超过 ${Math.floor(maxBytes / (1024 * 1024))} MiB。`);
  }
  if (!response.body) throw new ProviderImageReferenceReadError('图片地址没有返回文件内容。');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ProviderImageReferenceReadError(`图片不能超过 ${Math.floor(maxBytes / (1024 * 1024))} MiB。`);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createProviderImageReferenceReader(dependencies: ImageReferenceReaderDependencies) {
  const maxBytes = dependencies.maxBytes ?? PROVIDER_IMAGE_REFERENCE_MAX_BYTES;
  return {
    async read(value: string, signal?: AbortSignal) {
      const url = parsePublicImageUrl(value);
      const hostname = normalizedHostname(url.hostname);
      let addresses: LookupAddress[];
      try { addresses = await dependencies.resolveAddresses(hostname); }
      catch (error) {
        if (error instanceof ProviderImageReferenceReadError) throw error;
        throw new ProviderImageReferenceReadError('图片地址无法解析，请检查地址后重试。');
      }
      if (!addresses.length || addresses.some(({ address }) => !isPublicImageAddress(address))) {
        throw new ProviderImageReferenceReadError('图片地址解析到了非公网地址，已阻止读取。');
      }

      const lookup = createPinnedLookup(hostname, addresses);
      const dispatcher = dependencies.createDispatcher
        ? dependencies.createDispatcher(lookup)
        : new Agent({ connect: { lookup } });
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000);
      try {
        const response = await dependencies.requestAsset(url, {
          method: 'GET',
          headers: { Accept: 'image/png, image/jpeg, image/webp, image/gif, image/bmp, */*;q=0.1', 'Accept-Encoding': 'identity' },
          cache: 'no-store',
          redirect: 'error',
          signal: requestSignal,
          dispatcher,
        });
        if (!response.ok || response.redirected) {
          await response.body?.cancel().catch(() => undefined);
          throw new ProviderImageReferenceReadError(response.redirected
            ? '图片地址发生跳转，已阻止读取。'
            : `读取图片地址返回 HTTP ${response.status}。`);
        }
        return await readLimitedResponse(response, maxBytes);
      } catch (error) {
        if (error instanceof ProviderImageReferenceReadError) throw error;
        if (signal?.aborted) throw signal.reason || error;
        throw new ProviderImageReferenceReadError('读取图片地址失败或超时，请重新上传图片或检查地址。');
      } finally {
        await dispatcher.destroy().catch(() => undefined);
      }
    },
  };
}

export const providerImageReferenceReader = createProviderImageReferenceReader({
  resolveAddresses: resolvePublicAddresses,
  requestAsset: async (url, init) => await undiciFetch(url, init) as unknown as Response,
});
