import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, truncate, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { createTsRequire } from './ts-require.mjs';

const sourceUrl = new URL('../lib/yt-dlp-adapter.ts', import.meta.url);
const source = await (await import('node:fs/promises')).readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const requireTs = createTsRequire(new URL('../lib', import.meta.url).pathname);
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(requireTs, module, module.exports);
const adapter = module.exports;

test('builds a fixed, shell-free yt-dlp argument list', () => {
  const args = adapter.buildYtDlpArguments({
    url: 'https://video.example/watch?id=123',
    outputDirectory: path.join(os.tmpdir(), 'sanmao-ytdlp-output'),
    ffmpegPath: path.join(os.tmpdir(), 'ffmpeg'),
  });
  for (const option of ['--no-playlist', '--no-cache-dir', '--restrict-filenames', '--no-overwrites', '--newline', '--playlist-items', '--max-filesize']) {
    assert.ok(args.includes(option), `missing ${option}`);
  }
  assert.ok(args.includes('--ffmpeg-location'));
  assert.equal(args[args.indexOf('--js-runtimes') + 1], `node:${process.execPath}`);
  assert.match(args[args.indexOf('--format') + 1], /bestvideo\[filesize<900M\]\+bestaudio\[filesize<100M\]/);
  assert.equal(args.at(-2), '--');
  assert.equal(args.at(-1), 'https://video.example/watch?id=123');
  assert.equal(args.includes('--exec'), false);
});

test('best preference selects a size-aware audio/video combination', () => {
  const request = {
    url: 'https://video.example/watch?id=123',
    outputDirectory: path.join(os.tmpdir(), 'sanmao-ytdlp-output'),
  };
  const defaultArgs = adapter.buildYtDlpArguments(request);
  const bestArgs = adapter.buildYtDlpArguments({
    ...request,
    format: 'best',
  });
  const format = bestArgs[bestArgs.indexOf('--format') + 1];
  assert.equal(format, defaultArgs[defaultArgs.indexOf('--format') + 1]);
  assert.match(format, /bestvideo\[filesize<900M\]\+bestaudio\[filesize<100M\]/);
  assert.match(format, /bestvideo\+bestaudio/);
  assert.notEqual(format, 'best');
});

test('explicit combined audio/video format remains available', () => {
  const args = adapter.buildYtDlpArguments({
    url: 'https://video.example/watch?id=123',
    outputDirectory: path.join(os.tmpdir(), 'sanmao-ytdlp-output'),
    format: 'bestvideo+bestaudio/best',
  });
  assert.equal(args[args.indexOf('--format') + 1], 'bestvideo+bestaudio/best');
});

test('browser cookies are omitted by default and included only for a selected supported browser', () => {
  const base = {
    url: 'https://video.example/watch?id=123',
    outputDirectory: path.join(os.tmpdir(), 'sanmao-ytdlp-output'),
  };
  const defaultArgs = adapter.buildYtDlpArguments(base);
  assert.equal(defaultArgs.includes('--cookies-from-browser'), false);

  const authorizedArgs = adapter.buildYtDlpArguments({ ...base, cookiesFromBrowser: 'chrome' });
  const cookieIndex = authorizedArgs.indexOf('--cookies-from-browser');
  assert.deepEqual(authorizedArgs.slice(cookieIndex, cookieIndex + 2), ['--cookies-from-browser', 'chrome']);

  assert.throws(() => adapter.buildYtDlpArguments({ ...base, cookiesFromBrowser: 'unknown' }), /browser session/i);
});

test('rejects non-http URLs before invoking a process', () => {
  assert.throws(() => adapter.buildYtDlpArguments({ url: 'file:///tmp/video.mp4', outputDirectory: path.join(os.tmpdir(), 'out') }), /HTTP 或 HTTPS/);
});

test('rejects local and private HTTP URLs before invoking a process', () => {
  for (const url of ['http://127.0.0.1/video.mp4', 'http://192.168.1.20/video.mp4', 'http://metadata.google.internal/video.mp4']) {
    assert.throws(
      () => adapter.buildYtDlpArguments({ url, outputDirectory: path.join(os.tmpdir(), 'out') }),
      /本机或内网地址/,
      url,
    );
  }
});

test('probe reports a mocked installed version', async () => {
  const result = await adapter.probeYtDlp({
    command: 'yt-dlp-test',
    run: async () => ({ exitCode: 0, signal: null, stdout: '2026.01.01\n', stderr: '' }),
  });
  assert.deepEqual(result, { available: true, command: 'yt-dlp-test', version: '2026.01.01' });
});

test('probe honors the configured executable path without requiring PATH', async () => {
  const previous = process.env.SANMAO_YTDLP_PATH;
  process.env.SANMAO_YTDLP_PATH = process.execPath;
  try {
    const result = await adapter.probeYtDlp();
    assert.equal(result.available, true);
    assert.equal(result.command, process.execPath);
    assert.match(result.version || '', /^v?\d+\.\d+/);
  } finally {
    if (previous === undefined) delete process.env.SANMAO_YTDLP_PATH;
    else process.env.SANMAO_YTDLP_PATH = previous;
  }
});

test('probe discovers the bundled executable from the durable data directory', async () => {
  const previousDataDir = process.env.SANMAO_DATA_DIR;
  const previousYtDlpPath = process.env.SANMAO_YTDLP_PATH;
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-ytdlp-data-'));
  const binary = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const bundled = path.join(dataDir, 'tools', binary);
  await mkdir(path.dirname(bundled), { recursive: true });
  await writeFile(bundled, 'placeholder');
  delete process.env.SANMAO_YTDLP_PATH;
  process.env.SANMAO_DATA_DIR = dataDir;
  try {
    const result = await adapter.probeYtDlp({
      run: async ({ command, args }) => {
        assert.equal(command, bundled);
        assert.deepEqual(args, ['--version']);
        return { exitCode: 0, signal: null, stdout: '2026.02.01\n', stderr: '' };
      },
    });
    assert.deepEqual(result, { available: true, command: bundled, version: '2026.02.01' });
  } finally {
    if (previousDataDir === undefined) delete process.env.SANMAO_DATA_DIR;
    else process.env.SANMAO_DATA_DIR = previousDataDir;
    if (previousYtDlpPath === undefined) delete process.env.SANMAO_YTDLP_PATH;
    else process.env.SANMAO_YTDLP_PATH = previousYtDlpPath;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('probe ignores a stale absolute path from another computer', async () => {
  const previousDataDir = process.env.SANMAO_DATA_DIR;
  const previousYtDlpPath = process.env.SANMAO_YTDLP_PATH;
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-ytdlp-data-'));
  const binary = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const bundled = path.join(dataDir, 'tools', binary);
  await mkdir(path.dirname(bundled), { recursive: true });
  await writeFile(bundled, 'placeholder');
  process.env.SANMAO_YTDLP_PATH = path.join(dataDir, 'old-computer', binary);
  process.env.SANMAO_DATA_DIR = dataDir;
  try {
    const result = await adapter.probeYtDlp({
      run: async ({ command }) => {
        assert.equal(command, bundled);
        return { exitCode: 0, signal: null, stdout: '2026.02.01\n', stderr: '' };
      },
    });
    assert.equal(result.command, bundled);
  } finally {
    if (previousDataDir === undefined) delete process.env.SANMAO_DATA_DIR;
    else process.env.SANMAO_DATA_DIR = previousDataDir;
    if (previousYtDlpPath === undefined) delete process.env.SANMAO_YTDLP_PATH;
    else process.env.SANMAO_YTDLP_PATH = previousYtDlpPath;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('download accepts only a file printed inside the requested output directory', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-ytdlp-'));
  try {
    const file = path.join(directory, 'video.mp4');
    await writeFile(file, Buffer.from('video-bytes'));
    const result = await adapter.downloadWithYtDlp({ url: 'https://video.example/watch/123', outputDirectory: directory }, {
      command: 'yt-dlp-test',
      run: async ({ args }) => {
        assert.equal(args.at(-1), 'https://video.example/watch/123');
        return { exitCode: 0, signal: null, stdout: `${file}\n`, stderr: '' };
      },
    });
    assert.equal(result.filePath, file);
    assert.equal(result.bytes, 11);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('download converts a missing executable into an actionable unavailable error', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-ytdlp-'));
  try {
    await assert.rejects(
      () => adapter.downloadWithYtDlp({ url: 'https://video.example/watch/123', outputDirectory: directory }, {
        command: 'yt-dlp-missing',
        run: async () => { const error = new Error('spawn yt-dlp-missing ENOENT'); error.code = 'ENOENT'; throw error; },
      }),
      (error) => error instanceof adapter.YtDlpUnavailableError,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('download rejects and removes a merged artifact over the 1 GiB limit', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-ytdlp-'));
  try {
    const file = path.join(directory, 'large.mp4');
    await assert.rejects(
      () => adapter.downloadWithYtDlp({ url: 'https://video.example/watch/large', outputDirectory: directory }, {
        command: 'yt-dlp-test',
        run: async () => {
          await writeFile(file, Buffer.from('sparse'));
          await truncate(file, adapter.YTDLP_MAX_FILE_BYTES + 1);
          assert.equal((await stat(file)).size, adapter.YTDLP_MAX_FILE_BYTES + 1);
          return { exitCode: 0, signal: null, stdout: `${file}\n`, stderr: '' };
        },
      }),
      (error) => error instanceof adapter.YtDlpDownloadError && /1 GiB/.test(error.message),
    );
    await assert.rejects(() => stat(file), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('download never removes a pre-existing oversized file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sanmao-ytdlp-'));
  try {
    const file = path.join(directory, 'large.mp4');
    await writeFile(file, Buffer.from('sparse'));
    await truncate(file, adapter.YTDLP_MAX_FILE_BYTES + 1);
    await assert.rejects(
      () => adapter.downloadWithYtDlp({ url: 'https://video.example/watch/large', outputDirectory: directory }, {
        command: 'yt-dlp-test',
        run: async () => ({ exitCode: 0, signal: null, stdout: `${file}\n`, stderr: '' }),
      }),
      (error) => error instanceof adapter.YtDlpDownloadError && /1 GiB/.test(error.message),
    );
    assert.equal((await stat(file)).size, adapter.YTDLP_MAX_FILE_BYTES + 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

