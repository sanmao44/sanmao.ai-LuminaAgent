import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createTsRequire } from './ts-require.mjs';

const sourceUrl = new URL('../lib/video-download-network.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const requireTs = createTsRequire(new URL('../lib', import.meta.url).pathname);
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(requireTs, module, module.exports);
const { resolveVideoDownloadProxy } = module.exports;

test('explicit application proxy takes precedence over environment and system settings', async () => {
  let systemCommandCalled = false;
  const result = await resolveVideoDownloadProxy('https://video.example/watch', {
    env: {
      SANMAO_YTDLP_PROXY: 'http://explicit.proxy:9000',
      HTTPS_PROXY: 'http://environment.proxy:9000',
    },
    platform: 'win32',
    runSystemCommand: async () => {
      systemCommandCalled = true;
      return '';
    },
  });

  assert.equal(result, 'http://explicit.proxy:9000/');
  assert.equal(systemCommandCalled, false);
});

test('environment proxy selection follows the target scheme and falls back to ALL_PROXY', async () => {
  assert.equal(
    await resolveVideoDownloadProxy('https://video.example/watch', {
      env: { HTTPS_PROXY: 'https://secure.proxy:9443', HTTP_PROXY: 'http://plain.proxy:8080' },
      platform: 'linux',
    }),
    'https://secure.proxy:9443/',
  );
  assert.equal(
    await resolveVideoDownloadProxy('http://video.example/watch', {
      env: { HTTPS_PROXY: 'https://secure.proxy:9443', all_proxy: 'socks5h://fallback.proxy:1080' },
      platform: 'linux',
    }),
    'socks5h://fallback.proxy:1080',
  );
  assert.equal(
    await resolveVideoDownloadProxy('https://video.example/watch', {
      env: { HTTP_PROXY: 'http://plain.proxy:8080' },
      platform: 'linux',
    }),
    undefined,
  );
  assert.equal(
    await resolveVideoDownloadProxy('https://video.example/watch', {
      env: {
        SANMAO_YTDLP_PROXY: 'invalid proxy',
        HTTPS_PROXY: 'file://proxy.example',
        ALL_PROXY: 'http://fallback.proxy:8888',
      },
      platform: 'linux',
    }),
    'http://fallback.proxy:8888/',
  );
});

test('NO_PROXY bypasses environment and system proxies for matching hosts and ports', async () => {
  let systemCommandCalled = false;
  const dependencies = {
    env: {
      HTTPS_PROXY: 'http://environment.proxy:9000',
      NO_PROXY: '.example.com:443,other.example:8443',
    },
    platform: 'darwin',
    runSystemCommand: async () => {
      systemCommandCalled = true;
      return 'HTTPSEnable : 1\nHTTPSProxy : system.proxy\nHTTPSPort : 8888';
    },
  };

  assert.equal(await resolveVideoDownloadProxy('https://media.example.com/watch', dependencies), undefined);
  assert.equal(await resolveVideoDownloadProxy('https://other.example:8443/watch', dependencies), undefined);
  assert.equal(await resolveVideoDownloadProxy('https://other.example:443/watch', dependencies), 'http://environment.proxy:9000/');
  assert.equal(systemCommandCalled, false);
  assert.equal(
    await resolveVideoDownloadProxy('https://anything.example/watch', {
      env: { HTTPS_PROXY: 'http://environment.proxy:9000', no_proxy: '*' },
      platform: 'linux',
    }),
    undefined,
  );
});

test('Windows reads enabled ProxyServer and routes per-protocol entries', async () => {
  const calls = [];
  const runSystemCommand = async (command, args, options) => {
    calls.push({ command, args, options });
    return JSON.stringify({ ProxyEnable: 1, ProxyServer: 'http=plain.proxy:8080;https=secure.proxy:8443;socks=socks.proxy:1080' });
  };
  const dependencies = { env: {}, platform: 'win32', runSystemCommand };

  assert.equal(await resolveVideoDownloadProxy('http://video.example/watch', dependencies), 'http://plain.proxy:8080/');
  assert.equal(await resolveVideoDownloadProxy('https://video.example/watch', dependencies), 'http://secure.proxy:8443/');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, 'powershell.exe');
  assert.deepEqual(calls[0].args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
  assert.deepEqual(calls[0].options, { timeoutMs: 1500, windowsHide: true, shell: false });
});

test('Windows treats an unqualified ProxyServer as HTTP and disabled settings as direct', async () => {
  const enabled = await resolveVideoDownloadProxy('https://video.example/watch', {
    env: {},
    platform: 'win32',
    runSystemCommand: async () => JSON.stringify({ ProxyEnable: 1, ProxyServer: '127.0.0.1:7897' }),
  });
  const disabled = await resolveVideoDownloadProxy('https://video.example/watch', {
    env: {},
    platform: 'win32',
    runSystemCommand: async () => JSON.stringify({ ProxyEnable: 0, ProxyServer: 'proxy.example:8000' }),
  });

  assert.equal(enabled, 'http://127.0.0.1:7897/');
  assert.equal(disabled, undefined);
});

test('Windows SOCKS mappings use yt-dlp-compatible SOCKS URLs', async () => {
  const result = await resolveVideoDownloadProxy('https://video.example/watch', {
    env: {},
    platform: 'win32',
    runSystemCommand: async () => JSON.stringify({ ProxyEnable: 1, ProxyServer: 'socks=socks.proxy:1080' }),
  });

  assert.equal(result, 'socks5://socks.proxy:1080');
});

test('macOS reads scheme-specific proxies from scutil and falls back to SOCKS', async () => {
  const output = [
    'HTTPEnable : 1',
    'HTTPProxy : plain.proxy',
    'HTTPPort : 8080',
    'HTTPSEnable : 1',
    'HTTPSProxy : secure.proxy',
    'HTTPSPort : 8443',
    'SOCKSEnable : 1',
    'SOCKSProxy : socks.proxy',
    'SOCKSPort : 1080',
  ].join('\n');
  const dependencies = {
    env: {},
    platform: 'darwin',
    runSystemCommand: async (command, args, options) => {
      assert.equal(command, 'scutil');
      assert.deepEqual(args, ['--proxy']);
      assert.deepEqual(options, { timeoutMs: 1500, windowsHide: true, shell: false });
      return output;
    },
  };

  assert.equal(await resolveVideoDownloadProxy('http://video.example/watch', dependencies), 'http://plain.proxy:8080/');
  assert.equal(await resolveVideoDownloadProxy('https://video.example/watch', dependencies), 'http://secure.proxy:8443/');
  assert.equal(
    await resolveVideoDownloadProxy('https://video.example/watch', {
      env: {},
      platform: 'darwin',
      runSystemCommand: async () => 'SOCKSEnable : 1\nSOCKSProxy : socks.proxy\nSOCKSPort : 1080',
    }),
    'socks5://socks.proxy:1080',
  );
});

test('Linux without proxy environment returns direct access without running a command', async () => {
  let systemCommandCalled = false;
  const result = await resolveVideoDownloadProxy('https://video.example/watch', {
    env: {},
    platform: 'linux',
    runSystemCommand: async () => {
      systemCommandCalled = true;
      return '';
    },
  });

  assert.equal(result, undefined);
  assert.equal(systemCommandCalled, false);
});

test('invalid URLs and unsupported protocols do not trigger system inspection', async () => {
  let systemCommandCalled = false;
  const dependencies = {
    env: {},
    platform: 'win32',
    runSystemCommand: async () => {
      systemCommandCalled = true;
      return '';
    },
  };

  assert.equal(await resolveVideoDownloadProxy('not a URL', dependencies), undefined);
  assert.equal(await resolveVideoDownloadProxy('file:///tmp/video.mp4', dependencies), undefined);
  assert.equal(systemCommandCalled, false);
});
