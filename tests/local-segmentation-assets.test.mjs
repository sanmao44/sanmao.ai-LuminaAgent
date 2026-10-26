import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const modelRoot = new URL('../public/local-models/Xenova/slimsam-77-uniform/', import.meta.url);
const revision = '5850ab45f587c112167512ffef949107115e26a0';
const files = [
  {
    name: 'config.json',
    size: 379,
    sha256: '6339884f168658d3ca6473b486973913fb33e84e625e06ae2dd7b4a808187419',
  },
  {
    name: 'preprocessor_config.json',
    size: 466,
    sha256: '225545a743c654e3c495ec6f545a0eaba57c8ba3fbbd8483b3cb1c0fc58db517',
  },
  {
    name: 'onnx/vision_encoder_quantized.onnx',
    size: 8_882_165,
    sha256: 'cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971',
  },
  {
    name: 'onnx/prompt_encoder_mask_decoder_quantized.onnx',
    size: 4_903_810,
    sha256: 'cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2',
  },
];

test('the pinned SlimSAM revision ships complete, verified model files', async () => {
  for (const file of files) {
    const bytes = await readFile(new URL(`resolve/${revision}/${file.name}`, modelRoot));
    assert.equal(bytes.byteLength, file.size, `${file.name} size`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `${file.name} SHA-256`);
  }
});

test('bundled processor metadata matches SlimSAM and includes its Apache license', async () => {
  const config = JSON.parse(await readFile(new URL(`resolve/${revision}/config.json`, modelRoot), 'utf8'));
  const processor = JSON.parse(await readFile(new URL(`resolve/${revision}/preprocessor_config.json`, modelRoot), 'utf8'));
  const modelCard = await readFile(new URL('README.md', modelRoot), 'utf8');
  const license = await readFile(new URL('LICENSE-2.0.txt', modelRoot), 'utf8');

  assert.equal(config.model_type, 'sam');
  assert.equal(processor.processor_class, 'SamProcessor');
  assert.match(modelCard, /license: apache-2\.0/);
  assert.match(modelCard, /nielsr\/slimsam-77-uniform/);
  assert.match(license, /Apache License[\s\S]*Version 2\.0/);
});
