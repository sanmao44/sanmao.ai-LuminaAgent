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
  'import { zipSync } from "fflate";',
  `const { zipSync } = await import(${JSON.stringify(fflateUrl)});`,
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
  const component = await readFile(new URL('../components/SuperCanvas.tsx', import.meta.url), 'utf8');
  assert.match(component, /createCanvasImageZip\(selectedImageDownloads\)/);
  assert.match(component, /selectedImageDownloads\.length >= 2/);
  assert.match(component, /\.filter\(\(node\) => isCanvasReadyImageSource\(node\)\)/);
  assert.match(component, /按选择顺序打包下载图片/);
  assert.match(component, /const downloadCanvasNode = useCallback/);
});

test('upscale results expose a direct download action on the infinite canvas', async () => {
  const component = await readFile(new URL('../components/SuperCanvas.tsx', import.meta.url), 'utf8');
  const quickActionsStart = component.indexOf('const quickActions = useMemo');
  const contextMenuStart = component.indexOf('const contextMenuGroups = useMemo', quickActionsStart);
  assert.ok(quickActionsStart >= 0 && contextMenuStart > quickActionsStart);
  const quickActions = component.slice(quickActionsStart, contextMenuStart);
  assert.match(component, /node\.type !== "media" && node\.type !== "upscale"/);
  assert.match(
    quickActions,
    /if \(node\.type === "upscale"\) \{[\s\S]*?const hasResult = Boolean\(node\.data\.url\)[\s\S]*?primaryActions: \[[\s\S]*?id: "download"[\s\S]*?下载超分节点生成的图片/,
  );
  assert.doesNotMatch(quickActions, /if \(node\.type === "upscale"\) \{[\s\S]*?menuGroups: \[\s*\{/);
});
