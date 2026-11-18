/** Recognizes passive UTF-8 SVG images. The storage adapter still parses them with sharp. */
export function isSvgImageBytes(bytes: Uint8Array) {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trimStart();
  } catch {
    return false;
  }
  const root = source
    .replace(/^<\?xml\s[\s\S]*?\?>\s*/, "")
    .replace(/^(?:<!--[\s\S]*?-->\s*)*/, "");
  if (!/^<svg(?:\s|\/?>)/.test(root)) return false;
  // Do not archive executable documents or expand external XML entities.
  return !/<!DOCTYPE|<!ENTITY|<\?(?!xml\s)|<\s*(?:[\w.-]+:)?(?:script|foreignObject|iframe|object|embed)\b|\s(?:[\w.-]+:)?on[\w.-]+\s*=/i.test(source);
}
