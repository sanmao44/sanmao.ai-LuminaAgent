import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/jimeng-video.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const video = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const cliSourceUrl = new URL('../lib/jimeng-cli.ts', import.meta.url);
const cliSource = await readFile(cliSourceUrl, 'utf8');
const cliCompiled = ts.transpileModule(cliSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: cliSourceUrl.pathname,
}).outputText;
const jimengCli = await import(`data:text/javascript;base64,${Buffer.from(cliCompiled).toString('base64')}`);

test('exposes documented Jimeng video model versions with shared capabilities', () => {
  assert.deepEqual(video.jimengVideoModels.map((model) => model.id), [
    'jimeng-cli-video', 'seedance1.0fast', 'seedance1.5pro', 'seedance2.0', 'seedance2.0fast', 'seedance2.0mini', 'seedance2.0_vip', 'seedance2.0fast_vip', 'seedance2.5',
  ]);
  assert.deepEqual(video.jimengVideoModels.find((model) => model.id === 'seedance2.5').capabilities, [
    'video-generate', 'video-first-frame', 'video-reference', 'video-audio',
  ]);
});

test('normalizes the official canvas model-list schema without hardcoding model names', () => {
  const output = JSON.stringify({
    schemaVersion: '2',
    ok: true,
    data: {
      models: [
        {
          model: 'vendor.video.latest',
          displayName: 'Latest video',
          aliases: ['latest'],
          modes: {
            t2v: { ratios: ['16:9'], resolutions: ['720P'], durations: [5, 8, 10] },
            m2v: { ratios: ['9:16'], resolutions: ['720P'], durations: [5, 8] },
          },
        },
        {
          id: 'vendor.video.keyframe',
          name: 'Keyframe video',
          supported_modes: ['first_last_frame'],
          duration: { values: [4, 8] },
        },
      ],
    },
  });
  const models = jimengCli.parseJimengCanvasModelList(output, 'video');
  assert.deepEqual(models.map((model) => model.id), ['vendor.video.latest', 'vendor.video.keyframe']);
  assert.equal(models[0].name, 'Latest video');
  assert.deepEqual(models[0].capabilities, ['video-generate', 'video-reference']);
  assert.equal(models[0].schema.modes.t2v.durations[2], 10);
  assert.deepEqual(models[1].capabilities, ['video-generate', 'video-first-frame']);
});

test('maps image and audio modes to registry capabilities', () => {
  const image = jimengCli.parseJimengCanvasModelList(JSON.stringify({ data: { items: [
    { model_id: 'image.latest', name: 'Image', modes: ['t2i', 'i2i'], features: ['upscale'] },
  ] } }), 'image');
  assert.deepEqual(image[0].capabilities, ['generate', 'edit', 'reference', 'upscale']);

  const audio = jimengCli.parseJimengCanvasModelList(JSON.stringify({ data: { models: [
    { model: 'audio.voice', name: 'Voice', modes: ['tts'] },
  ] } }), 'audio');
  assert.deepEqual(audio[0].capabilities, ['speech']);
});

test('does not confuse wrapper metadata with a model record', () => {
  const models = jimengCli.parseJimengCanvasModelList(JSON.stringify({
    schemaVersion: '2', ok: true, data: { type: 'video', models: [] },
  }), 'video');
  assert.deepEqual(models, []);
});

test('does not treat an uninstalled Canvas command name as available', () => {
  assert.equal(jimengCli.isJimengCanvasCliAvailable('C:/path/that/does/not/exist/dreamina-canvas.exe'), false);
  assert.equal(jimengCli.isJimengCanvasCliAvailable('dreamina.exe'), false);
});

test('does not reuse a legacy dreamina path as the Canvas command', () => {
  const resolved = jimengCli.resolveJimengCanvasCliCommand('C:/path/that/does/not/exist/dreamina.exe');
  assert.equal(jimengCli.isJimengCanvasCommand(resolved), true);
  assert.notEqual(resolved.toLowerCase(), 'c:/path/that/does/not/exist/dreamina.exe');
});
