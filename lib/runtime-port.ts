export const DEFAULT_SANMAO_PORT = 3210;

// 3210..3220 was the old automatic allocation range. Keep accepting it as an
// input during restart/update handoff, but collapse it to one browser origin.
export const LEGACY_AUTOMATIC_PORT_START = 3210;
export const LEGACY_AUTOMATIC_PORT_END = 3220;

export function normalizeRuntimeOperationPort(port: number) {
  if (!Number.isInteger(port) || port < 1024 || port > 65525) return DEFAULT_SANMAO_PORT;
  if (port >= LEGACY_AUTOMATIC_PORT_START && port <= LEGACY_AUTOMATIC_PORT_END) return DEFAULT_SANMAO_PORT;
  return port;
}
