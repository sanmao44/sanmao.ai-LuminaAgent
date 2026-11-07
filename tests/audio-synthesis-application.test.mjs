import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLibModules } from './lib-build.mjs';

const { main: application } = await buildLibModules(
  ['apps/api/audio-synthesis-application'],
  'audio-synthesis-application',
);

test('audio synthesis trims the script and optional voice before calling the provider port', async () => {
  const signal = new AbortController().signal;
  let received;
  const result = await application.synthesizeAudioRequest(
    { text: '  你好，世界。  ', voice: ' 温柔女声 ' },
    { synthesize: async (input, receivedSignal) => {
      received = { input, signal: receivedSignal };
      return { data: new Uint8Array([1, 2, 3]), contentType: 'audio/wav', extension: 'wav', engine: 'offline' };
    } },
    signal,
  );
  assert.deepEqual(received.input, { text: '你好，世界。', voice: '温柔女声' });
  assert.equal(received.signal, signal);
  assert.equal(result.contentType, 'audio/wav');
  assert.equal(result.engine, 'offline');
});

test('audio synthesis preserves project and canvas provenance metadata without changing spoken text', async () => {
  let received;
  await application.synthesizeAudioRequest(
    {
      text: '  项目旁白  ',
      source: 'canvas',
      projectId: 'project-1',
      canvasId: 'canvas-1',
      nodeId: 'audio-node',
    },
    { synthesize: async (input) => {
      received = input;
      return { data: new Uint8Array([1]), contentType: 'audio/wav', extension: 'wav', engine: 'offline' };
    } },
  );
  assert.deepEqual(received, {
    text: '项目旁白',
    source: 'canvas',
    projectId: 'project-1',
    canvasId: 'canvas-1',
    nodeId: 'audio-node',
  });
});

test('audio synthesis rejects empty and oversized scripts before contacting the provider', async () => {
  let calls = 0;
  const port = { synthesize: async () => { calls += 1; throw new Error('unexpected'); } };
  await assert.rejects(application.synthesizeAudioRequest({ text: '   ' }, port), /输入配音文本/);
  await assert.rejects(application.synthesizeAudioRequest({ text: 'x'.repeat(5001) }, port), /最多 5000 个字符/);
  await assert.rejects(application.synthesizeAudioRequest({ text: '有效文本', voice: 'v'.repeat(101) }, port), /音色名称最多 100 个字符/);
  assert.equal(calls, 0);
});

test('audio synthesis rejects invalid provider artifacts before returning them to the client', async () => {
  await assert.rejects(
    application.synthesizeAudioRequest({ text: '你好' }, { synthesize: async () => ({ data: new Uint8Array(), contentType: 'audio/wav', extension: 'wav', engine: 'provider' }) }),
    /没有返回有效音频/,
  );
  await assert.rejects(
    application.synthesizeAudioRequest({ text: '你好' }, { synthesize: async () => ({ data: new Uint8Array([1]), contentType: 'application/json', extension: 'json', engine: 'provider' }) }),
    /无法识别的音频格式/,
  );
});

test('audio MIME type validation accepts browser-playable audio containers', async () => {
  const result = await application.synthesizeAudioRequest(
    { text: '你好' },
    { synthesize: async () => ({ data: new Uint8Array([1]), contentType: 'audio/webm', extension: 'webm', engine: 'provider' }) },
  );
  assert.equal(result.extension, 'webm');
});
