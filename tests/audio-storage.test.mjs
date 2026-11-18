import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const storage = createTsRequire(process.cwd())('./lib/audio-storage');

test('audio persistence preserves Opus and PCM extensions and can read the saved bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-audio-'));
  try {
    const opus = await storage.persistAudioBuffer(Buffer.from([1, 2, 3]), 'audio/opus', root);
    const pcm = await storage.persistAudioBuffer(Buffer.from([4, 5, 6]), 'audio/pcm', root);
    assert.match(opus.name, /\.opus$/);
    assert.match(pcm.name, /\.pcm$/);
    assert.equal(storage.audioContentType(opus.name), 'audio/opus');
    assert.equal(storage.audioContentType(pcm.name), 'audio/pcm');
    assert.match(pcm.url, /^\/api\/storage\/audio\?name=/);
    assert.deepEqual(await readFile(path.join(root, pcm.name)), Buffer.from([4, 5, 6]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
