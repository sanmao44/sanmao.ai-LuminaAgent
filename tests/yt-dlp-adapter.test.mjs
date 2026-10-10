import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
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
  assert.equal(args.at(-2), '--');
  assert.equal(args.at(-1), 'https://video.example/watch?id=123');
  assert.equal(args.includes('--exec'), false);
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

