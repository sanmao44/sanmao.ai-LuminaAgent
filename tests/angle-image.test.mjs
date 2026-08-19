import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const sharpUrl = pathToFileURL(require.resolve('sharp')).href;
const sourceUrl = new URL('../lib/angle-image.ts', import.meta.url);
const source = (await readFile(sourceUrl, 'utf8')).replace("from 'sharp'", `from '${sharpUrl}'`);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const { renderAngleOutput } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

async function opaqueFixture(width, height) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 24, g: 92, b: 180 } },
  }).composite([
    { input: { create: { width: Math.ceil(width / 2), height: Math.ceil(height / 2), channels: 3, background: { r: 230, g: 78, b: 45 } } }, left: 0, top: 0 },
    { input: { create: { width: Math.ceil(width / 3), height: Math.ceil(height / 3), channels: 3, background: { r: 248, g: 202, b: 44 } } }, left: width - Math.ceil(width / 3), top: height - Math.ceil(height / 3) },
  ]).png().toBuffer();
}

for (const [name, sourceWidth, sourceHeight, width, height, roll] of [
  ['level portrait', 240, 400, 120, 200, 0],
  ['clockwise portrait', 240, 400, 120, 200, 17],
  ['counterclockwise landscape', 400, 240, 200, 120, -23],
]) {
  test(`renders ${name} without exposed corners`, async () => {
    const output = await renderAngleOutput(await opaqueFixture(sourceWidth, sourceHeight), width, height, roll);
    const image = sharp(output);
    const [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);
    assert.equal(metadata.width, width);
    assert.equal(metadata.height, height);
    assert.equal(metadata.hasAlpha, false);
    assert.ok(stats.channels.every((channel) => channel.max > channel.min));
  });
}

test('the exported 3D guide stays level even when the preview has Roll', async () => {
  const consoleSource = await readFile(new URL('../components/AngleConsole.tsx', import.meta.url), 'utf8');
  const captureBlock = consoleSource.slice(consoleSource.indexOf('capture: async'), consoleSource.indexOf('const defaultLoader'));
  assert.match(captureBlock, /Reference 2 always remains level/);
  assert.doesNotMatch(captureBlock, /guideCamera\.rotateZ/);
});
