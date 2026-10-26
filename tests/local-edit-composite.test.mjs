import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const sharpUrl = pathToFileURL(require.resolve('sharp')).href;
const sourceUrl = new URL('../lib/local-edit-composite.ts', import.meta.url);
const localEditSource = await readFile(new URL('../lib/local-edit.ts', import.meta.url), 'utf8');
const localEditCompiled = ts.transpileModule(localEditSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'local-edit.ts',
}).outputText;
const localEditRuntime = `data:text/javascript;base64,${Buffer.from(localEditCompiled).toString('base64')}`;
const source = (await readFile(sourceUrl, 'utf8'))
  .replace("from 'sharp'", `from '${sharpUrl}'`)
  .replace(
    "import { resolveStoredImageReference } from './image-storage';",
    'const resolveStoredImageReference = async () => { throw new Error("stored image is unavailable"); };',
  )
  .replace(
    /import \{[\s\S]*?\} from '\.\/local-edit';/u,
    `const { expandLocalEditMask, featherLocalEditMask, localEditMoveGuideFeatherRadius, repairLocalEditMoveSource } = await import(${JSON.stringify(localEditRuntime)});`,
  );
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const composite = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function dataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function solid(width, height, color) {
  return sharp({
    create: { width, height, channels: 4, background: color },
  }).png().toBuffer();
}

async function raw(buffer) {
  return sharp(buffer).raw().toBuffer({ resolveWithObject: true });
}

async function mask(width, height, alphaAt = () => 255) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = 255;
    pixels[index + 1] = 255;
    pixels[index + 2] = 255;
    pixels[index + 3] = alphaAt((index / 4) % width, Math.floor(index / 4 / width));
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

test('pixel compositing follows the PNG mask contract exactly', () => {
  const source = Uint8Array.from([255, 0, 0, 255, 255, 0, 0, 255]);
  const generated = Uint8Array.from([0, 0, 255, 255, 0, 0, 255, 255]);
  const protectedMask = Uint8Array.from([255, 255, 255, 255, 255, 255, 255, 0]);
  const output = composite.compositeLocalEditPixels(source, generated, protectedMask);
  assert.deepEqual([...output], [255, 0, 0, 255, 0, 0, 255, 255]);

  const feathered = composite.compositeLocalEditPixels(
    source.subarray(0, 4),
    generated.subarray(0, 4),
    Uint8Array.from([255, 255, 255, 128]),
  );
  assert.deepEqual([...feathered], [128, 0, 127, 255]);
});

test('full protection prevents a Provider-wide color change from leaking outside the selection', async () => {
  const source = await solid(4, 2, { r: 230, g: 40, b: 20, alpha: 1 });
  const providerResult = await solid(4, 2, { r: 20, g: 40, b: 230, alpha: 1 });
  const protectedMask = await mask(4, 2);
  const [output, original] = await Promise.all([
    composite.enforceLocalEditMask(
      [{ url: dataUrl(providerResult), revisedPrompt: 'provider result' }],
      dataUrl(source),
      dataUrl(protectedMask),
    ),
    raw(source),
  ]);
  const result = await raw(Buffer.from(output[0].url.split(',')[1], 'base64'));
  assert.deepEqual([...result.data], [...original.data]);
  assert.equal(output[0].revisedPrompt, 'provider result');
});

test('transparent selection uses the generated image and a rectangular mask preserves the rest', async () => {
  const source = await solid(4, 2, { r: 230, g: 40, b: 20, alpha: 1 });
  const providerResult = await solid(4, 2, { r: 20, g: 40, b: 230, alpha: 1 });
  const selectedMask = await mask(4, 2, (x, y) => x < 2 && y < 1 ? 0 : 255);
  const output = await composite.enforceLocalEditMask(
    [{ url: dataUrl(providerResult) }],
    dataUrl(source),
    dataUrl(selectedMask),
  );
  const result = await raw(Buffer.from(output[0].url.split(',')[1], 'base64'));
  for (let pixel = 0; pixel < 8; pixel += 1) {
    const expected = pixel < 2 ? [20, 40, 230, 255] : [230, 40, 20, 255];
    assert.deepEqual([...result.data.subarray(pixel * 4, pixel * 4 + 4)], expected);
  }
});

test('move compositing keeps the precomposed target object while regenerating its source and edge', async () => {
  const width = 8;
  const height = 1;
  const sourcePixels = Buffer.alloc(width * height * 4);
  const guidePixels = Buffer.alloc(width * height * 4);
  const generatedPixels = Buffer.alloc(width * height * 4);
  const maskPixels = Buffer.alloc(width * height * 4);
  for (let x = 0; x < width; x += 1) {
    const offset = x * 4;
    sourcePixels.set([0, 0, 200, 255], offset);
    guidePixels.set([0, 0, 200, 255], offset);
    generatedPixels.set([220, 220, 0, 255], offset);
    maskPixels.set([255, 255, 255, 255], offset);
  }
  sourcePixels.set([220, 0, 0, 255], 1 * 4);
  guidePixels.set([220, 0, 0, 255], 5 * 4);
  maskPixels[1 * 4 + 3] = 0;
  maskPixels[4 * 4 + 3] = 0;

  const png = async (pixels) => sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const result = await composite.enforceLocalEditMask(
    [{ url: dataUrl(await png(generatedPixels)) }],
    dataUrl(await png(guidePixels)),
    dataUrl(await png(maskPixels)),
  );
  const output = await raw(Buffer.from(result[0].url.split(',')[1], 'base64'));

  assert.deepEqual([...output.data.subarray(1 * 4, 2 * 4)], [220, 220, 0, 255], 'the editable source is filled from generation');
  assert.deepEqual([...output.data.subarray(4 * 4, 5 * 4)], [220, 220, 0, 255], 'the target edge is blended from generation');
  assert.deepEqual([...output.data.subarray(5 * 4, 6 * 4)], [220, 0, 0, 255], 'the moved object is retained from the guide');
  assert.deepEqual([...output.data.subarray(7 * 4, 8 * 4)], [0, 0, 200, 255], 'unmarked content stays unchanged');
});

test('move compositing inpaints a retained Provider duplicate from its surrounding background', async () => {
  const width = 4;
  const height = 1;
  const originalPixels = Buffer.from([
    30, 30, 30, 255,
    220, 0, 0, 255,
    30, 30, 30, 255,
    30, 30, 30, 255,
  ]);
  const guidePixels = Buffer.from([
    30, 30, 30, 255,
    30, 160, 30, 255,
    30, 30, 30, 255,
    220, 0, 0, 255,
  ]);
  const providerPixels = Buffer.from([
    90, 90, 90, 255,
    250, 30, 30, 255,
    90, 90, 90, 255,
    80, 80, 220, 255,
  ]);
  const maskPixels = Buffer.from([
    255, 255, 255, 255,
    255, 255, 255, 0,
    255, 255, 255, 255,
    255, 255, 255, 255,
  ]);
  const sourceMaskPixels = Buffer.from([
    255, 255, 255, 255,
    255, 255, 255, 0,
    255, 255, 255, 255,
    255, 255, 255, 255,
  ]);
  const png = async (pixels) => sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const result = await composite.enforceLocalEditMask(
    [{ url: dataUrl(await png(providerPixels)) }],
    dataUrl(await png(guidePixels)),
    dataUrl(await png(maskPixels)),
    {
      moveSourceMaskReference: dataUrl(await png(sourceMaskPixels)),
      moveSourceOriginalReference: dataUrl(await png(originalPixels)),
    },
  );
  const output = await raw(Buffer.from(result[0].url.split(',')[1], 'base64'));

  assert.ok(output.data[1 * 4] < providerPixels[1 * 4], 'a retained duplicate is softened toward the Provider background');
  assert.notDeepEqual([...output.data.subarray(1 * 4, 2 * 4)], [...providerPixels.subarray(1 * 4, 2 * 4)], 'the retained subject core is repaired');
  assert.notDeepEqual([...output.data.subarray(1 * 4, 2 * 4)], [...guidePixels.subarray(1 * 4, 2 * 4)], 'the rough synthetic guide must not replace the whole source region');
  assert.deepEqual([...output.data.subarray(3 * 4, 4 * 4)], [220, 0, 0, 255], 'the moved object remains at the destination');
  assert.deepEqual([...output.data.subarray(0, 4)], [...guidePixels.subarray(0, 4)], 'protected pixels stay unchanged from the move guide');
});

test('move compositing removes a retained subject with a feathered source repair halo', async () => {
  const width = 48;
  const height = 32;
  const originalPixels = Buffer.alloc(width * height * 4);
  const guidePixels = Buffer.alloc(width * height * 4);
  const providerPixels = Buffer.alloc(width * height * 4);
  const editMaskPixels = Buffer.alloc(width * height * 4);
  const sourceMaskPixels = Buffer.alloc(width * height * 4);
  const subjectAt = (x, y, centerX) => ((x - centerX) / 4) ** 2 + ((y - 16) / 6) ** 2 <= 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const background = [40 + x * 2, 70 + y, 120 + x];
      const originalSubject = subjectAt(x, y, 10);
      const targetSubject = subjectAt(x, y, 36);
      originalPixels.set([...(originalSubject ? [220, 24, 32] : background), 255], index);
      guidePixels.set([...(targetSubject ? [220, 24, 32] : background), 255], index);
      providerPixels.set([...(originalSubject || targetSubject ? [220, 24, 32] : background), 255], index);
      const sourceEdit = subjectAt(x, y, 10) || (Math.abs(x - 10) <= 5 && Math.abs(y - 16) <= 7);
      const targetRing = !targetSubject && Math.abs(x - 36) <= 5 && Math.abs(y - 16) <= 7;
      editMaskPixels.set([255, 255, 255, sourceEdit || targetRing ? 0 : 255], index);
      sourceMaskPixels.set([255, 255, 255, originalSubject ? 0 : 255], index);
    }
  }

  const png = async (pixels) => sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const [original, guide, provider, editMask, sourceMask] = await Promise.all([
    png(originalPixels), png(guidePixels), png(providerPixels), png(editMaskPixels), png(sourceMaskPixels),
  ]);
  const result = await composite.enforceLocalEditMask(
    [{ url: dataUrl(provider) }],
    dataUrl(guide),
    dataUrl(editMask),
    {
      moveSourceMaskReference: dataUrl(sourceMask),
      moveSourceOriginalReference: dataUrl(original),
    },
  );
  const output = await raw(Buffer.from(result[0].url.split(',')[1], 'base64'));
  const pixelAt = (x, y) => [...output.data.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)];

  assert.ok(pixelAt(10, 16)[0] < 120, 'the old subject core is removed instead of surviving as a duplicate');
  assert.ok(pixelAt(10, 10)[0] < 120, 'the subject edge is repaired without a red silhouette rim');
  assert.ok(Math.abs(pixelAt(9, 16)[0] - pixelAt(8, 16)[0]) < 20, 'the reconstructed background follows its neighboring gradient');
  assert.deepEqual(pixelAt(36, 16), [220, 24, 32], 'the moved subject remains at the destination');
  assert.deepEqual(pixelAt(2, 2), [44, 72, 122], 'pixels outside both edit regions remain unchanged');
});

test('feathered masks are blended and differently sized inputs are aligned to the Provider result', async () => {
  const source = await solid(2, 2, { r: 200, g: 0, b: 0, alpha: 1 });
  const providerResult = await solid(4, 4, { r: 0, g: 0, b: 200, alpha: 1 });
  const featheredMask = await mask(2, 2, (x, y) => x === 0 && y === 0 ? 128 : 255);
  const output = await composite.enforceLocalEditMask(
    [{ url: dataUrl(providerResult) }],
    dataUrl(source),
    dataUrl(featheredMask),
  );
  const result = await raw(Buffer.from(output[0].url.split(',')[1], 'base64'));
  assert.deepEqual([...result.data.subarray(0, 4)], [100, 0, 100, 255]);
  assert.deepEqual([...result.data.subarray(8, 12)], [200, 0, 0, 255]);
  assert.equal(result.info.width, 4);
  assert.equal(result.info.height, 4);
});

test('invalid local-edit media fails closed instead of returning the unconstrained Provider result', async () => {
  await assert.rejects(
    composite.enforceLocalEditMask(
      [{ url: 'data:image/png;base64,not-a-real-image' }],
      dataUrl(await solid(2, 2, { r: 1, g: 2, b: 3, alpha: 1 })),
      dataUrl(await mask(2, 2)),
    ),
  );
});

test('both image-generation entry points use the move guide for Provider conditioning and compositing', async () => {
  const editRoute = await readFile(new URL('../app/api/edit/route.ts', import.meta.url), 'utf8');
  const generateRoute = await readFile(new URL('../app/api/generate/route.ts', import.meta.url), 'utf8');
  assert.match(editRoute, /const providerReferences = moveGuide \? \[moveGuide, \.\.\.resolvedReferences\.slice\(1\)\] : resolvedReferences/);
  assert.match(generateRoute, /const providerReferences = moveGuide \? \[moveGuide, \.\.\.references\.slice\(1\)\] : references/);
  assert.match(editRoute, /enforceLocalEditMask\(providerImages, moveGuide \|\| resolvedReferences\[0\], mask/);
  assert.match(generateRoute, /enforceLocalEditMask\(providerImages, moveGuide \|\| references\[0\], mask/);
});
