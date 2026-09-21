import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const canvas = await readFile(new URL('../components/SuperCanvas.tsx', import.meta.url), 'utf8');

/* 画布节点上的服务商临时地址会过期：这条补归档链路掉了，图会挂、参考素材也会读不到。 */
test('the canvas re-archives remote node media while it is idle', () => {
  assert.match(canvas, /canvasRemoteMediaUrls\(docRef\.current\.nodes\)/);
  assert.match(canvas, /const archived = await archiveCanvasRemoteImages\(remoteUrls\);/);
  assert.match(canvas, /window\.setInterval\(\(\) => void healRemoteNodeMedia\(\), 60_000\)/);
});
