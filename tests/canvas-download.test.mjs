import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { unzipSync } from 'fflate';

const sourceUrl = new URL('../lib/canvas/download.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const fflateUrl = pathToFileURL(createRequire(import.meta.url).resolve('fflate')).href;
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText.replace(
  'import { Zip, ZipPassThrough, zipSync } from "fflate";',
  `const { Zip, ZipPassThrough, zipSync } = await import(${JSON.stringify(fflateUrl)});`,
);
const download = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('orders selected canvas images by selectedIds insertion order', () => {
  const items = [
    { id: 'a', name: 'A', url: 'a' },
    { id: 'b', name: 'B', url: 'b' },
    { id: 'c', name: 'C', url: 'c' },
  ];
  assert.deepEqual(
    download.orderCanvasImageItems(items, new Set(['c', 'a', 'b'])).map((item) => item.id),
    ['c', 'a', 'b'],
  );
});

test('downloads images concurrently and preserves ordered, unique zip names', async () => {
  let active = 0;
  let peak = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetcher = async (url) => {
    active += 1;
    peak = Math.max(peak, active);
    await gate;
    active -= 1;
    return new Response(new Uint8Array([url.charCodeAt(0)]), {
      headers: { 'content-type': url.endsWith('webp') ? 'image/webp' : 'image/png' },
    });
  };
  const promise = download.createCanvasImageZip([
    { id: 'one', name: '同名', url: 'a.png' },
    { id: 'two', name: '同名', url: 'b.webp' },
  ], fetcher);
  await Promise.resolve();
  assert.equal(peak, 2);
  release();
  const result = await promise;
  assert.deepEqual(result.fileNames, ['01-同名.png', '02-同名.webp']);
  const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  assert.deepEqual(Object.keys(files), result.fileNames);
  assert.deepEqual([...files['01-同名.png']], [97]);
  assert.deepEqual([...files['02-同名.webp']], [98]);
});

test('preserves SVG format in canvas archive names', async () => {
  const result = await download.createCanvasImageZip([
    { id: 'svg', name: 'vector.svg', url: 'vector' },
  ], async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }));
  assert.deepEqual(result.fileNames, ['01-vector.svg']);
});

test('does not create a partial zip when an image download fails', async () => {
  await assert.rejects(
    download.createCanvasImageZip([
      { id: 'ok', name: '正常', url: 'ok.png' },
      { id: 'bad', name: '失败', url: 'bad.png' },
    ], async (url) => url === 'bad.png'
      ? new Response('missing', { status: 404 })
      : new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } })),
    /图片下载失败：失败（HTTP 404）/,
  );
});

test('canvas exposes a multi-image download action without replacing single downloads', async () => {
  const component = await readFile(new URL('../components/canvas/CanvasWorkspace.tsx', import.meta.url), 'utf8');
  const selectionToolbar = await readFile(new URL('../components/canvas/CanvasSelectionToolbar.tsx', import.meta.url), 'utf8');
  assert.match(component, /createCanvasMediaZip\(downloadItems\)/);
  assert.match(selectionToolbar, /selectedImageCount >= 2/);
  assert.match(component, /\.filter\(\(node\) => isCanvasReadyImageSource\(node\)\)/);
  assert.match(selectionToolbar, /按选择顺序打包下载图片/);
  assert.match(component, /const downloadCanvasNode = useCallback/);
});

test('remote fetch failure saves through existing storage before zipping', async () => {
  const calls = [];
  const result = await download.createCanvasImageZip([{ id: 'r', name: 'remote', url: 'https://example.com/a.png' }], async (url) => {
    calls.push(url);
    if (url.startsWith('https:')) throw new TypeError('Failed to fetch');
    if (url === '/api/storage/images') return Response.json({ images: [{ url: '/api/storage/file?name=a.png' }] });
    return new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png' } });
  });
  assert.equal(result.fileNames.length, 1);
  assert.deepEqual(calls, ['https://example.com/a.png', '/api/storage/images', '/api/storage/file?name=a.png']);
});

test('group downloads include ready media and skip unsupported group members', () => {
  const nodes = [
    { id: 'image', type: 'media', data: { kind: 'image', name: 'photo.png', url: '/image.png' } },
    { id: 'video', type: 'media', data: { kind: 'video', name: 'clip.mp4', url: '/clip.mp4' } },
    { id: 'upscale', type: 'upscale', data: { kind: 'image', url: '/upscale.png' } },
    { id: 'audio', type: 'media', data: { kind: 'audio', url: '/sound.mp3' } },
    { id: 'three-d', type: 'media', data: { kind: '3d', url: '/model.glb' } },
    { id: 'missing-url', type: 'media', data: { kind: 'video', url: '  ' } },
    { id: 'running-video', type: 'media', data: { kind: 'video', url: '/running.mp4', status: 'running' } },
    { id: 'failed-image', type: 'media', data: { kind: 'image', url: '/failed.png', status: 'failed' } },
    { id: 'prompt', type: 'prompt', data: { kind: 'image', url: '/not-media.png' } },
  ];
  assert.deepEqual(download.canvasGroupDownloadItems(nodes), [
    { id: 'image', name: 'photo.png', url: '/image.png', kind: 'image' },
    { id: 'video', name: 'clip.mp4', url: '/clip.mp4', kind: 'video' },
    { id: 'upscale', name: '图片素材', url: '/upscale.png', kind: 'image' },
  ]);
});

test('selected video downloads include only ready selected videos in selection order', () => {
  const nodes = [
    { id: 'image', type: 'media', data: { kind: 'image', name: 'still.png', url: '/still.png' } },
    { id: 'first', type: 'media', data: { kind: 'video', name: 'first.mp4', url: '/first.mp4' } },
    { id: 'running', type: 'media', data: { kind: 'video', name: 'pending.mp4', url: '/pending.mp4', status: 'running' } },
    { id: 'second', type: 'media', data: { kind: 'video', name: 'second.webm', url: '/second.webm' } },
  ];
  assert.deepEqual(
    download.selectedCanvasVideoDownloadItems(nodes, new Set(['second', 'image', 'running', 'first'])),
    [
      { id: 'second', name: 'second.webm', url: '/second.webm', kind: 'video' },
      { id: 'first', name: 'first.mp4', url: '/first.mp4', kind: 'video' },
    ],
  );
});

test('group media archives include video bytes with the MIME-derived extension', async () => {
  const result = await download.createCanvasMediaZip([
    { id: 'image', kind: 'image', name: 'photo.png', url: 'image' },
    { id: 'video', kind: 'video', name: 'clip.mp4', url: 'video' },
  ], async (url) => new Response(new Uint8Array([url === 'video' ? 2 : 1]), {
    headers: { 'content-type': url === 'video' ? 'video/webm' : 'image/png' },
  }));
  assert.deepEqual(result.fileNames, ['01-photo.png', '02-clip.webm']);
  const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  assert.deepEqual([...files['01-photo.png']], [1]);
  assert.deepEqual([...files['02-clip.webm']], [2]);
});

test('video archive failures do not incorrectly use the image storage fallback', async () => {
  const calls = [];
  await assert.rejects(
    download.createCanvasMediaZip([
      { id: 'video', kind: 'video', name: 'clip.mp4', url: 'https://example.com/clip.mp4' },
    ], async (url) => { calls.push(url); throw new TypeError('Failed to fetch'); }),
    /素材下载失败：clip\.mp4（Failed to fetch）/,
  );
  assert.deepEqual(calls, ['https://example.com/clip.mp4']);
});

test('upscale results expose a direct download action on the infinite canvas', async () => {
  const component = await readFile(new URL('../components/canvas/CanvasWorkspace.tsx', import.meta.url), 'utf8');
  const quickActionsStart = component.indexOf('const quickActions = useMemo');
  const contextMenuStart = component.indexOf('const contextMenuGroups = useMemo', quickActionsStart);
  assert.ok(quickActionsStart >= 0 && contextMenuStart > quickActionsStart);
  const quickActions = component.slice(quickActionsStart, contextMenuStart);
  assert.match(component, /node\.type !== "media" && node\.type !== "upscale"/);
  assert.match(
    quickActions,
    /if \(node\.type === "upscale"\) \{[\s\S]*?const hasResult = Boolean\(node\.data\.url\)[\s\S]*?primaryActions: \[[\s\S]*?id: "download"[\s\S]*?下载超分节点生成的图片/,
  );
  assert.match(quickActions, /if \(node\.type === "upscale"\) \{[\s\S]*?menuGroups: \[\s*\]/);
});
