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

const BROWSER_PAGE_OBSERVATION_TOOLS = new Set([
  'browser_find',
  'browser_snapshot',
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

/**
 * A final page-changing action needs a fresh view before the Agent can report
 * completion. Failed actions count too because timeouts can happen after the
 * page has already changed. Diagnostic observations such as network logs do
 * not show the current rendered page state.
 */
export function browserMutationObservationGap(uses: readonly { name?: unknown; ok?: unknown; args?: Record<string, unknown> }[]) {
  let lastMutationIndex = -1;
  let lastPageObservationIndex = -1;

  uses.forEach((use, index) => {
    const name = browserToolName(use.name);
    if (name === 'tabbit_browser') {
      if (use.args?.action !== 'nodejs') return;
      if (use.args.readOnly === true) {
        if (use.ok === true) lastPageObservationIndex = index;
      } else {
        lastMutationIndex = index;
      }
      return;
    }
    if (isBrowserMutationTool(name)) {
      lastMutationIndex = index;
      return;
    }
    if (use.ok === true && BROWSER_PAGE_OBSERVATION_TOOLS.has(name)) lastPageObservationIndex = index;
  });

  return lastMutationIndex >= 0 && lastMutationIndex > lastPageObservationIndex;
}

export function browserToolName(toolName: unknown) {
  const name = String(toolName || '');
  return name.split('__').at(-1) || name;
}
