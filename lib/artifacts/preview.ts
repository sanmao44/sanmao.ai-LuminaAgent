import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { strFromU8, unzipSync } from 'fflate';
import {
  PREVIEW_MAX_BLOCKS,
  PREVIEW_MAX_BYTES,
  PREVIEW_MAX_CHARTS,
  PREVIEW_MAX_COLUMNS,
  PREVIEW_MAX_IMAGE_BYTES,
  PREVIEW_MAX_IMAGE_TOTAL_BYTES,
  PREVIEW_MAX_IMAGES,
  PREVIEW_MAX_ROWS,
  PREVIEW_MAX_SHEETS,
} from './limits';
import { isValidArtifactId } from './sanitize';
import { artifactStore, type ArtifactStore } from './storage';
import type { ArtifactKind } from './types';

export type ArtifactPreviewOptions = { theme?: string };

const TRUNCATED_NOTE = '内容较多，预览已截断；下载后可查看完整内容。';
const EMPTY_NOTE = '这个文件里没有可预览的文字内容。';

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/** Word 段落里 <w:tab/> / <w:br/> 是排版语义，直接去标签会把它们丢掉。 */
function wordRunText(part: string) {
  return decodeXml(part.replace(/<w:tab\b[^>]*\/>/g, '\t').replace(/<w:br\b[^>]*\/>/g, '\n').replace(/<[^>]+>/g, ''));
}

function readPart(entries: Record<string, Uint8Array>, name: string) {
  const entry = entries[name];
  return entry ? strFromU8(entry) : null;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
};

/** 预览内联媒体的预算：张数、单张体积、总体积任一超限就跳过并记一次说明。 */
type PreviewMediaBudget = { images: number; bytes: number; skipped: number };

/** 把包内相对目标（media/x.png、../media/x.png）解析成 zip 内的绝对路径。 */
function resolvePartTarget(dir: string, target: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  const segments = `${target.startsWith('/') ? '' : dir}${target.replace(/^\/+/, '')}`.split('/');
  const parts: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.length ? parts.join('/') : null;
}

/** r:embed="rId3" 这类引用只有查过同名 rels 才知道指向哪个部件。 */
function partRelationships(entries: Record<string, Uint8Array>, partPath: string) {
  const split = partPath.lastIndexOf('/');
  const dir = split >= 0 ? partPath.slice(0, split + 1) : '';
  const xml = readPart(entries, `${dir}_rels/${partPath.slice(split + 1)}.rels`);
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const tag of xml.match(/<Relationship\b[^>]*>/g) || []) {
    if (/TargetMode="External"/i.test(tag)) continue;
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    if (!id || !target) continue;
    const resolved = resolvePartTarget(dir, decodeXml(target));
    if (resolved) map.set(id, resolved);
  }
  return map;
}

function embeddedImageIds(xml: string) {
  const ids: string[] = [];
  for (const tag of xml.match(/<a:blip\b[^>]*r:embed="[^"]+"/g) || []) {
    const id = /r:embed="([^"]+)"/.exec(tag)?.[1];
    if (id) ids.push(id);
  }
  return ids;
}

function imageDataUri(entries: Record<string, Uint8Array>, path: string, budget: PreviewMediaBudget) {
  const bytes = entries[path];
  // EMF/WMF 这类矢量图浏览器不认，直接跳过，避免预览里出现裂图。
  const mime = IMAGE_MIME[path.slice(path.lastIndexOf('.') + 1).toLowerCase()];
  if (!bytes || !bytes.length || !mime) return null;
  if (bytes.length > PREVIEW_MAX_IMAGE_BYTES
    || budget.images >= PREVIEW_MAX_IMAGES
    || budget.bytes + bytes.length > PREVIEW_MAX_IMAGE_TOTAL_BYTES) {
    budget.skipped += 1;
    return null;
  }
  budget.images += 1;
  budget.bytes += bytes.length;
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

const PREVIEW_STYLE = `
:root { color-scheme: light dark; --bg:#ffffff; --panel:#f7f8fb; --fg:#1f2937; --muted:#6b7280; --line:#e2e6ef; --head:#f1f4fa; }
.theme-dark { --bg:#0f172a; --panel:#151f33; --fg:#e5e9f2; --muted:#9aa5b8; --line:#26314a; --head:#1b2437; }
@media (prefers-color-scheme: dark) { .theme-auto { --bg:#0f172a; --panel:#151f33; --fg:#e5e9f2; --muted:#9aa5b8; --line:#26314a; --head:#1b2437; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.65 "微软雅黑", system-ui, -apple-system, "Segoe UI", sans-serif; }
.preview { padding:18px 20px 26px; }
h1,h2,h3,h4,h5,h6 { line-height:1.35; margin:20px 0 10px; }
h1 { font-size:22px; }
h2 { font-size:19px; }
h3 { font-size:17px; }
h4,h5,h6 { font-size:15px; }
p { margin:8px 0; white-space:pre-wrap; word-break:break-word; }
ul { margin:8px 0 0; padding-left:20px; }
li { margin:2px 0; white-space:pre-wrap; word-break:break-word; }
table { border-collapse:collapse; width:100%; font-size:13px; }
th,td { border:1px solid var(--line); padding:6px 9px; text-align:left; vertical-align:top; white-space:pre-wrap; word-break:break-word; }
th { background:var(--head); font-weight:600; }
td.num { text-align:right; font-variant-numeric:tabular-nums; }
figure { margin:12px 0; }
.doc-figure img { display:block; max-width:100%; height:auto; border:1px solid var(--line); border-radius:8px; background:var(--panel); }
.slide-media { display:flex; flex-wrap:wrap; gap:10px; margin-top:10px; }
.slide-media img { max-width:100%; max-height:260px; border:1px solid var(--line); border-radius:8px; background:var(--bg); }
.chart-title { font-size:14px; margin:10px 0 6px; }
.chart-table { margin:8px 0; }
.sheet-title { font-size:15px; font-weight:600; margin:18px 0 8px; }
.meta { color:var(--muted); font-size:12px; margin:6px 0 12px; }
.note { margin-top:16px; padding:8px 12px; border:1px dashed var(--line); border-radius:8px; color:var(--muted); font-size:12px; }
.slide { border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin:0 0 14px; background:var(--panel); }
.slide-index { color:var(--muted); font-size:12px; margin-bottom:6px; }
.slide-title { font-size:16px; font-weight:700; margin:0 0 8px; }
.empty { color:var(--muted); padding:26px 4px; }
`;

function previewShell(options: { title: string; theme: string; body: string }) {
  const themeClass = options.theme === 'dark' ? 'theme-dark' : options.theme === 'light' ? 'theme-light' : 'theme-auto';
  return `<!doctype html>
<html lang="zh-CN" class="${themeClass}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(options.title)}</title>
<style>${PREVIEW_STYLE}</style>
</head>
<body>
<main class="preview">${options.body}</main>
</body>
</html>`;
}

function noteBlock(text: string) {
  return `<p class="note">${escapeHtml(text)}</p>`;
}

function emptyBlock() {
  return `<p class="empty">${escapeHtml(EMPTY_NOTE)}</p>`;
}

type SpreadsheetCellStyle = { background: string; bold: boolean; color: string; barColor: string; barRatio: number };
type SpreadsheetCell = { text: string; numeric: boolean; style: SpreadsheetCellStyle };

function cellIsNumeric(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (typeof value === 'number') return true;
  if (value && typeof value === 'object' && typeof (value as { result?: unknown }).result === 'number') return true;
  return false;
}

function numericCellValue(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && typeof (value as { result?: unknown }).result === 'number') {
    return (value as { result: number }).result;
  }
  return null;
}

/** Excel 的颜色一律是 ARGB，预览只认 6 位十六进制（其余如主题色直接放弃）。 */
function argbToCss(value: unknown) {
  const argb = String((value as { argb?: string } | null | undefined)?.argb || '').replace(/^#/, '').toUpperCase();
  const hex = argb.length === 8 ? argb.slice(2) : argb.length === 6 ? argb : '';
  return hex && /^[0-9A-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : '';
}

/** 静态底纹与条件格式底纹一个读 fgColor、一个读 bgColor，这里统一取第一个有值的。 */
function fillBackground(fill: unknown) {
  const pattern = fill as { type?: string; pattern?: string; fgColor?: unknown; bgColor?: unknown } | null | undefined;
  if (!pattern || pattern.type !== 'pattern' || pattern.pattern === 'none') return '';
  return argbToCss(pattern.fgColor) || argbToCss(pattern.bgColor);
}

function columnIndex(letters: string) {
  let value = 0;
  for (const char of letters.toUpperCase()) value = value * 26 + (char.charCodeAt(0) - 64);
  return value;
}

/** 条件格式的 ref 可能是 A1:B5、E2:E11，也可能是单个单元格。 */
function parseCellRange(ref: string) {
  const match = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i.exec(String(ref || '').trim());
  if (!match) return null;
  return {
    firstColumn: columnIndex(match[1]),
    firstRow: Number(match[2]),
    lastColumn: columnIndex(match[3] || match[1]),
    lastRow: Number(match[4] || match[2]),
  };
}

type ConditionalRule = {
  type?: string;
  operator?: string;
  formulae?: unknown[];
  rank?: number;
  percent?: boolean;
  bottom?: boolean;
  aboveAverage?: boolean;
  cfvo?: Array<{ type?: string; value?: number }>;
  color?: unknown;
  style?: { fill?: unknown; font?: { bold?: boolean; color?: { argb?: string } } };
};

type ConditionalBlock = {
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
  rules: ConditionalRule[];
  values: number[];
  min: number;
  max: number;
  average: number;
};

/**
 * 条件格式本身不带缓存值（Excel 打开时才算），所以数值范围只能自己从区间里取，
 * 百分位、平均线这些规则才排得出阈值。
 */
function conditionalBlocks(sheet: ExcelJS.Worksheet) {
  const formattings = (sheet as unknown as { conditionalFormattings?: Array<{ ref?: string; rules?: ConditionalRule[] }> }).conditionalFormattings || [];
  const blocks: ConditionalBlock[] = [];
  for (const formatting of formattings) {
    const range = parseCellRange(formatting.ref || '');
    const rules = Array.isArray(formatting.rules) ? formatting.rules : [];
    if (!range || !rules.length) continue;
    const values: number[] = [];
    for (let rowIndex = range.firstRow; rowIndex <= range.lastRow; rowIndex += 1) {
      for (let index = range.firstColumn; index <= range.lastColumn; index += 1) {
        const value = numericCellValue(sheet.getRow(rowIndex).getCell(index));
        if (value !== null) values.push(value);
      }
    }
    if (!values.length) continue;
    const sorted = [...values].sort((left, right) => left - right);
    blocks.push({
      ...range,
      rules,
      values: sorted,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      average: values.reduce((sum, value) => sum + value, 0) / values.length,
    });
  }
  return blocks;
}

function quantile(sorted: number[], percent: number) {
  if (!sorted.length) return 0;
  const position = (percent / 100) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function mixHex(from: string, to: string, ratio: number) {
  const channels = (color: string) => [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16));
  const [red, green, blue] = channels(from);
  const [toRed, toGreen, toBlue] = channels(to);
  const mix = (left: number, right: number) => Math.round(left + (right - left) * ratio).toString(16).padStart(2, '0');
  return `#${mix(red, toRed)}${mix(green, toGreen)}${mix(blue, toBlue)}`;
}

function ruleApplies(rule: ConditionalRule, value: number | null, block: ConditionalBlock) {
  const type = String(rule.type || '');
  if (type === 'cellIs') {
    if (value === null) return false;
    const target = Number(rule.formulae?.[0]);
    if (!Number.isFinite(target)) return false;
    const upper = Number(rule.formulae?.[1]);
    switch (String(rule.operator || '')) {
      case 'lessThan': return value < target;
      case 'lessThanOrEqual': return value <= target;
      case 'greaterThan': return value > target;
      case 'greaterThanOrEqual': return value >= target;
      case 'equal': return value === target;
      case 'notEqual': return value !== target;
      case 'between': return value >= target && value <= upper;
      case 'notBetween': return value < target || value > upper;
      default: return false;
    }
  }
  if (type === 'top10') {
    if (value === null) return false;
    const rank = Number(rule.rank) || 10;
    const bottom = Boolean(rule.bottom);
    const count = Math.min(block.values.length, Math.max(1, rule.percent ? Math.round((block.values.length * rank) / 100) : rank));
    const threshold = bottom ? block.values[count - 1] : block.values[block.values.length - count];
    return bottom ? value <= threshold : value >= threshold;
  }
  if (type === 'aboveAverage') {
    if (value === null) return false;
    return rule.aboveAverage === false ? value <= block.average : value > block.average;
  }
  return false;
}

/** 色阶：按 cfvo 给出的位置把颜色插值到单元格数值上。 */
function scaleColor(rule: ConditionalRule, value: number | null, block: ConditionalBlock) {
  const colors = (Array.isArray(rule.color) ? rule.color : []).map((entry) => argbToCss(entry)).filter(Boolean);
  const stops = Array.isArray(rule.cfvo) ? rule.cfvo : [];
  if (value === null || colors.length < 2 || stops.length !== colors.length) return '';
  const points = stops.map((stop) => {
    if (stop?.type === 'percentile') return quantile(block.values, Number(stop.value) || 0);
    if (stop?.type === 'number') return Number(stop.value) || 0;
    return stop?.type === 'max' ? block.max : block.min;
  });
  if (value <= points[0]) return colors[0];
  if (value >= points[points.length - 1]) return colors[colors.length - 1];
  for (let index = 0; index < points.length - 1; index += 1) {
    if (value <= points[index + 1]) {
      const span = points[index + 1] - points[index];
      return mixHex(colors[index], colors[index + 1], span > 0 ? (value - points[index]) / span : 0);
    }
  }
  return colors[colors.length - 1];
}

function conditionalCellStyle(blocks: ConditionalBlock[], rowIndex: number, index: number, value: number | null) {
  const style: Partial<SpreadsheetCellStyle> = {};
  for (const block of blocks) {
    if (rowIndex < block.firstRow || rowIndex > block.lastRow || index < block.firstColumn || index > block.lastColumn) continue;
    for (const rule of block.rules) {
      const type = String(rule.type || '');
      if (type === 'colorScale') {
        const color = scaleColor(rule, value, block);
        if (color) style.background = color;
        continue;
      }
      if (type === 'dataBar') {
        if (value === null) continue;
        style.barColor = argbToCss(rule.color) || '#2563eb';
        style.barRatio = block.max > block.min ? (value - block.min) / (block.max - block.min) : 0;
        continue;
      }
      if (!ruleApplies(rule, value, block)) continue;
      const background = fillBackground(rule.style?.fill);
      if (background) style.background = background;
      if (rule.style?.font?.bold) style.bold = true;
      const color = argbToCss(rule.style?.font?.color);
      if (color) style.color = color;
      // 命中第一条规则就停，和 Excel 按优先级取一条的行为一致。
      return style;
    }
  }
  return style;
}

/** 相对亮度：底纹由文件决定（多为浅底），深色主题下必须换成深色字才看得清。 */
function relativeLuminance(color: string) {
  const channels = [1, 3, 5]
    .map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function readableTextOn(background: string) {
  return relativeLuminance(background) > 0.45 ? '#1f2937' : '#f8fafc';
}

function cellStyle(cell: ExcelJS.Cell, conditional: ConditionalBlock[], rowIndex: number, index: number): SpreadsheetCellStyle {
  const font = cell.font || {};
  const style: SpreadsheetCellStyle = {
    background: fillBackground(cell.fill),
    bold: Boolean(font.bold),
    color: '',
    barColor: '',
    barRatio: 0,
    ...conditionalCellStyle(conditional, rowIndex, index, numericCellValue(cell)),
  };
  // 没有底纹的单元格不能套用文件里的字体色：深色主题下会变成深色背景配深色文字。
  style.color = style.background ? style.color || argbToCss(font.color) || readableTextOn(style.background) : '';
  return style;
}

function styleAttribute(style: SpreadsheetCellStyle) {
  const declarations: string[] = [];
  if (style.background) declarations.push(`background-color:${style.background}`);
  if (style.bold) declarations.push('font-weight:600');
  if (style.color) declarations.push(`color:${style.color}`);
  if (style.barColor) {
    // 数据条用背景渐变画，不必往单元格里再塞一层元素。
    const percent = Math.round(Math.min(1, Math.max(0, style.barRatio)) * 100);
    declarations.push(`background-image:linear-gradient(to right, ${style.barColor} ${percent}%, transparent ${percent}%)`);
  }
  return declarations.length ? ` style="${declarations.join(';')}"` : '';
}

/** Excel 预览还原显示文本（公式取计算结果）、底纹、字体与条件格式。 */
async function spreadsheetPreview(data: Buffer) {
  const workbook = new ExcelJS.Workbook();
  // exceljs 的 load 用的是它自带的 Buffer 类型，与 Node 的 Buffer 泛型不兼容，按运行时真实类型传入。
  await workbook.xlsx.load(data as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0]);
  const sheets = workbook.worksheets.filter((sheet) => sheet.state !== 'hidden' && sheet.state !== 'veryHidden');
  if (!sheets.length) return emptyBlock();
  const blocks: string[] = [];
  let truncated = sheets.length > PREVIEW_MAX_SHEETS;
  for (const sheet of sheets.slice(0, PREVIEW_MAX_SHEETS)) {
    const totalRows = sheet.actualRowCount || 0;
    const totalColumns = sheet.columnCount || 1;
    const rowCount = Math.min(totalRows, PREVIEW_MAX_ROWS);
    const columnCount = Math.min(Math.max(totalColumns, 1), PREVIEW_MAX_COLUMNS);
    if (totalRows > rowCount || totalColumns > columnCount) truncated = true;
    const conditional = conditionalBlocks(sheet);
    const rows: SpreadsheetCell[][] = [];
    for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
      const row = sheet.getRow(rowIndex);
      const cells: SpreadsheetCell[] = [];
      for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
        const cell = row.getCell(columnIndex);
        cells.push({
          text: String(cell.text ?? '').replace(/\s+$/, ''),
          numeric: cellIsNumeric(cell),
          style: cellStyle(cell, conditional, rowIndex, columnIndex),
        });
      }
      rows.push(cells);
    }
    const head = rows[0] || [];
    const body = rows.slice(1);
    blocks.push(`<h2 class="sheet-title">${escapeHtml(sheet.name)}</h2>`);
    blocks.push('<table>');
    if (head.length) {
      blocks.push('<thead><tr>');
      for (const cell of head) blocks.push(`<th${styleAttribute(cell.style)}>${escapeHtml(cell.text)}</th>`);
      blocks.push('</tr></thead>');
    }
    blocks.push('<tbody>');
    for (const row of body) {
      blocks.push('<tr>');
      for (const cell of row) blocks.push(`<td${cell.numeric ? ' class="num"' : ''}${styleAttribute(cell.style)}>${escapeHtml(cell.text)}</td>`);
      blocks.push('</tr>');
    }
    blocks.push('</tbody></table>');
  }
  if (truncated) blocks.push(noteBlock(TRUNCATED_NOTE));
  return blocks.join('');
}

/** 段落保留粗体这类 run 级信息（同类项目 docx-preview 的目标也是保住 HTML 语义，而非还原像素）。 */
function wordRunsHtml(paragraph: string) {
  const parts: string[] = [];
  for (const run of paragraph.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g) || []) {
    const text = wordRunText(run);
    if (!text) continue;
    const bold = /<w:b\b([^>]*)\/?>/.exec(run);
    parts.push(bold && !/w:val="(?:0|false|off)"/.test(bold[1] || '') ? `<strong>${escapeHtml(text)}</strong>` : escapeHtml(text));
  }
  return parts.join('');
}

function paragraphHtml(paragraph: string) {
  return wordRunsHtml(paragraph).trim();
}

type WordTableCell = { html: string; background: string; align: string };

function wordTableCell(cellXml: string): WordTableCell {
  const paragraphs = (cellXml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || []).map(paragraphHtml).filter(Boolean);
  const fill = /<w:shd\b[^>]*w:fill="([0-9A-Fa-f]{6})"/.exec(cellXml)?.[1];
  return {
    html: paragraphs.join('<br />'),
    background: fill ? `#${fill.toLowerCase()}` : '',
    align: /<w:jc\b[^>]*w:val="(center|right)"/.exec(cellXml)?.[1] || '',
  };
}

/** 有序还是无序写在 numbering.xml 里：num → abstractNum → lvl 0 的 numFmt。 */
function orderedListNumbers(entries: Record<string, Uint8Array>) {
  const xml = readPart(entries, 'word/numbering.xml') || '';
  const formatOf = new Map<string, string>();
  for (const abstract of xml.match(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g) || []) {
    const id = /\bw:abstractNumId="(\d+)"/.exec(abstract)?.[1];
    const format = /<w:lvl\b[^>]*w:ilvl="0"[\s\S]*?<w:numFmt\b[^>]*w:val="([^"]+)"/.exec(abstract)?.[1];
    if (id && format) formatOf.set(id, format);
  }
  const ordered = new Set<number>();
  for (const num of xml.match(/<w:num\b[\s\S]*?<\/w:num>/g) || []) {
    const numId = /\bw:numId="(\d+)"/.exec(num)?.[1];
    const format = formatOf.get(/<w:abstractNumId\b[^>]*w:val="(\d+)"/.exec(num)?.[1] || '');
    if (numId && format && format !== 'bullet' && format !== 'none') ordered.add(Number(numId));
  }
  return ordered;
}

type WordBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; html: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; rows: WordTableCell[][] }
  | { kind: 'image'; src: string };

function wordBlocks(xml: string, resolveImage: (relationshipId: string) => string | null, orderedNumbers: Set<number>) {
  const source = xml.replace(/<w:p\b[^>]*\/>/g, '');
  const tokens = source.match(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [];
  const blocks: WordBlock[] = [];
  for (const token of tokens) {
    if (blocks.length >= PREVIEW_MAX_BLOCKS) break;
    if (token.startsWith('<w:tbl')) {
      const rows = (token.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [])
        .map((rowXml) => (rowXml.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || []).map(wordTableCell));
      if (rows.length) blocks.push({ kind: 'table', rows });
      continue;
    }
    // 图片段落本身没有文字，必须在 `if (!text)` 之前取出，否则插图会整个丢掉。
    for (const relationshipId of embeddedImageIds(token)) {
      const src = resolveImage(relationshipId);
      if (src) blocks.push({ kind: 'image', src });
    }
    const html = paragraphHtml(token);
    if (!html) continue;
    const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(token)?.[1] || '';
    const heading = /^Heading([1-6])$/i.exec(style) || /^Title$/i.exec(style);
    if (heading) {
      const level = heading[1] && /^\d$/.test(heading[1]) ? Number(heading[1]) : 1;
      blocks.push({ kind: 'heading', level, text: wordRunText(token).trim() });
      continue;
    }
    const numId = /<w:numPr\b[\s\S]*?<w:numId\b[^>]*w:val="(\d+)"/.exec(token)?.[1];
    if (numId) {
      const ordered = orderedNumbers.has(Number(numId));
      const previous = blocks[blocks.length - 1];
      if (previous && previous.kind === 'list' && previous.ordered === ordered) previous.items.push(html);
      else blocks.push({ kind: 'list', ordered, items: [html] });
      continue;
    }
    blocks.push({ kind: 'paragraph', html: `<p>${html}</p>` });
  }
  return blocks;
}

function wordPreview(data: Buffer) {
  const entries = unzipSync(new Uint8Array(data));
  const xml = readPart(entries, 'word/document.xml');
  if (!xml) return emptyBlock();
  const rels = partRelationships(entries, 'word/document.xml');
  const budget: PreviewMediaBudget = { images: 0, bytes: 0, skipped: 0 };
  const blocks = wordBlocks(xml, (relationshipId) => {
    const target = rels.get(relationshipId);
    return target ? imageDataUri(entries, target, budget) : null;
  }, orderedListNumbers(entries));
  if (!blocks.length) return emptyBlock();
  const html = blocks.map((block) => {
    if (block.kind === 'heading') return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
    if (block.kind === 'image') return `<figure class="doc-figure"><img src="${block.src}" alt="文档插图" /></figure>`;
    if (block.kind === 'list') {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>${block.items.map((item) => `<li>${item}</li>`).join('')}</${tag}>`;
    }
    if (block.kind === 'table') {
      const rows = block.rows.map((row) => `<tr>${row.map((cell) => {
        const declarations = [
          cell.background ? `background-color:${cell.background}` : '',
          cell.align ? `text-align:${cell.align}` : '',
          cell.background ? `color:${readableTextOn(cell.background)}` : '',
        ].filter(Boolean);
        return `<td${declarations.length ? ` style="${declarations.join(';')}"` : ''}>${cell.html}</td>`;
      }).join('')}</tr>`).join('');
      return `<table class="doc-table">${rows}</table>`;
    }
    return block.html;
  }).join('');
  const truncated = blocks.length >= PREVIEW_MAX_BLOCKS;
  const mediaNote = budget.skipped ? noteBlock(`${budget.skipped} 张插图过大或过多，未在预览中显示。`) : '';
  return `${html}${mediaNote}${truncated ? noteBlock(TRUNCATED_NOTE) : ''}`;
}

type SlideShape = { lines: string[]; size: number; top: number | null; placeholderTitle: boolean };

function slideShapes(xml: string): SlideShape[] {
  const shapes: SlideShape[] = [];
  for (const shape of xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []) {
    const lines: string[] = [];
    for (const paragraph of shape.match(/<a:p>[\s\S]*?<\/a:p>/g) || []) {
      const text = decodeXml((paragraph.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [])
        .map((run) => /<a:t[^>]*>([\s\S]*?)<\/a:t>/.exec(run)?.[1] || '')
        .join('')).trim();
      if (text) lines.push(text);
    }
    if (!lines.length) continue;
    const sizes = (shape.match(/<a:\w+Pr\b[^>]*sz="(\d+)"/g) || []).map((tag) => Number(/sz="(\d+)"/.exec(tag)?.[1] || 0));
    const offset = /<a:off\b[^>]*y="(-?\d+)"/.exec(shape);
    shapes.push({
      lines,
      size: sizes.length ? Math.max(...sizes) : 0,
      top: offset ? Number(offset[1]) : null,
      placeholderTitle: /<p:ph\b[^>]*type="(?:title|ctrTitle)"/.test(shape),
    });
  }
  return shapes;
}

/** 幻灯片高度（EMU）写在 presentation.xml 里，用来识别页眉页脚这类版式装饰。 */
function slideHeightEmu(entries: Record<string, Uint8Array>) {
  const cy = /<p:sldSz\b[^>]*cy="(\d+)"/.exec(readPart(entries, 'ppt/presentation.xml') || '')?.[1];
  return Number(cy) || 6858000;
}

/** 标题优先取占位符，其次取字号最大的文本框：页脚页码/品牌字号都比正文小。 */
function slideTitleShape(shapes: SlideShape[]) {
  const placeholder = shapes.find((shape) => shape.placeholderTitle);
  if (placeholder) return placeholder;
  const largest = shapes.reduce<SlideShape | null>((best, shape) => (shape.size > (best?.size ?? 0) ? shape : best), null);
  return largest && largest.size > 0 ? largest : shapes[0] || null;
}

/**
 * 底部约 15% 是品牌页脚与页码、顶部约 12% 是标题页的品牌行，都不属于要点；
 * 生成器写出的幻灯片没有占位符类型，只能按位置与字号判断。
 */
function slideContentLines(shapes: SlideShape[], titleShape: SlideShape | null, heightEmu: number) {
  const titleLines = new Set(titleShape?.lines || []);
  return shapes
    .filter((shape) => shape !== titleShape)
    .filter((shape) => shape.top === null || (shape.top < heightEmu * 0.85 && shape.top >= heightEmu * 0.12))
    .flatMap((shape) => shape.lines)
    .filter((line) => !titleLines.has(line));
}

/** 幻灯片里的插图只认 <p:pic> 内部的 blip，避免把版式背景当成内容图。 */
function slidePictureIds(xml: string) {
  const ids: string[] = [];
  for (const picture of xml.match(/<p:pic\b[^>]*>[\s\S]*?<\/p:pic>/g) || []) {
    ids.push(...embeddedImageIds(picture));
  }
  return ids;
}

function slideChartIds(xml: string) {
  const ids: string[] = [];
  for (const tag of xml.match(/<c:chart\b[^>]*r:id="[^"]+"/g) || []) {
    const id = /r:id="([^"]+)"/.exec(tag)?.[1];
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * 原生图表只有 XML，预览里还原不了图形；改成把缓存的数据点排成表格，
 * 至少让「图表页」不至于在预览里一片空白。
 */
function chartTable(xml: string) {
  const pointsOf = (block: string) => (block.match(/<c:pt\b[^>]*>[\s\S]*?<\/c:pt>/g) || [])
    .map((point) => decodeXml(/<c:v[^>]*>([\s\S]*?)<\/c:v>/.exec(point)?.[1] || '').trim());
  const categories = pointsOf(/<c:cat>[\s\S]*?<\/c:cat>/.exec(xml)?.[0] || '');
  const series = (xml.match(/<c:ser>[\s\S]*?<\/c:ser>/g) || [])
    .map((entry, index) => ({
      name: pointsOf(/<c:tx>[\s\S]*?<\/c:tx>/.exec(entry)?.[0] || '')[0] || `系列 ${index + 1}`,
      values: pointsOf(/<c:val>[\s\S]*?<\/c:val>/.exec(entry)?.[0] || ''),
    }))
    .filter((entry) => entry.values.length);
  if (!series.length) return '';
  const titleText = decodeXml(((/<c:title>[\s\S]*?<\/c:title>/.exec(xml)?.[0] || '').match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [])
    .map((run) => /<a:t[^>]*>([\s\S]*?)<\/a:t>/.exec(run)?.[1] || '')
    .join('')).trim();
  const head = `<tr>${categories.length ? '<th>类别</th>' : ''}${series.map((entry) => `<th>${escapeHtml(entry.name)}</th>`).join('')}</tr>`;
  const rowCount = Math.min(Math.max(categories.length, ...series.map((entry) => entry.values.length)), PREVIEW_MAX_ROWS);
  const rows = Array.from({ length: rowCount }, (_value, index) => {
    const label = categories.length ? `<td>${escapeHtml(categories[index] ?? '')}</td>` : '';
    const cells = series.map((entry) => `<td class="num">${escapeHtml(entry.values[index] ?? '')}</td>`).join('');
    return `<tr>${label}${cells}</tr>`;
  }).join('');
  return `${titleText ? `<h4 class="chart-title">${escapeHtml(titleText)}</h4>` : ''}<table class="chart-table">${head}${rows}</table>`;
}

function presentationPreview(data: Buffer) {
  const entries = unzipSync(new Uint8Array(data));
  const slideNames = Object.keys(entries)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => Number(/(\d+)/.exec(left)?.[1] || 0) - Number(/(\d+)/.exec(right)?.[1] || 0));
  if (!slideNames.length) return emptyBlock();
  const blocks: string[] = [];
  const budget: PreviewMediaBudget = { images: 0, bytes: 0, skipped: 0 };
  const heightEmu = slideHeightEmu(entries);
  let charts = 0;
  let truncated = slideNames.length > PREVIEW_MAX_BLOCKS;
  slideNames.slice(0, PREVIEW_MAX_BLOCKS).forEach((name, index) => {
    const xml = strFromU8(entries[name]);
    const rels = partRelationships(entries, name);
    const shapes = slideShapes(xml);
    const titleShape = slideTitleShape(shapes);
    const title = titleShape ? titleShape.lines.join('') : '';
    const lines = slideContentLines(shapes, titleShape, heightEmu);
    blocks.push('<section class="slide">');
    blocks.push(`<div class="slide-index">第 ${index + 1} 页</div>`);
    if (title) blocks.push(`<div class="slide-title">${escapeHtml(title)}</div>`);
    for (const chartId of slideChartIds(xml)) {
      if (charts >= PREVIEW_MAX_CHARTS) break;
      const target = rels.get(chartId);
      const table = target ? chartTable(readPart(entries, target) || '') : '';
      if (!table) continue;
      charts += 1;
      blocks.push(table);
    }
    if (lines.length) blocks.push(`<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`);
    const images = slidePictureIds(xml)
      .map((relationshipId) => {
        const target = rels.get(relationshipId);
        return target ? imageDataUri(entries, target, budget) : null;
      })
      .filter((src): src is string => Boolean(src));
    if (images.length) {
      blocks.push(`<div class="slide-media">${images.map((src) => `<img src="${src}" alt="幻灯片插图" />`).join('')}</div>`);
    }
    blocks.push('</section>');
  });
  if (budget.skipped) blocks.push(noteBlock(`${budget.skipped} 张插图过大或过多，未在预览中显示。`));
  if (truncated) blocks.push(noteBlock(TRUNCATED_NOTE));
  return blocks.join('');
}

function archivePreview(data: Buffer) {
  const entries = Object.entries(unzipSync(new Uint8Array(data))).filter(([name]) => !name.endsWith('/'));
  if (!entries.length) return emptyBlock();
  entries.sort(([left], [right]) => left.localeCompare(right));
  const rows = entries.slice(0, PREVIEW_MAX_ROWS)
    .map(([name, bytes]) => `<tr><td>${escapeHtml(name)}</td><td class="num">${escapeHtml(formatBytes(bytes.length))}</td></tr>`)
    .join('');
  const truncated = entries.length > PREVIEW_MAX_ROWS;
  return `<p class="meta">共 ${entries.length} 个文件</p><table><thead><tr><th>文件名</th><th>大小</th></tr></thead><tbody>${rows}</tbody></table>${truncated ? noteBlock(TRUNCATED_NOTE) : ''}`;
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 产物预览只解析出可读内容（单元格文本、段落与标题、插图、幻灯片文字、
 * 图表数据点、压缩包清单），不追求与 Office 完全一致的排版；
 * 解析失败时回退成一句说明，不影响下载。
 */
export async function buildArtifactPreviewHtml(input: { kind: ArtifactKind; name: string; data: Buffer; theme?: string }) {
  let body = '';
  try {
    if (input.kind === 'spreadsheet') body = await spreadsheetPreview(input.data);
    else if (input.kind === 'document') body = wordPreview(input.data);
    else if (input.kind === 'presentation') body = presentationPreview(input.data);
    else if (input.kind === 'archive') body = archivePreview(input.data);
    else body = emptyBlock();
  } catch {
    body = `<p class="empty">这个文件暂时无法解析，请下载后用本地应用打开。</p>`;
  }
  return previewShell({ title: input.name, theme: String(input.theme || ''), body });
}

export async function buildArtifactPreviewResponse(
  id: string,
  options: ArtifactPreviewOptions = {},
  store: ArtifactStore = artifactStore,
): Promise<Response> {
  const trimmed = String(id || '').trim();
  if (!isValidArtifactId(trimmed)) return new Response('Invalid artifact id', { status: 400 });
  const stored = await store.read(trimmed);
  if (!stored) return new Response('Not found', { status: 404 });
  let data: Buffer;
  try {
    data = await readFile(stored.filePath);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const tooLarge = data.length > PREVIEW_MAX_BYTES;
  const html = tooLarge
    ? previewShell({
      title: stored.descriptor.name,
      theme: String(options.theme || ''),
      body: `<p class="empty">文件较大（${escapeHtml(formatBytes(data.length))}），预览已省略，请下载查看。</p>`,
    })
    : await buildArtifactPreviewHtml({
      kind: stored.descriptor.kind,
      name: stored.descriptor.name,
      data,
      theme: options.theme,
    });
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': 'inline',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
