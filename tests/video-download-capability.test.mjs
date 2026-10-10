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
  assert.deepEqual(JSON.parse(result.message.content), {
    ok: true,
    url: '/api/storage/video?name=clip.mp4',
    name: 'clip.mp4',
    bytes: 42,
    sourceUrl: 'https://video.example/watch/123',
  });
  assert.equal(result.files?.[0]?.url, '/api/storage/video?name=clip.mp4');
});
