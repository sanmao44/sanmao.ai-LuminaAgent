const BROWSER_OBSERVATION_TOOLS = new Set([
  'browser_console_messages',
  'browser_find',
  'browser_network_request',
  'browser_network_requests',
  'browser_snapshot',
  'browser_tabs',
  'browser_take_screenshot',
  'browser_wait_for',
]);

export function isBrowserObservationTool(toolName: unknown) {
  return BROWSER_OBSERVATION_TOOLS.has(String(toolName || ''));
}

/**
 * A browser mutation can invalidate refs or change the visible page, even when
 * the underlying tool is normally considered low risk (for example hover or resize).
 */
export function isBrowserMutationTool(toolName: unknown) {
  const name = String(toolName || '');
  return name.startsWith('browser_') && !isBrowserObservationTool(name);
}

export function browserToolName(toolName: unknown) {
  const name = String(toolName || '');
  return name.split('__').at(-1) || name;
}
