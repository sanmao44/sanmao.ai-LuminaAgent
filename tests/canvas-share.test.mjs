import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('super canvas routes image sharing through the branded share exporter', async () => {
  const component = await readFile(new URL('../components/SuperCanvas.tsx', import.meta.url), 'utf8');
  const share = await readFile(new URL('../lib/canvas/share.ts', import.meta.url), 'utf8');

  assert.match(component, /import \{ downloadCanvasShareImage \} from "@\/lib\/canvas\/share"/);
  assert.match(component, /onDownload=\{\(variant\) => \{/);
  assert.match(component, /if \(variant === "share"\)/);
  assert.match(component, /void downloadCanvasShare\(viewerNode\)/);
  assert.match(share, /loadShareImage\("\/brand-mark\.png"\)/);
  assert.match(share, /loadShareImage\("\/share-qr\.png"\)/);
  assert.match(share, /buildSharePromptPlan\(item\.prompt \|\| ""/);
  assert.match(share, /让灵感落地，把想法变成作品/);
  assert.match(share, /anchor\.download = `SANMAO-\$\{item\.id\}-分享版\.png`/);
});

test('media viewer does not expose a misleading share action for videos', async () => {
  const component = await readFile(new URL('../components/MediaViewer.tsx', import.meta.url), 'utf8');
  assert.match(component, /download\("share"\).*disabled=\{item\.kind !== "image"\}/);
});
