/**
 * 交付物的排版测量。
 *
 * Office 渲染器（PowerPoint / WPS / Word）对中文长句的断行规则并不一致：把换行交给
 * 渲染器时，`lang="en-US"` 的中文整句会被当成一个“单词”，直接冲出文本框。这里先用
 * 字符宽度模型把文字排好，再写进文件，保证在任何渲染器里都不会跑框。
 */

/** 全角字符（中文、日文、韩文、全角标点）按 1em 计算。 */
const FULLWIDTH = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;
/** 行内不能随便断开的英文/数字串（URL、单词、数字）保留整块处理，超长时再硬切。 */
const ASCII_WORD = /[0-9A-Za-z@#$%&*+._\-/\\:;$=?!()[\]{}<>"']/;
/** 估算偏保守：渲染器实际字宽通常小于这里，宁可少排几个字也不要跑框。 */
const SAFETY = 0.97;

export function isFullwidth(char: string) {
  return FULLWIDTH.test(char);
}

/**
 * 常见无衬线字体（微软雅黑、Calibri 一类）的拉丁字符宽度，单位 em。
 * 只按「大写 / 小写」分档会让 Microsoft、URL 这类文本偏差超过 15%，表格列宽会因此算错。
 */
const LATIN_WIDTHS: Record<string, number> = {
  A: 0.66, B: 0.65, C: 0.66, D: 0.68, E: 0.60, F: 0.55, G: 0.76, H: 0.72, I: 0.30, J: 0.55,
  K: 0.66, L: 0.55, M: 0.86, N: 0.72, O: 0.74, P: 0.61, Q: 0.76, R: 0.65, S: 0.62, T: 0.65,
  U: 0.70, V: 0.68, W: 0.86, X: 0.63, Y: 0.65, Z: 0.62,
  a: 0.53, b: 0.55, c: 0.47, d: 0.55, e: 0.52, f: 0.32, g: 0.55, h: 0.54, i: 0.24, j: 0.24,
  k: 0.51, l: 0.24, m: 0.80, n: 0.54, o: 0.55, p: 0.55, q: 0.55, r: 0.36, s: 0.47, t: 0.33,
  u: 0.54, v: 0.50, w: 0.72, x: 0.50, y: 0.50, z: 0.47,
  '0': 0.56, '1': 0.56, '2': 0.56, '3': 0.56, '4': 0.56,
  '5': 0.56, '6': 0.56, '7': 0.56, '8': 0.56, '9': 0.56,
  '.': 0.28, ',': 0.28, ':': 0.28, ';': 0.28, '!': 0.28, '|': 0.26, "'": 0.21, '"': 0.42,
  '/': 0.36, '\\': 0.36, '-': 0.36, '_': 0.50, '(': 0.33, ')': 0.33, '[': 0.33, ']': 0.33,
  '{': 0.35, '}': 0.35, '<': 0.60, '>': 0.60, '=': 0.60, '+': 0.60, '*': 0.40, '?': 0.50,
  '#': 0.55, '%': 0.90, '&': 0.70, '@': 0.90, '$': 0.55, '^': 0.55, '~': 0.55, '`': 0.30,
};

export function charWidthEm(char: string) {
  if (!char) return 0;
  if (char === ' ') return 0.30;
  if (isFullwidth(char)) return 1;
  const latin = LATIN_WIDTHS[char];
  if (latin !== undefined) return latin;
  if (ASCII_WORD.test(char)) return 0.45;
  return 1;
}

export function textWidthEm(text: string) {
  let width = 0;
  for (const char of String(text ?? '')) width += charWidthEm(char);
  return width;
}

function tokenize(text: string) {
  const tokens: string[] = [];
  let word = '';
  const flush = () => {
    if (word) {
      tokens.push(word);
      word = '';
    }
  };
  for (const char of text) {
    if (char === ' ') {
      flush();
      tokens.push(' ');
      continue;
    }
    if (isFullwidth(char)) {
      flush();
      tokens.push(char);
      continue;
    }
    word += char;
  }
  flush();
  return tokens;
}

/**
 * 按可用宽度（em）贪心断行。全角字符可任意断行，拉丁词保持完整，超长 URL 才硬切。
 */
export function wrapText(text: string, maxWidthEm: number): string[] {
  const width = Math.max(1, Number(maxWidthEm) || 1) * SAFETY;
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [''];
  const lines: string[] = [];
  let line = '';
  let lineWidth = 0;
  const flushLine = () => {
    lines.push(line.replace(/\s+$/, ''));
    line = '';
    lineWidth = 0;
  };
  for (const token of tokenize(normalized)) {
    if (token === ' ') {
      if (line && lineWidth + 0.30 <= width) {
        line += ' ';
        lineWidth += 0.30;
      }
      continue;
    }
    const tokenWidth = textWidthEm(token);
    if (lineWidth + tokenWidth <= width) {
      line += token;
      lineWidth += tokenWidth;
      continue;
    }
    if (line) flushLine();
    if (tokenWidth <= width) {
      line = token;
      lineWidth = tokenWidth;
      continue;
    }
    for (const char of token) {
      const charWidth = charWidthEm(char);
      if (line && lineWidth + charWidth > width) flushLine();
      line += char;
      lineWidth += charWidth;
    }
  }
  if (line) flushLine();
  return lines.length ? lines : [''];
}

/** 文本框内可容纳的 em 宽度。 */
export function emWidthFor(boxWidthIn: number, fontSizePt: number) {
  const points = Math.max(1, Number(boxWidthIn) || 0) * 72;
  return points / Math.max(1, Number(fontSizePt) || 1);
}

/** 给定文本框宽度和字号时，文字会被排成几行。 */
export function countLines(text: string, boxWidthIn: number, fontSizePt: number) {
  return wrapText(text, emWidthFor(boxWidthIn, fontSizePt)).length;
}

/** 直接把文字排成带显式换行的字符串（\n 在各渲染器里都是硬换行）。 */
export function wrapToLines(text: string, boxWidthIn: number, fontSizePt: number) {
  return wrapText(text, emWidthFor(boxWidthIn, fontSizePt)).join('\n');
}

/** Excel 列宽单位：一个半角字符约 1 个单位，全角约 2 个。 */
export function spreadsheetWidth(text: string) {
  let width = 0;
  for (const char of String(text ?? '')) width += isFullwidth(char) ? 2 : 1;
  return width;
}
