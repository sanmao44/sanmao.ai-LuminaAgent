import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const globals = fs.readFileSync(path.join(root, 'app', 'globals.css'), 'utf8');
const tuning = fs.readFileSync(path.join(root, 'app', 'shadow-tuning.css'), 'utf8');

test('light theme defines layered surface tokens without changing the dark palette', () => {
  assert.match(globals, /html\[data-theme="light"\]\s*\{[\s\S]*--surface-page:/);
  assert.match(globals, /--surface-card-start:color-mix\(in srgb,var\(--panel\) 94%,var\(--accent\) 6%\)/);
  assert.match(globals, /html\[data-theme="dark"\]\s*\{[\s\S]*--bg:#0e1015/);
});

test('light theme applies subtle gradients to shared shells and repeated cards', () => {
  assert.match(tuning, /html\[data-theme="light"\] \.surface,[\s\S]*background:linear-gradient\(155deg,var\(--surface-shell-start\),var\(--surface-shell-end\)\)/);
  assert.match(tuning, /html\[data-theme="light"\] \.image-card,[\s\S]*background:linear-gradient\(145deg,var\(--surface-card-start\),var\(--surface-card-end\)\)/);
  for (const selector of [
    '.creative-video-card',
    '.provider-card',
    '.models-page .model-card',
    '.logs-page .log-row',
    '.video-task-card',
    '.canvas-node',
  ]) {
    assert.ok(tuning.includes(`html[data-theme="light"] ${selector}`), `missing light surface rule for ${selector}`);
  }
  assert.match(tuning, /html\[data-theme="light"\] \.canvas-context-menu,[\s\S]*background:linear-gradient\(155deg,var\(--surface-popover-start\),var\(--surface-popover-end\)\)/);
  assert.match(tuning, /html\[data-theme="light"\] \.video-task-card\.done\s*\{[\s\S]*background:var\(--success-soft\)/);
  assert.match(tuning, /html\[data-theme="light"\] \.search-box,[\s\S]*background:var\(--surface-control\)/);
  assert.match(tuning, /html\[data-theme="light"\] \.canvas-node\s*\{[\s\S]*var\(--node-effective,var\(--accent\)\)/);
});

test('media stages are not recolored by the light surface pass', () => {
  assert.doesNotMatch(tuning, /html\[data-theme="light"\][\s\S]*\.(image-stage|creative-video-preview|canvas-media-stage)\s*\{/);
});
