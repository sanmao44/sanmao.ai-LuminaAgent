import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const moduleCss = read(path.join('components', 'AgentMemoryEditor.module.css'));
const skillCss = read(path.join('components', 'SkillManager.module.css'));
const memory = read(path.join('components', 'AgentMemoryEditor.tsx'));
const persona = read(path.join('components', 'AgentPersonaEditor.tsx'));
const primaryActions = (source) => (source.match(/className=\{styles\.primary\}/g) || []).length;

test('agent memory and persona dialogs reuse the shared dialog shell', () => {
  assert.match(moduleCss, /\.dialog \{[\s\S]*?border-radius: 20px;/);
  assert.match(moduleCss, /\.dialog \{[\s\S]*?background: color-mix\(in srgb, var\(--panel\) 98%, transparent\);/);
  assert.match(moduleCss, /\.dialog \{[\s\S]*?box-shadow: var\(--shadow-soft\);/);
  const backdrop = /\.dialog::backdrop \{ background: color-mix\(in srgb, #05060b 62%, transparent\); backdrop-filter: blur\(3px\); \}/;
  assert.match(moduleCss, backdrop, 'memory and persona dialogs dim the page like the skill manager');
  assert.match(skillCss, backdrop, 'the shared backdrop must not drift from the skill manager');
});

test('agent memory and persona dialogs reuse the shared field, button and error styles', () => {
  assert.match(moduleCss, /\.dialog h2 i \{[\s\S]*?linear-gradient\(145deg, var\(--accent\), var\(--accent-2\)\)/);
  assert.match(moduleCss, /\.dialog button \{[\s\S]*?border-radius: 9px;/);
  assert.match(moduleCss, /\.dialog button\.primary \{[\s\S]*?linear-gradient\(145deg, var\(--accent\), var\(--accent-2\)\)/);
  assert.match(moduleCss, /\.dialog textarea \{[\s\S]*?border-radius: 10px;/);
  assert.match(moduleCss, /\.dialog p\[role=[^\]]*\] \{[\s\S]*?color: var\(--danger\)/);
  assert.doesNotMatch(moduleCss, /#d33d4d/, 'error text uses the danger token instead of a hardcoded red');
});

test('both editors keep their title badge and mark the main action as primary', () => {
  const badge = /<h2 id=[^>]*><i aria-hidden=[^>]*>\{icon\}<\/i>/;
  assert.match(memory, badge);
  assert.match(persona, badge);
  assert.equal(primaryActions(memory), 2, 'memory dialog marks both save and edit as primary');
  assert.equal(primaryActions(persona), 1, 'persona dialog marks save as primary');
});

test('trigger tooltips stay opaque instead of fading through the button behind them', () => {
  for (const css of [moduleCss, skillCss]) {
    assert.match(css, /\.trigger::after \{[\s\S]*?transition: visibility \.15s ease;/);
    assert.doesNotMatch(css, /\.trigger::after \{[\s\S]*?transition: opacity/);
  }
});
