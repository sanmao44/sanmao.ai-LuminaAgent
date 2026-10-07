/**
 * Normalize model-provided tool arguments at the application boundary.
 *
 * Providers occasionally omit arguments or return malformed JSON. Tool
 * execution treats both cases as an empty argument object so one bad call
 * cannot abort the rest of the turn.
 */
export function parseToolArguments(value: unknown): unknown {
  try {
    return JSON.parse(String(value || '{}'));
  } catch {
    return {};
  }
}
