export type ShareTextMeasure = (value: string, fontSize?: number) => number;

export type SharePromptPlan = {
  prompt: string;
  columns: string[][];
  columnCount: number;
  columnWidth: number;
  columnGap: number;
  fontSize: number;
  lineHeight: number;
  paragraphGap: number;
  textHeight: number;
  cardHeight: number;
  overflow: boolean;
};

export type ShareImageLayout = {
  canvasWidth: number;
  canvasHeight: number;
  padding: number;
  contentWidth: number;
  headerHeight: number;
  resultFrame: { x: number; y: number; width: number; height: number };
  resultContent: { x: number; y: number; width: number; height: number };
  promptFrame: { x: number; y: number; width: number; height: number };
  referenceHeadingY: number;
  referenceTilesY: number;
  referenceTileWidth: number;
  referenceTileHeight: number;
  referenceTileGap: number;
  referenceColumns: number;
  referenceRows: number;
  referenceBottomY: number;
  footerY: number;
  footerHeight: number;
  footerQrSize: number;
  overflow: boolean;
};

const DEFAULT_CANVAS_WIDTH = 1400;
const DEFAULT_PADDING = 56;
const HEADER_HEIGHT = 132;
const RESULT_FRAME_GAP = 48;
const RESULT_MAX_HEIGHT = 980;
const PROMPT_COLUMN_GAP = 24;
const PROMPT_SINGLE_COLUMN_MAX_HEIGHT = 760;
const PROMPT_MAX_HEIGHT = 24_000;
const REFERENCE_TILE_WIDTH = 196;
const REFERENCE_TILE_HEIGHT = 190;
const REFERENCE_TILE_GAP = 16;
const MAX_REFERENCE_COLUMNS = 6;
const FOOTER_HEIGHT = 238;
const FOOTER_QR_SIZE = 164;
const MAX_CANVAS_HEIGHT = 30_000;

const PROMPT_STYLES = [
  { columns: 1, fontSize: 22, lineHeight: 34, paragraphGap: 14 },
  { columns: 1, fontSize: 20, lineHeight: 31, paragraphGap: 12 },
  { columns: 2, fontSize: 21, lineHeight: 32, paragraphGap: 12 },
  { columns: 2, fontSize: 19, lineHeight: 29, paragraphGap: 11 },
  { columns: 3, fontSize: 19, lineHeight: 29, paragraphGap: 11 },
  { columns: 3, fontSize: 17, lineHeight: 26, paragraphGap: 9 },
  { columns: 4, fontSize: 17, lineHeight: 26, paragraphGap: 9 },
  { columns: 4, fontSize: 15, lineHeight: 23, paragraphGap: 8 },
  { columns: 4, fontSize: 14, lineHeight: 21, paragraphGap: 7 },
];

function normalizePrompt(value: unknown) {
  return String(value || '').replace(/\r\n?/g, '\n').trim();
}

function wrapParagraph(value: string, measureText: ShareTextMeasure, maxWidth: number, fontSize?: number) {
  if (!value) return [''];
  const output: string[] = [];
  let line = '';
  for (const character of Array.from(value)) {
    const candidate = `${line}${character}`;
    if (!line || measureText(candidate, fontSize) <= maxWidth) {
      line = candidate;
      continue;
    }
    const breakAt = Math.max(line.lastIndexOf(' '), line.lastIndexOf('\t'));
    if (breakAt > 0) {
      const completed = line.slice(0, breakAt).trimEnd();
      if (completed) output.push(completed);
      line = `${line.slice(breakAt + 1).trimStart()}${character}`;
    } else {
      output.push(line.trimEnd());
      line = character.trimStart();
    }
  }
  if (line || !output.length) output.push(line.trimEnd());
  return output;
}

export function wrapSharePrompt(value: unknown, measureText: ShareTextMeasure, maxWidth: number, fontSize?: number) {
  const prompt = normalizePrompt(value);
  if (!prompt) return [''];
  return prompt.split('\n').flatMap((paragraph) => paragraph.trim() ? wrapParagraph(paragraph, measureText, maxWidth, fontSize) : ['']);
}

function splitColumns(lines: string[], columnCount: number) {
  const rowsPerColumn = Math.max(1, Math.ceil(lines.length / columnCount));
  return Array.from({ length: columnCount }, (_, index) => lines.slice(index * rowsPerColumn, (index + 1) * rowsPerColumn)).filter((column) => column.length);
}

function columnHeight(lines: string[], lineHeight: number, paragraphGap: number) {
  return lines.reduce((total, line) => total + lineHeight + (line ? 0 : paragraphGap), 0);
}

export function buildSharePromptPlan(value: unknown, measureText: ShareTextMeasure, maxWidth: number, options: { maxHeight?: number; columnGap?: number } = {}): SharePromptPlan {
  const prompt = normalizePrompt(value);
  const columnGap = options.columnGap ?? PROMPT_COLUMN_GAP;
  const maxHeight = options.maxHeight ?? PROMPT_MAX_HEIGHT;
  let lastPlan: SharePromptPlan | null = null;
  for (const style of PROMPT_STYLES) {
    const columnWidth = Math.max(80, (maxWidth - (style.columns - 1) * columnGap) / style.columns);
    const lines = wrapSharePrompt(prompt, measureText, columnWidth, style.fontSize);
    const columns = splitColumns(lines, style.columns);
    const textHeight = Math.max(...columns.map((column) => columnHeight(column, style.lineHeight, style.paragraphGap)), style.lineHeight);
    const cardHeight = 28 + 30 + 16 + textHeight + 28;
    const plan: SharePromptPlan = {
      prompt,
      columns,
      columnCount: columns.length,
      columnWidth,
      columnGap,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      paragraphGap: style.paragraphGap,
      textHeight,
      cardHeight,
      overflow: cardHeight > maxHeight,
    };
    lastPlan = plan;
    if ((style.columns > 1 || textHeight <= PROMPT_SINGLE_COLUMN_MAX_HEIGHT) && cardHeight <= maxHeight) return plan;
  }
  return lastPlan || {
    prompt,
    columns: [[prompt]],
    columnCount: 1,
    columnWidth: maxWidth,
    columnGap,
    fontSize: 14,
    lineHeight: 21,
    paragraphGap: 7,
    textHeight: 21,
    cardHeight: 123,
    overflow: true,
  };
}

export function buildShareImageLayout(options: {
  resultWidth: number;
  resultHeight: number;
  promptPlan: SharePromptPlan;
  referenceCount: number;
  canvasWidth?: number;
  padding?: number;
}): ShareImageLayout {
  const canvasWidth = options.canvasWidth ?? DEFAULT_CANVAS_WIDTH;
  const padding = options.padding ?? DEFAULT_PADDING;
  const contentWidth = Math.max(320, canvasWidth - padding * 2);
  const resultWidth = Math.max(1, options.resultWidth || 1);
  const resultHeight = Math.max(1, options.resultHeight || 1);
  const contentMaxWidth = Math.max(120, contentWidth - RESULT_FRAME_GAP);
  const contentMaxHeight = Math.max(120, RESULT_MAX_HEIGHT - RESULT_FRAME_GAP);
  const scale = Math.min(contentMaxWidth / resultWidth, contentMaxHeight / resultHeight);
  const resultContent = {
    x: 0,
    y: 0,
    width: Math.max(1, Math.round(resultWidth * scale)),
    height: Math.max(1, Math.round(resultHeight * scale)),
  };
  const resultFrame = {
    x: Math.round((canvasWidth - resultContent.width - RESULT_FRAME_GAP) / 2),
    y: HEADER_HEIGHT,
    width: resultContent.width + RESULT_FRAME_GAP,
    height: resultContent.height + RESULT_FRAME_GAP,
  };
  resultContent.x = resultFrame.x + RESULT_FRAME_GAP / 2;
  resultContent.y = resultFrame.y + RESULT_FRAME_GAP / 2;
  const promptFrame = {
    x: padding,
    y: resultFrame.y + resultFrame.height + 36,
    width: contentWidth,
    height: options.promptPlan.cardHeight,
  };
  const referenceColumns = Math.min(MAX_REFERENCE_COLUMNS, Math.max(1, options.referenceCount));
  const referenceRows = Math.ceil(Math.max(0, options.referenceCount) / referenceColumns);
  const referenceHeadingY = promptFrame.y + promptFrame.height + 48;
  const referenceTilesY = referenceHeadingY + 36;
  const referenceBottomY = referenceTilesY + (referenceRows ? referenceRows * REFERENCE_TILE_HEIGHT + Math.max(0, referenceRows - 1) * REFERENCE_TILE_GAP : 0);
  const footerY = referenceBottomY + 56;
  const canvasHeight = footerY + FOOTER_HEIGHT + padding;
  return {
    canvasWidth,
    canvasHeight,
    padding,
    contentWidth,
    headerHeight: HEADER_HEIGHT,
    resultFrame,
    resultContent,
    promptFrame,
    referenceHeadingY,
    referenceTilesY,
    referenceTileWidth: REFERENCE_TILE_WIDTH,
    referenceTileHeight: REFERENCE_TILE_HEIGHT,
    referenceTileGap: REFERENCE_TILE_GAP,
    referenceColumns,
    referenceRows,
    referenceBottomY,
    footerY,
    footerHeight: FOOTER_HEIGHT,
    footerQrSize: FOOTER_QR_SIZE,
    overflow: canvasHeight > MAX_CANVAS_HEIGHT || options.promptPlan.overflow,
  };
}
