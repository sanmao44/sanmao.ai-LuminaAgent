import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const control = await readFile(new URL('../components/AgentWebModeControl.tsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');

test('Agent web mode control keeps the three preference choices and page-owned persistence', () => {
  assert.match(page, /import AgentWebModeControl from '@\/components\/AgentWebModeControl';/);
  assert.match(page, /setAgentWebModePreference\(mode\)/);
  assert.match(control, /type AgentWebMode = 'auto' \| 'always' \| 'off'/);
  assert.match(control, /role="menuitemradio"/);
  assert.match(control, /agent-native-search-hint/);
  assert.match(page, /setAgentWebMode\('off'\)/);
  assert.match(page, /localStorage\.setItem\('sanmao-agent-web-mode', 'off'\)/);
  assert.match(styles, /\.agent-web-mode-trigger\{min-width:112px;flex:none;white-space:nowrap\}/);
  assert.match(styles, /\.composer-left:has\(\.agent-web-mode-menu\)\{overflow:visible\}/);
});
