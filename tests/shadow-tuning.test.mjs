import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tuningCss = fs.readFileSync(path.join(root, 'app', 'shadow-tuning.css'), 'utf8');
const layout = fs.readFileSync(path.join(root, 'app', 'layout.tsx'), 'utf8');

test('shadow tuning is loaded after the shared surfaces', () => {
  assert.match(layout, /import ['"]\.\/shadow-tuning\.css['"];?/);
  assert.match(tuningCss, /html\[data-theme="light"\][\s\S]*--shadow:0 14px 34px rgba\(31,33,44,\.08\)/);
  assert.match(tuningCss, /--shadow-modal:0 20px 56px rgba\(31,33,44,\.14\)/);
});

test('floating canvas and app surfaces use the restrained shadow tokens', () => {
  assert.match(tuningCss, /\.canvas-topbar-main,[\s\S]*\.canvas-agent-result-float,[\s\S]*box-shadow:var\(--shadow-float\)/);
  assert.match(tuningCss, /\.dropdown-menu,[\s\S]*\.select-menu-popover,[\s\S]*box-shadow:var\(--shadow-popover\)/);
  assert.match(tuningCss, /\.model-picker-dialog,[\s\S]*\.video-prompt-dialog-inner,[\s\S]*box-shadow:var\(--shadow-modal\)/);
  assert.match(tuningCss, /\.agent-web-mode-menu,[\s\S]*\.generate-mention-menu,[\s\S]*box-shadow:var\(--shadow-popover\)/);
  assert.match(tuningCss, /\.canvas-group \.canvas-group-port:hover::before/);
  assert.match(tuningCss, /\.canvas-node \.canvas-port:focus-visible::before/);
  assert.match(tuningCss, /0 3px 9px color-mix\(in srgb,#000 12%,transparent\)/);
  assert.match(tuningCss, /html\[data-theme="light"\] \.canvas-group[\s\S]*background:color-mix\(in srgb,var\(--accent-soft\) 32%,var\(--panel\)\)/);
});
