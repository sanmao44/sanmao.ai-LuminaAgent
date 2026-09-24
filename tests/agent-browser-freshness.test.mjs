import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBrowserFreshnessModule } from './tools-build.mjs';

const { browserToolName, isBrowserMutationTool, isBrowserObservationTool } = await buildBrowserFreshnessModule();

test('browser freshness separates observations from page mutations', () => {
  assert.equal(isBrowserObservationTool('browser_snapshot'), true);
  assert.equal(isBrowserObservationTool('browser_click'), false);
  assert.equal(isBrowserMutationTool('browser_click'), true);
  assert.equal(isBrowserMutationTool('browser_snapshot'), false);
  assert.equal(browserToolName('playwright__browser_click'), 'browser_click');
});
