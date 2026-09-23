export type CanvasTextMeasure = (value: string, fontSize: number) => number;

const DEFAULT_LINE_HEIGHT = 1.35;

function isCjk(value: string) {
  return /[\u1100-\u11ff\u2e80-\u9fff\uf900-\ufaff]/u.test(value);
}

/**
 * A deterministic fallback metric for the FFmpeg renderer.  It intentionally
 * uses the same broad proportions as the browser's system UI font so layout
 * decisions remain stable when no canvas text measurement is available.
 */
export function estimateCanvasTextWidth(value: string, fontSize: number) {
  return [...String(value)].reduce((total, character) => {
    if (/\s/u.test(character)) return total + fontSize * 0.35;
    if (isCjk(character)) return total + fontSize;
    if (/[\u{1f000}-\u{1ffff}]/u.test(character)) return total + fontSize;
    return total + fontSize * 0.56;
  }, 0);
}

export function wrapCanvasText(
  value: string,
  maxWidth: number,
  measure: CanvasTextMeasure = estimateCanvasTextWidth,
  fontSize = 1,
) {
  const safeWidth = Math.max(1, Number(maxWidth) || 1);
  const paragraphs = String(value || '').replace(/\r\n?/gu, '\n').split('\n');
  return paragraphs.flatMap((paragraph) => {
    if (!paragraph) return [''];
    const lines: string[] = [];
    let line = '';
    for (const character of [...paragraph]) {
      const candidate = line + character;
      if (line && measure(candidate, fontSize) > safeWidth) {
        lines.push(line);
        line = character;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines;
  });
}

export type FittedCanvasText = {
  fontSize: number;
  lines: string[];
  lineHeight: number;
  width: number;
  height: number;
};

/** Fit text into a normalized overlay box without allowing glyphs to escape it. */
export function fitCanvasText(options: {
  text: string;
  fontSize: number;
  maxWidth: number;
  maxHeight?: number;
  minFontSize?: number;
  measure?: CanvasTextMeasure;
}): FittedCanvasText {
  const measure = options.measure || estimateCanvasTextWidth;
  const minFontSize = Math.max(8, Number(options.minFontSize) || 12);
  let fontSize = Math.max(minFontSize, Number(options.fontSize) || minFontSize);
  const maxWidth = Math.max(1, Number(options.maxWidth) || 1);
  const maxHeight = Number.isFinite(options.maxHeight) && (options.maxHeight as number) > 0
    ? options.maxHeight as number
    : Number.POSITIVE_INFINITY;
  let lines = wrapCanvasText(options.text, maxWidth, measure, fontSize);
  while (fontSize > minFontSize) {
    const width = Math.max(...lines.map((line) => measure(line, fontSize)), 0);
    const lineHeight = fontSize * DEFAULT_LINE_HEIGHT;
    const height = lines.length * lineHeight;
    if (width <= maxWidth && height <= maxHeight) break;
    fontSize -= 1;
    lines = wrapCanvasText(options.text, maxWidth, measure, fontSize);
  }
  if (Number.isFinite(maxHeight) && lines.length * fontSize * DEFAULT_LINE_HEIGHT > maxHeight) {
    const maxLines = Math.max(1, Math.floor(maxHeight / (fontSize * DEFAULT_LINE_HEIGHT)));
    lines = lines.slice(0, maxLines);
    const last = lines.length - 1;
    if (last >= 0 && lines.length < wrapCanvasText(options.text, maxWidth, measure, fontSize).length) {
      let value = `${lines[last].replace(/[……]$/u, '')}…`;
      while (value.length > 1 && measure(value, fontSize) > maxWidth) value = `${value.slice(0, -2)}…`;
      lines[last] = value;
    }
  }
  const width = Math.min(maxWidth, Math.max(...lines.map((line) => measure(line, fontSize)), 0));
  const lineHeight = fontSize * DEFAULT_LINE_HEIGHT;
  return { fontSize, lines, lineHeight, width, height: lines.length * lineHeight };
}
