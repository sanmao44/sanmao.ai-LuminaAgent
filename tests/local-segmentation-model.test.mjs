import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/local-segmentation-model.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const modelFiles = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const revision = '5850ab45f587c112167512ffef949107115e26a0';
const modelPath = (file) => ['Xenova', 'slimsam-77-uniform', 'resolve', revision, ...file.split('/')];

test('local model resource lookup accepts only the pinned SAM files', () => {
  const files = [
    'config.json',
    'preprocessor_config.json',
    'onnx/vision_encoder_quantized.onnx',
    'onnx/prompt_encoder_mask_decoder_quantized.onnx',
  ];

  for (const file of files) {
    const resource = modelFiles.resolveLocalSegmentationModelResource(modelPath(file));
    assert.ok(resource, `${file} is allowed`);
    assert.equal(new URL(resource.url).hostname, 'huggingface.co');
    assert.ok(resource.maxBytes > 0);
  }

  assert.equal(modelFiles.resolveLocalSegmentationModelResource(modelPath('model.onnx')), null);
  assert.equal(modelFiles.resolveLocalSegmentationModelResource(['Xenova', 'other-model', 'resolve', revision, 'config.json']), null);
  assert.equal(modelFiles.resolveLocalSegmentationModelResource(['Xenova', 'slimsam-77-uniform', 'resolve', 'main', 'config.json']), null);
  assert.equal(modelFiles.resolveLocalSegmentationModelResource(modelPath('../config.json')), null);
});

test('the model adapter fetches an allowed file and returns immutable cache headers', async () => {
  const expectedUrl = 'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/5850ab45f587c112167512ffef949107115e26a0/config.json';
  const bytes = new Uint8Array([123, 125]);
  let request;
  const response = await modelFiles.fetchLocalSegmentationModelFile(modelPath('config.json'), {
    fetcher: async (url, init) => {
      request = { url: String(url), init };
      return new Response(bytes, { headers: { etag: '"sam-config"' } });
    },
  });

  assert.equal(request.url, expectedUrl);
  assert.equal(request.init.method, 'GET');
  assert.equal(request.init.redirect, 'follow');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal(response.headers.get('content-length'), '2');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(response.headers.get('etag'), '"sam-config"');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test('unknown files and failed or oversized upstream responses fail closed', async () => {
  let fetchCount = 0;
  const missing = await modelFiles.fetchLocalSegmentationModelFile(modelPath('unlisted.json'), {
    fetcher: async () => { fetchCount += 1; return new Response('unused'); },
  });
  assert.equal(missing.status, 404);
  assert.equal(fetchCount, 0);

  const upstreamFailure = await modelFiles.fetchLocalSegmentationModelFile(modelPath('config.json'), {
    fetcher: async () => new Response('upstream details', { status: 503 }),
  });
  assert.equal(upstreamFailure.status, 502);
  assert.doesNotMatch(await upstreamFailure.text(), /upstream details/);

  const tooLarge = await modelFiles.fetchLocalSegmentationModelFile(modelPath('config.json'), {
    fetcher: async () => new Response(new Uint8Array(256 * 1024 + 1)),
  });
  assert.equal(tooLarge.status, 502);
});

test('segmentation proxy configuration is optional and validates its protocol', () => {
  assert.equal(modelFiles.resolveLocalSegmentationProxy({}), null);
  assert.equal(
    modelFiles.resolveLocalSegmentationProxy({ SANMAO_LOCAL_SEGMENTATION_PROXY: 'http://127.0.0.1:7897' }),
    'http://127.0.0.1:7897/',
  );
  assert.throws(
    () => modelFiles.resolveLocalSegmentationProxy({ SANMAO_LOCAL_SEGMENTATION_PROXY: 'file:///tmp/proxy' }),
    /HTTP 或 HTTPS/,
  );
});
