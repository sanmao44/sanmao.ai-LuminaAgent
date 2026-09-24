import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../lib/clone/rhythm.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const rhythm = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('audio metadata peaks become bounded beat cues', () => {
  const metadata = [
    'frame:0 pts_time:0',
    'lavfi.astats.Overall.RMS_level=-32',
    'frame:1 pts_time:0.1',
    'lavfi.astats.Overall.RMS_level=-31',
    'frame:2 pts_time:0.2',
    'lavfi.astats.Overall.RMS_level=-8',
    'frame:3 pts_time:0.3',
    'lavfi.astats.Overall.RMS_level=-30',
    'frame:4 pts_time:0.4',
    'lavfi.astats.Overall.RMS_level=-29',
    'frame:5 pts_time:0.5',
    'lavfi.astats.Overall.RMS_level=-6',
    'frame:6 pts_time:0.6',
    'lavfi.astats.Overall.RMS_level=-30',
  ].join('\n');
  assert.deepEqual(rhythm.parseAudioBeatMetadata(metadata, 0.65), [
    { time: 0.2, strength: 0.867 },
    { time: 0.5, strength: 0.9 },
  ]);
});

test('steady audio does not invent rhythm cues', () => {
  const metadata = Array.from({ length: 12 }, (_, index) => [
    `frame:${index} pts_time:${(index / 10).toFixed(1)}`,
    'lavfi.astats.Overall.RMS_level=-18',
  ]).flat().join('\n');
  assert.deepEqual(rhythm.parseAudioBeatMetadata(metadata, 1.2), []);
});

test('malformed and out-of-range metadata fail closed', () => {
  assert.deepEqual(rhythm.parseAudioBeatMetadata('not ffmpeg metadata', 2), []);
  const metadata = Array.from({ length: 4 }, (_, index) => [
    `pts_time:${index}`,
    `lavfi.astats.Overall.RMS_level=${index === 2 ? -2 : -30}`,
  ]).join('\n');
  assert.deepEqual(rhythm.parseAudioBeatMetadata(metadata, 1), []);
});

test('beat count is bounded and close peaks are merged', () => {
  const metadata = Array.from({ length: 400 }, (_, index) => [
    `pts_time:${(index / 10).toFixed(1)}`,
    `lavfi.astats.Overall.RMS_level=${index % 3 === 0 ? -2 : -35}`,
  ]).join('\n');
  const beats = rhythm.parseAudioBeatMetadata(metadata, 40);
  assert.ok(beats.length <= 256);
  assert.ok(beats.every((beat) => beat.time >= 0 && beat.time < 40));
  assert.ok(beats.every((beat, index) => index === 0 || beat.time - beats[index - 1].time >= 0.24));
});
