import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { executeVideoDownloadCapability } = createTsRequire(process.cwd())('./packages/tool-runtime/native-capabilities');

test('video download returns a storage URL for a Windows output path', async () => {
  const calls = [];
  const result = await executeVideoDownloadCapability({
    callId: 'download-1',
    args: { url: 'https://video.example/watch/123' },
    signal: new AbortController().signal,
    videoStoragePath: 'C:\\media',
    videoDownload: async (request) => {
      calls.push(request);
      return { filePath: 'C:\\media\\clip.mp4', bytes: 42 };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].outputDirectory, 'C:\\media');
  assert.equal(calls[0].cookiesFromBrowser, undefined);
  assert.deepEqual(JSON.parse(result.message.content), {
    ok: true,
    url: '/api/storage/video?name=clip.mp4',
    name: 'clip.mp4',
    bytes: 42,
    sourceUrl: 'https://video.example/watch/123',
  });
  assert.equal(result.files?.[0]?.url, '/api/storage/video?name=clip.mp4');
});

test('video download forwards a browser session only when explicitly selected', async () => {
  let request;
  const result = await executeVideoDownloadCapability({
    callId: 'download-with-browser-session',
    args: { url: 'https://video.example/watch/123', cookiesFromBrowser: 'chrome' },
    signal: new AbortController().signal,
    videoStoragePath: 'C:\\media',
    videoDownload: async (input) => {
      request = input;
      return { filePath: 'C:\\media\\clip.mp4', bytes: 42 };
    },
  });

  assert.equal(request.cookiesFromBrowser, 'chrome');
  assert.equal(JSON.parse(result.message.content).ok, true);
});

test('video download rejects an unsupported browser session without starting the downloader', async () => {
  let started = false;
  const result = await executeVideoDownloadCapability({
    callId: 'download-invalid-browser-session',
    args: { url: 'https://video.example/watch/123', cookiesFromBrowser: 'unknown' },
    signal: new AbortController().signal,
    videoStoragePath: 'C:\\media',
    videoDownload: async () => {
      started = true;
      return { filePath: 'C:\\media\\clip.mp4', bytes: 42 };
    },
  });

  assert.equal(started, false);
  assert.equal(JSON.parse(result.message.content).ok, false);
});
