import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { createTsRequire } from './ts-require.mjs';

const { MEDIA_MODEL_INPUT_NOT_SUBMITTED } = createTsRequire(process.cwd())('./packages/contracts/model');
const relayRequiredCode = 'AGNES_MEDIA_RELAY_REQUIRED';
const relayUnavailableCode = 'AGNES_MEDIA_RELAY_UNAVAILABLE';

class PublicMediaError extends Error {
  constructor(code) {
    super('public media relay unavailable');
    this.code = code;
  }
}

test('local image relay failures are classified as not submitted to the model provider', async () => {
  const { editImage } = createTsRequire(process.cwd(), {
    './signed-media': {
      PublicMediaError,
      MEDIA_RELAY_REQUIRED: relayRequiredCode,
      MEDIA_RELAY_UNAVAILABLE: relayUnavailableCode,
      preparePublicMediaUrl: async () => { throw new PublicMediaError(relayRequiredCode); },
    },
  })('./lib/providers');
  const imageBytes = await sharp({
    create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  }).png().toBuffer();
  const image = `data:image/png;base64,${imageBytes.toString('base64')}`;
  let providerRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    providerRequests += 1;
    throw new Error('the provider must not be called before media preparation succeeds');
  };

  try {
    await assert.rejects(
      editImage({
        id: 'relay-only',
        name: 'Relay only',
        type: 'openai',
        platform: 'apimart',
        baseUrl: 'https://api.apimart.ai/v1',
        apiKey: 'test-key',
      }, 'edit-model', { prompt: 'edit the selected area', references: [image], mask: image }),
      (error) => {
        assert.equal(error.providerFailureKind, 'input');
        assert.equal(error.providerFailureCode, MEDIA_MODEL_INPUT_NOT_SUBMITTED);
        assert.equal(error.providerResponse, false);
        assert.equal(error.providerStatus, 422);
        return true;
      },
    );
    assert.equal(providerRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
