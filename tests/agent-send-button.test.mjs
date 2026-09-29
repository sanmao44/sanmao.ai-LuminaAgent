import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const button = await readFile(new URL('../components/AgentSendButton.tsx', import.meta.url), 'utf8');

test('Agent send button keeps validation and dispatch at the page boundary', () => {
  assert.match(page, /disabled: activeAgentBusy \? false/);
  assert.match(page, /onSend: \(\)=>void sendAgent\(\)/);
  assert.match(page, /onStop: \(\)=>void stopAgent\(\)/);
  assert.match(button, /aria-label=\{busy \? '停止当前回答' : '发送'\}/);
});
