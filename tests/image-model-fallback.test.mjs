import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { invokeMediaModelCandidates, isSafeMediaModelFallbackError } = createTsRequire(process.cwd())('./packages/model-runtime/media');

const runtime = (id) => ({ model: { id } });
const providerRejection = (status, message = `HTTP ${status}`) => Object.assign(new Error(message), { providerFailureKind: 'http', providerStatus: status });

test('switches automatic image models only after an explicit compatibility rejection', async () => {
  const calls = [];
  let loaded = 0;
  const first = runtime('default-image');
  const second = runtime('fallback-image');
  const result = await invokeMediaModelCandidates(first, async () => {
    loaded += 1;
    return [first, second];
  }, async (candidate) => {
    calls.push(candidate.model.id);
    if (candidate.model.id === 'default-image') throw providerRejection(422, 'The selected model is not supported for image generation');
    return candidate.model.id;
  });
  assert.equal(result, 'fallback-image');
  assert.deepEqual(calls, ['default-image', 'fallback-image']);
  assert.equal(loaded, 1);
});

test('does not switch after transport or ambiguous server failures', async () => {
  for (const failure of [
    Object.assign(new Error('fetch failed'), { providerFailureKind: 'transport' }),
    Object.assign(new Error('HTTP 500'), { providerFailureKind: 'http', providerStatus: 500 }),
  ]) {
    let loaded = 0;
    await assert.rejects(
      invokeMediaModelCandidates(runtime('default-image'), async () => { loaded += 1; return [runtime('fallback-image')]; }, async () => { throw failure; }),
      failure,
    );
    assert.equal(loaded, 0);
  }
});

test('recognizes only safe compatibility statuses for fallback', () => {
  assert.equal(isSafeMediaModelFallbackError(providerRejection(400)), false);
  assert.equal(isSafeMediaModelFallbackError(providerRejection(415)), false);
  assert.equal(isSafeMediaModelFallbackError(providerRejection(422)), false);
  assert.equal(isSafeMediaModelFallbackError(providerRejection(500)), false);
  assert.equal(isSafeMediaModelFallbackError(providerRejection(422, 'The selected model is not supported for image generation')), true);
  assert.equal(isSafeMediaModelFallbackError(providerRejection(404, 'Model "gpt-image-2.5-exact" is not supported by any configured account')), true);
  assert.equal(isSafeMediaModelFallbackError(providerRejection(404, 'HTTP 404')), false);
});
