import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';
import ffmpegPath from 'ffmpeg-static';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assembleSourcePath = path.join(repoRoot, 'lib', 'clone', 'assemble.ts');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? -1, stderr }));
  });
}

function runBytes(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? -1, stdout: Buffer.concat(chunks), stderr }));
  });
}

function moduleCandidates(file) {
  return [file, `${file}.ts`, `${file}.tsx`, `${file}.js`, `${file}.mjs`, path.join(file, 'index.ts')];
}

async function resolveLocalModule(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of moduleCandidates(base)) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * This test suite runs without a TS runtime. Materialize only the small
 * dependency graph used by assemble.ts as native ESM in a temporary folder.
 */
async function materializeModuleGraph(entry, outputRoot) {
  const files = new Map();
  const visit = async (sourceFile) => {
    if (files.has(sourceFile)) return files.get(sourceFile);
    const relative = path.relative(repoRoot, sourceFile);
    const outputFile = path.join(outputRoot, relative.replace(/\.(?:tsx?|mts|cts)$/u, '.mjs'));
    files.set(sourceFile, outputFile);
    const source = await readFile(sourceFile, 'utf8');
    const transformed = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      fileName: sourceFile,
    }).outputText;
    const imports = [...transformed.matchAll(/(?:from\s+|import\s*\(\s*)(['"])(\.[^'"]+)\1/gu)];
    let output = transformed;
    for (const match of imports) {
      const specifier = match[2];
      const localFile = await resolveLocalModule(sourceFile, specifier);
      if (!localFile) continue;
      const importedFile = await visit(localFile);
      let replacement = path.relative(path.dirname(outputFile), importedFile).replaceAll('\\', '/');
      if (!replacement.startsWith('.')) replacement = `./${replacement}`;
      output = output.replaceAll(`'${specifier}'`, `'${replacement}'`).replaceAll(`"${specifier}"`, `"${replacement}"`);
    }
    await fsMkdir(path.dirname(outputFile));
    await writeText(outputFile, output);
    return outputFile;
  };
  return pathToFileURL(await visit(entry)).href;
}

async function fsMkdir(directory) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(directory, { recursive: true });
}

async function writeText(file, content) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, content, 'utf8');
}

async function createMedia(ffmpeg, directory) {
  const reference = path.join(directory, 'reference.mp4');
  const still = path.join(directory, 'card.jpg');
  const voice = path.join(directory, 'voice.wav');
  const referenceResult = await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=24:d=0.5',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=0.5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map', '[v]', '-map', '2:a:0', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', reference,
  ]);
  assert.equal(referenceResult.code, 0, referenceResult.stderr);
  const stillResult = await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180', '-frames:v', '1', still,
  ]);
  assert.equal(stillResult.code, 0, stillResult.stderr);
  const voiceResult = await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', voice,
  ]);
  assert.equal(voiceResult.code, 0, voiceResult.stderr);
  return {
    reference,
    still: `data:image/jpeg;base64,${(await readFile(still)).toString('base64')}`,
    voice: `data:audio/wav;base64,${(await readFile(voice)).toString('base64')}`,
  };
}

async function createDistinctAudioReference(ffmpeg, directory) {
  const reference = path.join(directory, 'reference-distinct-audio.mp4');
  const result = await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=24:d=0.5',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=0.5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.5',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a][3:a]concat=n=2:v=0:a=1[a]',
    '-map', '[v]', '-map', '[a]', '-t', '1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', reference,
  ]);
  assert.equal(result.code, 0, result.stderr);
  return {
    reference,
    source: `data:video/mp4;base64,${(await readFile(reference)).toString('base64')}`,
  };
}

async function toneStrength(ffmpeg, file, start, frequency) {
  const decoded = await runBytes(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-ss', String(start), '-t', '0.12', '-i', file,
    '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-',
  ]);
  assert.equal(decoded.code, 0, decoded.stderr);
  const samples = new Int16Array(decoded.stdout.buffer, decoded.stdout.byteOffset, Math.floor(decoded.stdout.byteLength / 2));
  assert.ok(samples.length > 400, `expected decoded audio samples at ${start}s`);
  let sine = 0;
  let cosine = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const phase = 2 * Math.PI * frequency * index / 8000;
    sine += samples[index] * Math.sin(phase);
    cosine += samples[index] * Math.cos(phase);
  }
  return Math.hypot(sine, cosine) / samples.length;
}

function distinctAudioTimeline(withEditorState) {
  const videoClips = [
    { id: 'clone-video-0', sourceClipId: 'clone-video-0', shotIndex: 0, track: 'video', type: 'video', name: 'extended first shot', start: 0, duration: 0.8, sourceOffset: 0 },
    { id: 'clone-video-1', sourceClipId: 'clone-video-1', shotIndex: 1, track: 'video', type: 'video', name: 'second shot', start: 0.8, duration: 0.5, sourceOffset: 0.5 },
  ];
  const referenceAudio = {
    id: 'clone-reference-audio-global',
    sourceClipId: 'clone-reference-audio-global',
    shotIndex: 0,
    track: 'reference-audio',
    type: 'audio',
    name: 'reference ambience',
    start: 0,
    duration: 1.3,
    sourceOffset: 0,
    volume: 1,
  };
  const base = {
    duration: 1.3,
    fps: 24,
    aspect: '16:9',
    clips: videoClips,
    tracks: [{
      id: 'clone-track-video', kind: 'video', label: 'video', clips: videoClips.map((clip) => ({
        id: clip.id, shotIndex: clip.shotIndex, start: clip.start, duration: clip.duration,
        source: 'reference-video', mediaKind: 'video', sourceOffset: clip.sourceOffset,
      })),
    }, {
      id: 'clone-track-reference-audio', kind: 'reference-audio', label: 'reference audio', clips: [referenceAudio],
    }],
  };
  if (!withEditorState) return base;
  return {
    ...base,
    editorState: {
      version: 1,
      projectDuration: 1.3,
      fps: 24,
      aspect: '16:9',
      resolution: '720p',
      clips: [...videoClips, referenceAudio],
      mutedTracks: [],
      disabledTracks: [],
      referenceAudioDucking: false,
    },
  };
}

function distinctAudioJob(timeline, source) {
  return {
    id: 'assemble-distinct-audio-test',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    stage: 'assembling',
    progress: 0,
    message: '',
    reference: { name: 'reference-distinct-audio.mp4', url: '', seconds: 1 },
    assets: [],
    options: { brief: 'test', maxShots: 2, maxSeconds: 2, aspect: '16:9', voice: '', preserveReferenceTiming: true, preserveReferenceAudio: true },
    capabilities: { vision: false, speech: false, image: false, video: false, referenceImages: false, firstFrame: false, referenceAudio: false, offlineSpeech: false },
    warnings: [],
    models: { chat: '' },
    shots: [
      { index: 0, start: 0, end: 0.5, visual: 'red card', line: '', prompt: '', status: 'done', preserveReferenceFrame: true },
      { index: 1, start: 0.5, end: 1, visual: 'blue card', line: '', prompt: '', status: 'done', preserveReferenceFrame: true },
    ],
    timeline: { ...timeline, tracks: timeline.tracks.map((track) => track.kind === 'reference-audio'
      ? { ...track, clips: track.clips.map((clip) => ({ ...clip, url: source })) }
      : track) },
  };
}

test('assembleCloneVideo outputs one mixed MP4 and cleans its working directory', async (t) => {
  if (!ffmpegPath || !existsSync(ffmpegPath)) return t.skip('ffmpeg-static is unavailable');
  // Keep the temporary ESM graph below the repository so Node can resolve the
  // project's node_modules from the materialized files.
  const root = await mkdtemp(path.join(repoRoot, 'tests', '.clone-assemble-'));
  const moduleRoot = path.join(root, 'modules');
  const mediaRoot = path.join(root, 'media');
  const outputRoot = path.join(root, 'output');
  await fsMkdir(mediaRoot);
  await fsMkdir(outputRoot);
  const oldVideoRoot = process.env.SANMAO_VIDEO_STORAGE_PATH;
  process.env.SANMAO_VIDEO_STORAGE_PATH = outputRoot;
  try {
    const media = await createMedia(ffmpegPath, mediaRoot);
    const assembleUrl = await materializeModuleGraph(assembleSourcePath, moduleRoot);
    const { assembleCloneVideo } = await import(assembleUrl);
    const workingDirectory = path.join(root, 'working');
    const timeline = {
      duration: 2,
      fps: 24,
      aspect: '16:9',
      clips: [
        { id: 'clone-video-0', track: 'video', type: 'video', start: 0, duration: 1 },
        { id: 'clone-caption-0', track: 'caption', type: 'caption', start: 0, duration: 1, text: 'should not be burned' },
        { id: 'clone-video-1', track: 'video', type: 'image', start: 1, duration: 1, motionPath: 'pan-left', layout: { mode: 'picture-in-picture', backgroundColor: '#101014', primary: { x: 0, y: 0, width: 0.58, height: 1 }, secondary: { x: 0.7, y: 0.7, width: 0.24, height: 0.24, radius: 0.04 } } },
        { id: 'clone-caption-1', track: 'caption', type: 'caption', start: 1, duration: 1, text: 'normal subtitle', words: [{ start: 0, end: 0.5, text: 'normal ' }, { start: 0.5, end: 1, text: 'subtitle' }] },
      ],
    };
    const job = {
      id: 'assemble-test',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      stage: 'assembling',
      progress: 0,
      message: '',
      reference: { name: 'reference.mp4', url: '', seconds: 1 },
      assets: [],
      options: { brief: 'test', maxShots: 2, maxSeconds: 2, aspect: '16:9', voice: '', preserveReferenceTiming: true, preserveReferenceAudio: true },
      capabilities: { vision: false, speech: true, image: true, video: false, referenceImages: false, firstFrame: false, referenceAudio: false, offlineSpeech: false },
      warnings: [],
      models: { chat: '' },
      shots: [
        { index: 0, start: 0, end: 1, visual: 'card', line: 'should not appear', prompt: '', status: 'done', preserveReferenceFrame: true, audioUrl: media.voice },
        { index: 1, start: 0, end: 1, visual: 'blue card', line: 'subtitle', prompt: '', status: 'done', imageUrl: media.still, audioUrl: media.voice, analysis: { transition: '\u53e0\u5316' } },
      ],
      timeline,
    };
    const result = await assembleCloneVideo({ job, timeline, referenceFile: media.reference, workingDirectory });
    assert.equal(result.mime, 'video/mp4');
    assert.match(result.url, /^\/api\/storage\/video\?name=/u);
    const outputName = decodeURIComponent(new URL(`http://localhost${result.url}`).searchParams.get('name'));
    const outputFile = path.join(outputRoot, outputName);
    assert.ok((await stat(outputFile)).size > 0);
    assert.equal(existsSync(workingDirectory), false, 'assembly working directory should be removed');
    const files = await readdir(outputRoot);
    assert.deepEqual(files, [outputName], 'assembly should persist exactly one final video');

    const probe = await run(ffmpegPath, ['-hide_banner', '-i', outputFile]);
    assert.equal(probe.code, 1, 'ffmpeg probe exits 1 when no output is requested');
    assert.match(probe.stderr, /Duration:/u);
    assert.match(probe.stderr, /Audio:/u, 'the final MP4 should contain mixed audio');
    assert.match(probe.stderr, /Duration:\s+00:00:02\./u, 'transition padding should keep the timeline duration');
    assert.match(await readFile(assembleSourcePath, 'utf8'), /filter_complex/u);

    const early = await runBytes(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', '0.2', '-i', outputFile, '-frames:v', '1', '-vf', 'scale=1:1,format=rgb24', '-f', 'rawvideo', '-']);
    const late = await runBytes(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', '0.8', '-i', outputFile, '-frames:v', '1', '-vf', 'scale=1:1,format=rgb24', '-f', 'rawvideo', '-']);
    assert.equal(early.code, 0, early.stderr);
    assert.equal(late.code, 0, late.stderr);
    assert.ok(early.stdout.length >= 3 && late.stdout.length >= 3, 'reference-preserved shot should contain decodable frames');
    assert.ok(early.stdout[0] > early.stdout[2] * 1.5, 'early reference frame should retain the red card');
    assert.ok(late.stdout[2] > late.stdout[0] * 1.5, 'late reference frame should retain the blue card');
    const pip = await runBytes(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', '1.2', '-i', outputFile, '-frames:v', '1', '-vf', 'crop=1:1:1584:891,format=rgb24', '-f', 'rawvideo', '-']);
    assert.equal(pip.code, 0, pip.stderr);
    assert.ok(pip.stdout[2] > pip.stdout[0] * 1.5, 'picture-in-picture secondary region should retain the source frame');
  } finally {
    if (oldVideoRoot === undefined) delete process.env.SANMAO_VIDEO_STORAGE_PATH;
    else process.env.SANMAO_VIDEO_STORAGE_PATH = oldVideoRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test('reference ambience follows the source clock after an earlier shot is extended', async (t) => {
  if (!ffmpegPath || !existsSync(ffmpegPath)) return t.skip('ffmpeg-static is unavailable');
  const root = await mkdtemp(path.join(repoRoot, 'tests', '.clone-assemble-audio-clock-'));
  const moduleRoot = path.join(root, 'modules');
  const mediaRoot = path.join(root, 'media');
  const outputRoot = path.join(root, 'output');
  await fsMkdir(mediaRoot);
  await fsMkdir(outputRoot);
  const oldVideoRoot = process.env.SANMAO_VIDEO_STORAGE_PATH;
  process.env.SANMAO_VIDEO_STORAGE_PATH = outputRoot;
  try {
    const media = await createDistinctAudioReference(ffmpegPath, mediaRoot);
    const assembleUrl = await materializeModuleGraph(assembleSourcePath, moduleRoot);
    const { assembleCloneVideo } = await import(assembleUrl);
    for (const withEditorState of [false, true]) {
      const timeline = distinctAudioTimeline(withEditorState);
      const job = distinctAudioJob(timeline, media.source);
      const workingDirectory = path.join(root, withEditorState ? 'working-editor' : 'working-flat');
      const result = await assembleCloneVideo({ job, timeline: job.timeline, referenceFile: media.reference, workingDirectory });
      const outputName = decodeURIComponent(new URL(`http://localhost${result.url}`).searchParams.get('name'));
      const outputFile = path.join(outputRoot, outputName);
      assert.ok((await stat(outputFile)).size > 0);
      assert.equal(existsSync(workingDirectory), false);
      const early440 = await toneStrength(ffmpegPath, outputFile, 0.2, 440);
      const late880 = await toneStrength(ffmpegPath, outputFile, 0.9, 880);
      const lateWrong440 = await toneStrength(ffmpegPath, outputFile, 0.9, 440);
      assert.ok(early440 > 20, `${withEditorState ? 'editor' : 'flat'} output lost the first source interval`);
      assert.ok(late880 > lateWrong440 * 1.8, `${withEditorState ? 'editor' : 'flat'} output drifted to the first ambience interval`);
    }
  } finally {
    if (oldVideoRoot === undefined) delete process.env.SANMAO_VIDEO_STORAGE_PATH;
    else process.env.SANMAO_VIDEO_STORAGE_PATH = oldVideoRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test('assemble source keeps graphics captions off reference-preserved shots', async () => {
  const source = await readFile(assembleSourcePath, 'utf8');
  assert.match(source, /shot\.preserveReferenceFrame && !shot\.allowReferenceOverlays \|\| \(semanticCaption && 'enabled' in semanticCaption && semanticCaption\.enabled === false\)/u);
  assert.match(source, /semanticCaption\?\.text \|\| captionClip\?\.text \|\| ''/u);
  assert.match(source, /shot\.preserveReferenceFrame && !shot\.allowReferenceOverlays \|\| \(semanticGraphics && 'enabled' in semanticGraphics && semanticGraphics\.enabled === false\)/u);
  assert.match(source, /input\.job\.options\.preserveReferenceAudio !== false/u);
  assert.match(source, /extractReferenceAudio\(input\.referenceFile/u);
  assert.match(source, /clone-reference-audio-global/u);
  assert.match(source, /isGlobalReferenceTrack/);
  assert.match(source, /const editedSourceClipId = edited && 'sourceClipId' in edited/);
  assert.match(source, /const clipSourceClipId = 'sourceClipId' in clip/);
  assert.match(source, /Math\.max\(0, Number\(shot\.start\) \|\| 0\)/);
  assert.match(source, /const referenceDuration = Math\.max\(0\.1, \(Number\(shot\.end\) \|\| 0\) - \(Number\(shot\.start\) \|\| 0\)\)/u);
  assert.match(source, /apad=pad_dur=\$\{targetDuration\.toFixed\(3\)\}/u);
  assert.match(source, /sidechaincompress=threshold=0\.035:ratio=8/u);
  assert.match(source, /-filter_complex/u);
  assert.match(source, /'-af', `apad=pad_dur=\$\{duration\.toFixed\(3\)\}`/u);
  assert.match(source, /captionPlacement\(shot\.analysis\?\.graphicsPosition\)/u);
  assert.match(source, /w-text_w-48/u);
  assert.match(source, /function motionFilter/u);
  assert.match(source, /eval=frame/u);
  assert.match(source, /motionFilter\(shot, duration, dimensions, motionPath\)/u);
  assert.match(source, /timedCaptionWords/u);
  assert.match(source, /enable='\$\{enable\}'/u);
  assert.match(source, /referenceFrame = shot\.preserveReferenceFrame && shot\.referenceFrameUrl/u);
  assert.match(source, /return generated \|\| referenceFrame/u);
  assert.match(source, /textLayoutForFfmpeg/u);
  assert.match(source, /textFileContent\(captionLayout\?\.lines/u);
  assert.match(source, /boxcolor=black@\$\{captionBoxOpacity\.toFixed\(2\)\}/u);
  assert.match(source, /\(h\*0\.83-text_h\/2\)/u);
  assert.match(source, /videoEditorTextBox\(semanticGraphics\)/u);
});

test('reference-preserved shots fall back to their representative frame when source extraction fails', async (t) => {
  if (!ffmpegPath || !existsSync(ffmpegPath)) return t.skip('ffmpeg-static is unavailable');
  const root = await mkdtemp(path.join(repoRoot, 'tests', '.clone-assemble-reference-fallback-'));
  const moduleRoot = path.join(root, 'modules');
  const mediaRoot = path.join(root, 'media');
  const outputRoot = path.join(root, 'output');
  await fsMkdir(mediaRoot);
  await fsMkdir(outputRoot);
  const oldVideoRoot = process.env.SANMAO_VIDEO_STORAGE_PATH;
  process.env.SANMAO_VIDEO_STORAGE_PATH = outputRoot;
  try {
    const media = await createMedia(ffmpegPath, mediaRoot);
    const assembleUrl = await materializeModuleGraph(assembleSourcePath, moduleRoot);
    const { assembleCloneVideo } = await import(assembleUrl);
    const workingDirectory = path.join(root, 'working');
    const timeline = {
      duration: 0.5,
      fps: 24,
      aspect: '16:9',
      clips: [{ id: 'clone-video-0', track: 'video', type: 'video', start: 0, duration: 0.5, sourceOffset: 100 }],
    };
    const job = {
      id: 'assemble-reference-fallback-test',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      stage: 'assembling',
      progress: 0,
      message: '',
      reference: { name: 'reference.mp4', url: '', seconds: 1 },
      assets: [],
      options: { brief: 'test', maxShots: 1, maxSeconds: 2, aspect: '16:9', voice: '', preserveReferenceTiming: true, preserveReferenceAudio: false },
      capabilities: { vision: false, speech: false, image: false, video: false, referenceImages: false, firstFrame: false, referenceAudio: false, offlineSpeech: false },
      warnings: [],
      models: { chat: '' },
      shots: [{ index: 0, start: 0, end: 0.5, visual: 'blue card', line: '', prompt: '', status: 'done', preserveReferenceFrame: true, referenceFrameUrl: media.still }],
      timeline,
    };
    const result = await assembleCloneVideo({ job, timeline, referenceFile: path.join(mediaRoot, 'missing-reference.mp4'), workingDirectory });
    const outputName = decodeURIComponent(new URL(`http://localhost${result.url}`).searchParams.get('name'));
    const outputFile = path.join(outputRoot, outputName);
    assert.match(result.warnings.join('\n'), /\u53c2\u8003\u955c\u5934\u7684\u539f\u7247\u7247\u6bb5\u65e0\u6cd5\u8bfb\u53d6/u);
    const frame = await runBytes(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', '0.2', '-i', outputFile, '-frames:v', '1', '-vf', 'scale=1:1,format=rgb24', '-f', 'rawvideo', '-']);
    assert.equal(frame.code, 0, frame.stderr);
    assert.ok(frame.stdout.length >= 3);
    assert.ok(frame.stdout[2] > frame.stdout[0] * 1.5, `representative frame should replace a failed reference segment: ${[...frame.stdout].join(',')}`);
  } finally {
    if (oldVideoRoot === undefined) delete process.env.SANMAO_VIDEO_STORAGE_PATH;
    else process.env.SANMAO_VIDEO_STORAGE_PATH = oldVideoRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test('assembleCloneVideo honors the edited editor timeline instead of the generated shot plan', async (t) => {
  if (!ffmpegPath || !existsSync(ffmpegPath)) return t.skip('ffmpeg-static is unavailable');
  const root = await mkdtemp(path.join(repoRoot, 'tests', '.clone-assemble-editor-'));
  const moduleRoot = path.join(root, 'modules');
  const mediaRoot = path.join(root, 'media');
  const outputRoot = path.join(root, 'output');
  await fsMkdir(mediaRoot);
  await fsMkdir(outputRoot);
  const oldVideoRoot = process.env.SANMAO_VIDEO_STORAGE_PATH;
  process.env.SANMAO_VIDEO_STORAGE_PATH = outputRoot;
  try {
    const media = await createMedia(ffmpegPath, mediaRoot);
    const assembleUrl = await materializeModuleGraph(assembleSourcePath, moduleRoot);
    const { assembleCloneVideo } = await import(assembleUrl);
    const workingDirectory = path.join(root, 'working');
    const timeline = {
      duration: 0.3,
      fps: 24,
      aspect: '16:9',
      clips: [],
      editorState: {
        version: 1,
        projectDuration: 0.3,
        fps: 24,
        aspect: '16:9',
        resolution: '720p',
        clips: [
          { id: 'editor-video-1', sourceClipId: 'clone-video-1', shotIndex: 1, track: 'video', type: 'video', name: 'edited shot', start: 0, duration: 0.3, sourceOffset: 0.5 },
        ],
        mutedTracks: [],
        disabledTracks: [],
      },
    };
    const job = {
      id: 'assemble-editor-test',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      stage: 'assembling',
      progress: 0,
      message: '',
      reference: { name: 'reference.mp4', url: '', seconds: 1 },
      assets: [],
      options: { brief: 'test', maxShots: 2, maxSeconds: 2, aspect: '16:9', voice: '', preserveReferenceTiming: true, preserveReferenceAudio: false },
      capabilities: { vision: false, speech: true, image: true, video: false, referenceImages: false, firstFrame: false, referenceAudio: false, offlineSpeech: false },
      warnings: [],
      models: { chat: '' },
      shots: [
        { index: 0, start: 0, end: 1, visual: 'red card', line: '', prompt: '', status: 'done', preserveReferenceFrame: true },
        { index: 1, start: 0, end: 1, visual: 'blue card', line: '', prompt: '', status: 'done', preserveReferenceFrame: true },
      ],
      timeline,
    };
    const result = await assembleCloneVideo({ job, timeline, referenceFile: media.reference, workingDirectory });
    const outputName = decodeURIComponent(new URL(`http://localhost${result.url}`).searchParams.get('name'));
    const outputFile = path.join(outputRoot, outputName);
    assert.ok((await stat(outputFile)).size > 0);
    assert.equal(existsSync(workingDirectory), false);

    const probe = await run(ffmpegPath, ['-hide_banner', '-i', outputFile]);
    assert.equal(probe.code, 1);
    assert.match(probe.stderr, /Duration:\s+00:00:00\.3/u, 'edited duration should be used');
    const frame = await runBytes(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', '0.15', '-i', outputFile, '-frames:v', '1', '-vf', 'scale=1:1,format=rgb24', '-f', 'rawvideo', '-']);
    assert.equal(frame.code, 0, frame.stderr);
    assert.ok(frame.stdout.length >= 3);
    assert.ok(frame.stdout[2] > frame.stdout[0] * 1.5, 'edited sourceOffset should select the blue reference segment');
  } finally {
    if (oldVideoRoot === undefined) delete process.env.SANMAO_VIDEO_STORAGE_PATH;
    else process.env.SANMAO_VIDEO_STORAGE_PATH = oldVideoRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test('semantic tracks control reference audio, voice and caption inclusion', async (t) => {
  if (!ffmpegPath || !existsSync(ffmpegPath)) return t.skip('ffmpeg-static is unavailable');
  const source = await readFile(assembleSourcePath, 'utf8');
  assert.match(source, /timelineTrack\(input, 'caption'\)/u);
  assert.match(source, /timelineAudioClip\(input, shot, index,/u);
  assert.match(source, /enabled === false/u);
});
