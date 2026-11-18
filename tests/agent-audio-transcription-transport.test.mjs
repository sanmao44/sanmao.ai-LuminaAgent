import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { readAgentHttpInput } = createTsRequire(process.cwd())('./apps/api/agent-http-contract');

test('agent HTTP input preserves the selected audio transcription model', async () => {
  const request = new Request('http://localhost/api/agent', {
    method: 'POST',
    body: JSON.stringify({ messages: [], audioTranscription: { modelId: 'registered-asr-model' } }),
  });

  const input = await readAgentHttpInput(request);
  assert.deepEqual(input.body.audioTranscription, { modelId: 'registered-asr-model' });
  assert.equal(input.signal, request.signal);
});
