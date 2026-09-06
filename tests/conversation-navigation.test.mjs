import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const [page, styles] = await Promise.all([
  readFile(new URL('app/page.tsx', root), 'utf8'),
  readFile(new URL('app/globals.css', root), 'utf8'),
]);

test('jumping to the conversation bottom closes the conversation navigator', () => {
  const closeIndex = page.indexOf('function closeConversationNavigator()');
  const followIndex = page.indexOf('function followChatToEnd()');

  assert.ok(closeIndex >= 0);
  assert.ok(closeIndex > followIndex);
  assert.match(page.slice(followIndex, followIndex + 260), /closeConversationNavigator\(\)/);
  assert.match(page, /className: "conversation-nav-bottom"[\s\S]*?onPointerDown: closeConversationNavigator[\s\S]*?onClick: followChatToEnd/);
});

test('bottom navigation hover still suppresses the conversation popover', () => {
  assert.match(
    styles,
    /\.conversation-navigator:has\(\.conversation-nav-bottom:hover\) \.conversation-nav-popover,\.conversation-navigator:has\(\.conversation-nav-bottom:focus-visible\) \.conversation-nav-popover\{opacity:0;visibility:hidden;pointer-events:none\}/,
  );
});
