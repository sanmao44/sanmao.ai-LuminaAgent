import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/local-segmentation-sam.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const masks = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('selects the highest-scoring mask from the SAM tensor batch', () => {
  const data = new Float32Array([
    0, 0, 0, 0,
    1, 0, 1, 0,
    1, 1, 0, 0,
  ]);
  const selected = masks.selectLocalSegmentationMaskCandidate({
    dims: [1, 3, 2, 2],
    data,
  }, [0.1, 0.92, 0.4]);

  assert.deepEqual(selected, { width: 2, height: 2, data, offset: 4 });
  assert.deepEqual(Array.from(selected.data.slice(selected.offset, selected.offset + 4)), [1, 0, 1, 0]);
});

test('uses the first candidate when SAM scores are absent or unusable', () => {
  const tensor = { dims: [1, 2, 1, 2], data: new Uint8Array([1, 0, 0, 1]) };

  assert.equal(masks.selectLocalSegmentationMaskCandidate(tensor, []).offset, 0);
  assert.equal(masks.selectLocalSegmentationMaskCandidate(tensor, [Number.NaN, Number.POSITIVE_INFINITY]).offset, 0);
});

test('rejects incomplete or incompatible post-processed tensor data', () => {
  assert.equal(masks.selectLocalSegmentationMaskCandidate(undefined, []), null);
  assert.equal(masks.selectLocalSegmentationMaskCandidate({ dims: [1, 2, 2], data: new Uint8Array(4) }, []), null);
  assert.equal(masks.selectLocalSegmentationMaskCandidate({ dims: [1, 2, 2, 2], data: new Uint8Array(7) }, []), null);
});
