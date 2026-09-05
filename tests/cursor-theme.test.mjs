import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFile(path.join(root, file), 'utf8');

test('cursor theme is loaded after the shared UI styles', async () => {
  const layout = await read('app/layout.tsx');
  assert.match(layout, /import ['"]\.\/cursor\.css['"];?/);
});

test('cursor theme defines shared platform-independent cursor assets and semantic states', async () => {
  const css = await read('app/cursor.css');
  assert.match(css, /body \*\s*\{\s*cursor: var\(--cursor-default\) !important/);
  assert.match(css, /--cursor-pointer: url\('\/cursors\/sanmao-pointer\.svg'\)/);
  assert.match(css, /--cursor-text: url\('\/cursors\/sanmao-text\.svg'\)/);
  assert.match(css, /--cursor-grabbing: url\('\/cursors\/sanmao-grabbing\.svg'\)/);
  assert.match(css, /--cursor-resize-diagonal-reverse: url\('\/cursors\/sanmao-resize-diagonal-reverse\.svg'\) 12 12, nesw-resize/);
  assert.match(css, /\.canvas-stage button:not\(\.canvas-port\)[\s\S]*not\(\.canvas-node-resize\)[\s\S]*not\(\.canvas-group-resize\)[\s\S]*not\(\.image-editor-outpaint-handle\)/);
  assert.match(css, /\.image-editor-outpaint-handle\.top-right[\s\S]*var\(--cursor-resize-diagonal-reverse\)/);
  assert.match(css, /\.canvas-stage\.is-cursor-selecting[\s\S]*var\(--cursor-crosshair\)/);
  assert.match(css, /\.local-edit-canvas-stack\[data-tool='pan'\]/);
});

test('all cursor asset references exist', async () => {
  const css = await read('app/cursor.css');
  const assets = [...css.matchAll(/\/cursors\/([^'\)]+\.svg)/g)].map((match) => match[1]);
  for (const asset of new Set(assets)) {
    await fs.access(path.join(root, 'public', 'cursors', asset));
  }
});

test('diagonal resize cursors match their CSS semantics', async () => {
  const css = await read('app/cursor.css');
  const nwse = await read('public/cursors/sanmao-resize-diagonal.svg');
  const nesw = await read('public/cursors/sanmao-resize-diagonal-reverse.svg');
  assert.match(nwse, /M4 4 20 20/);
  assert.match(nesw, /M4 20 20 4/);
  assert.match(css, /\.outpaint-handle\.top-right[\s\S]*var\(--cursor-resize-diagonal-reverse\)/);
  assert.doesNotMatch(css, /sanmao-resize-diagonal-reverse\.svg'\) 16 16/);
});

test('local editor exposes its active tool to the cursor theme', async () => {
  const component = await read('components/MaskEditor.tsx');
  assert.match(component, /className="local-edit-canvas-stack" data-tool=\{tool\}/);
  assert.doesNotMatch(component, /cursor: useToolCursor\(tool\)/);
});
