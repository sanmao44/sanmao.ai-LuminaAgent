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
const source = (await readFile(sourceUrl, 'utf8'))
  .replace("from 'sharp'", `from '${sharpUrl}'`)
  .replace(
    "import { resolveStoredImageReference } from './image-storage';",
    'const resolveStoredImageReference = async () => { throw new Error("stored image is unavailable"); };',
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

test('both image-generation entry points enforce the local-edit composite', async () => {
  const editRoute = await readFile(new URL('../app/api/edit/route.ts', import.meta.url), 'utf8');
  const generateRoute = await readFile(new URL('../app/api/generate/route.ts', import.meta.url), 'utf8');
  assert.match(editRoute, /enforceLocalEditMask\(providerImages, resolvedReferences\[0\], mask/);
  assert.match(generateRoute, /enforceLocalEditMask\(normalizedImages, references\[0\], mask/);
});
