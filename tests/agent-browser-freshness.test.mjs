import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBrowserFreshnessModule } from './tools-build.mjs';

const { browserMutationObservationGap, browserToolName, isBrowserMutationTool, isBrowserObservationTool } = await buildBrowserFreshnessModule();

test('browser freshness separates observations from page mutations', () => {
  assert.equal(isBrowserObservationTool('browser_snapshot'), true);
  assert.equal(isBrowserObservationTool('browser_click'), false);
  assert.equal(isBrowserMutationTool('browser_click'), true);
  assert.equal(isBrowserMutationTool('browser_snapshot'), false);
  assert.equal(browserToolName('playwright__browser_click'), 'browser_click');
});

test('browser completion requires a fresh successful page observation after the last mutation attempt', () => {
  assert.equal(browserMutationObservationGap([{ name: 'browser_click', ok: true }]), true);
  assert.equal(browserMutationObservationGap([{ name: 'browser_snapshot', ok: true }]), false, 'read-only requests remain unaffected');
  assert.equal(browserMutationObservationGap([
    { name: 'browser_snapshot', ok: true },
    { name: 'browser_click', ok: true },
  ]), true, 'an earlier snapshot cannot verify a later action');
  assert.equal(browserMutationObservationGap([
    { name: 'browser_click', ok: true },
    { name: 'browser_snapshot', ok: true },
  ]), false);
  assert.equal(browserMutationObservationGap([
    { name: 'browser_click', ok: true },
    { name: 'browser_snapshot', ok: true },
    { name: 'browser_type', ok: false },
  ]), true, 'a failed action can still have taken effect');
});

test('only current page observations clear the mutation gap', () => {
  assert.equal(browserMutationObservationGap([
    { name: 'browser_click', ok: true },
    { name: 'browser_network_requests', ok: true },
  ]), true, 'network diagnostics do not show the rendered page');
  assert.equal(browserMutationObservationGap([
    { name: 'playwright__browser_click', ok: true },
    { name: 'playwright__browser_take_screenshot', ok: true },
  ]), false, 'a current screenshot is a valid page observation');
  assert.equal(browserMutationObservationGap([
    { name: 'browser_click', ok: true },
    { name: 'browser_find', ok: false },
  ]), true, 'failed observations cannot close the gap');
  assert.equal(browserMutationObservationGap([
    { name: 'tabbit_browser', ok: true, args: { action: 'nodejs', readOnly: false } },
  ]), true, 'Tabbit write scripts require a follow-up page observation');
  assert.equal(browserMutationObservationGap([
    { name: 'tabbit_browser', ok: true, args: { action: 'nodejs', readOnly: false } },
    { name: 'tabbit_browser', ok: true, args: { action: 'nodejs', readOnly: true } },
  ]), false, 'a successful read-only Tabbit script observes the page');
  assert.equal(browserMutationObservationGap([
    { name: 'tabbit_browser', ok: true, args: { action: 'nodejs', readOnly: true } },
    { name: 'tabbit_browser', ok: false, args: { action: 'nodejs', readOnly: false } },
  ]), true, 'an earlier Tabbit read cannot verify a later write');
  assert.equal(browserMutationObservationGap([
    { name: 'tabbit_browser', ok: true, args: { action: 'tabs', readOnly: true } },
  ]), false, 'Tabbit session management is not a page mutation');
});
