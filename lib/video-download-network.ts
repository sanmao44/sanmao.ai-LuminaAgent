import { execFile } from 'node:child_process';

const SYSTEM_PROXY_TIMEOUT_MS = 1500;
const SYSTEM_PROXY_MAX_BUFFER = 32 * 1024;
const WINDOWS_PROXY_SCRIPT = "$settings = Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; [PSCustomObject]@{ ProxyEnable = [int]$settings.ProxyEnable; ProxyServer = [string]$settings.ProxyServer } | ConvertTo-Json -Compress";

export type VideoDownloadProxyCommandOptions = Readonly<{
  timeoutMs: number;
  windowsHide: true;
  shell: false;
}>;

export type VideoDownloadProxyDependencies = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
  platform?: NodeJS.Platform;
  runSystemCommand?: (
    command: string,
    args: readonly string[],
    options: VideoDownloadProxyCommandOptions,
  ) => Promise<string>;
}>;

function runSystemCommand(
  command: string,
  args: readonly string[],
  options: VideoDownloadProxyCommandOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], {
      encoding: 'utf8',
      maxBuffer: SYSTEM_PROXY_MAX_BUFFER,
      shell: options.shell,
      timeout: options.timeoutMs,
      windowsHide: options.windowsHide,
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function environmentValue(env: Readonly<Record<string, string | undefined>>, ...keys: string[]) {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function normalizeProxyUrl(value: string | undefined, defaultProtocol = 'http'): string | undefined {
  const raw = value?.trim();
  if (!raw || /\s/.test(raw)) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(raw.includes('://') ? raw : `${defaultProtocol}://${raw}`);
  } catch {
    return undefined;
  }

  if (!parsed.hostname || !['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(parsed.protocol)) {
    return undefined;
  }
  return parsed.toString();
}

function targetPort(url: URL) {
  return url.port || (url.protocol === 'https:' ? '443' : '80');
}

function parseNoProxyRule(value: string) {
  const rule = value.trim().toLowerCase();
  if (!rule) return undefined;
  if (rule === '*') return { all: true as const };

  const normalizeHost = (host: string) => host.replace(/^\*\./, '').replace(/^\./, '');
  const bracketed = rule.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketed) return { host: bracketed[1], port: bracketed[2] };

  const hostAndPort = rule.match(/^([^:]+):(\d+)$/);
  if (hostAndPort) return { host: normalizeHost(hostAndPort[1]), port: hostAndPort[2] };

  const host = normalizeHost(rule);
  return host ? { host } : undefined;
}

function matchesNoProxy(url: URL, env: Readonly<Record<string, string | undefined>>) {
  const configured = [env.NO_PROXY, env.no_proxy].filter((value): value is string => Boolean(value));
  const targetHost = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  for (const entry of configured.flatMap((value) => value.split(','))) {
    const rule = parseNoProxyRule(entry);
    if (!rule) continue;
    if ('all' in rule) return true;
    if (rule.port && rule.port !== targetPort(url)) continue;

    const ruleHost = rule.host.toLowerCase().replace(/^\[|\]$/g, '');
    if (targetHost === ruleHost || targetHost.endsWith(`.${ruleHost}`)) return true;
  }
  return false;
}

function resolveEnvironmentProxy(url: URL, env: Readonly<Record<string, string | undefined>>) {
  const scheme = url.protocol === 'https:' ? 'https' : 'http';
  const protocolProxy = normalizeProxyUrl(environmentValue(env, `${scheme}_proxy`, `${scheme.toUpperCase()}_PROXY`));
  if (protocolProxy) return protocolProxy;
  return normalizeProxyUrl(environmentValue(env, 'all_proxy', 'ALL_PROXY'));
}

function selectWindowsProxy(server: string, scheme: 'http' | 'https') {
  const mappings = new Map<string, string>();
  let defaultProxy: string | undefined;

  for (const segment of server.split(';')) {
    const value = segment.trim();
    if (!value) continue;
    const separator = value.indexOf('=');
    if (separator < 0) {
      defaultProxy = value;
      continue;
    }
    const key = value.slice(0, separator).trim().toLowerCase();
    const proxy = value.slice(separator + 1).trim();
    if (proxy && ['http', 'https', 'socks'].includes(key)) mappings.set(key, proxy);
  }

  const protocolProxy = mappings.get(scheme);
  if (protocolProxy) return normalizeProxyUrl(protocolProxy);
  if (defaultProxy) return normalizeProxyUrl(defaultProxy);
  const socksProxy = mappings.get('socks');
  return socksProxy ? normalizeProxyUrl(socksProxy, 'socks5') : undefined;
}

function parseWindowsProxySettings(output: string) {
  try {
    const parsed: unknown = JSON.parse(output.trim());
    if (!parsed || typeof parsed !== 'object') return undefined;
    const settings = parsed as { ProxyEnable?: unknown; ProxyServer?: unknown };
    const enabled = settings.ProxyEnable === true || Number(settings.ProxyEnable) === 1;
    const server = typeof settings.ProxyServer === 'string' ? settings.ProxyServer.trim() : '';
    return enabled && server ? server : undefined;
  } catch {
    return undefined;
  }
}

async function readWindowsProxy(run: NonNullable<VideoDownloadProxyDependencies['runSystemCommand']>) {
  try {
    const output = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROXY_SCRIPT], {
      timeoutMs: SYSTEM_PROXY_TIMEOUT_MS,
      windowsHide: true,
      shell: false,
    });
    return parseWindowsProxySettings(output);
  } catch {
    return undefined;
  }
}

function parseScutilProxy(output: string, scheme: 'http' | 'https') {
  const settings = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/);
    if (match) settings.set(match[1].toLowerCase(), match[2]);
  }

  const prefix = scheme === 'https' ? 'https' : 'http';
  const enabled = settings.get(`${prefix}enable`) === '1';
  const host = settings.get(`${prefix}proxy`);
  if (enabled && host) {
    const port = settings.get(`${prefix}port`);
    return normalizeProxyUrl(port ? `${host}:${port}` : host);
  }

  if (settings.get('socksenable') === '1') {
    const socksHost = settings.get('socksproxy');
    if (socksHost) {
      const socksPort = settings.get('socksport');
      return normalizeProxyUrl(socksPort ? `${socksHost}:${socksPort}` : socksHost, 'socks5');
    }
  }
  return undefined;
}

async function readMacProxy(
  run: NonNullable<VideoDownloadProxyDependencies['runSystemCommand']>,
  scheme: 'http' | 'https',
) {
  try {
    const output = await run('scutil', ['--proxy'], {
      timeoutMs: SYSTEM_PROXY_TIMEOUT_MS,
      windowsHide: true,
      shell: false,
    });
    return parseScutilProxy(output, scheme);
  } catch {
    return undefined;
  }
}

/**
 * Resolve the proxy yt-dlp should use for a target URL without changing the
 * application process environment. A matching NO_PROXY rule means direct
 * access and intentionally returns undefined.
 */
export async function resolveVideoDownloadProxy(
  value: string,
  dependencies: VideoDownloadProxyDependencies = {},
): Promise<string | undefined> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;

  const env = dependencies.env || process.env;
  const explicitProxy = environmentValue(env, 'SANMAO_YTDLP_PROXY');
  const normalizedExplicitProxy = normalizeProxyUrl(explicitProxy);
  if (normalizedExplicitProxy) return normalizedExplicitProxy;

  const envProxy = resolveEnvironmentProxy(url, env);
  if (envProxy) return matchesNoProxy(url, env) ? undefined : envProxy;
  if (matchesNoProxy(url, env)) return undefined;

  const scheme = url.protocol === 'https:' ? 'https' : 'http';
  const run = dependencies.runSystemCommand || runSystemCommand;
  if (dependencies.platform === 'win32' || (!dependencies.platform && process.platform === 'win32')) {
    const server = await readWindowsProxy(run);
    return server ? selectWindowsProxy(server, scheme) : undefined;
  }
  if (dependencies.platform === 'darwin' || (!dependencies.platform && process.platform === 'darwin')) {
    return readMacProxy(run, scheme);
  }
  return undefined;
}
