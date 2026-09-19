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
  PREVIEW_MAX_TABLES,
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
/* 图表页只有缓存数据可还原，排成紧凑小表比拉满页宽更像「图表说明」。 */
.chart-table { margin:8px 0; width:auto; max-width:100%; }
.chart-figure { margin:10px 0 6px; }
.chart-svg { display:block; width:100%; max-width:560px; height:auto; }
.chart-label { font-size:11px; fill:currentColor; opacity:.75; }
.slide-table { margin:10px 0; }
.doc-toc { margin:10px 0 16px; padding:10px 14px; border:1px solid var(--line); border-radius:8px; background:var(--panel); }
.doc-toc ul { margin:0; padding-left:0; list-style:none; }
.doc-toc li { margin:3px 0; }
.doc-anchor, .doc-link { color:#1d4ed8; text-decoration:underline; }
.doc-fg { color:var(--doc-fg); }
.doc-code { margin:10px 0; padding:10px 12px; overflow-x:auto; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--fg); font:12.5px/1.6 Consolas, "Courier New", monospace; white-space:pre; }
.sheet-meta { margin:2px 0 8px; }
table.sticky-head th { position:sticky; top:0; z-index:1; }
.dd { margin-left:4px; color:var(--muted); font-size:11px; cursor:help; }
.slide-cols { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:10px; }
.slide-col { padding:10px 12px; border:1px solid rgba(127,127,127,.28); border-radius:8px; background:rgba(127,127,127,.08); }
.slide-col-title { font-weight:700; margin-bottom:6px; }
.slide-col ul { margin:0; }
.sheet-title { font-size:15px; font-weight:600; margin:18px 0 8px; }
.meta { color:var(--muted); font-size:12px; margin:6px 0 12px; }
.note { margin-top:16px; padding:8px 12px; border:1px dashed var(--line); border-radius:8px; color:var(--muted); font-size:12px; }
.slide { border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin:0 0 14px; background:var(--panel); }
.slide-index { color:inherit; opacity:.65; font-size:12px; margin-bottom:6px; }
.slide-title { font-size:16px; font-weight:700; margin:0 0 8px; }
.empty { color:var(--muted); padding:26px 4px; }
.theme-dark .doc-anchor, .theme-dark .doc-link { color:#93c5fd; }
.theme-dark .doc-fg { color:color-mix(in srgb, var(--doc-fg) 30%, #ffffff 70%); }
@media (prefers-color-scheme: dark) {
  .theme-auto .doc-anchor, .theme-auto .doc-link { color:#93c5fd; }
  .theme-auto .doc-fg { color:color-mix(in srgb, var(--doc-fg) 30%, #ffffff 70%); }
}
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

function groupThousands(digits: string) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 数字格式串只还原常见写法：百分比、千分位、小数位、货币/单位前后缀。
 * 认不出来的格式返回 null，让调用方退回原文本，绝不猜数字。
 */
function formatNumber(value: number, numFmt: string) {
  const sections = numFmt.split(';');
  const negative = value < 0;
  // 分号分段：第二段是负数格式，第三段是零值；预览只区分正负。
  const section = negative && sections[1] !== undefined ? sections[1] : sections[0];
  const body = section
    .replace(/\[[^\]]*\]/g, '')
    .replace(/_.|\*./g, '')
    .replace(/\\(.)/g, '$1');
  const placeholders = body.match(/[0#?]+(?:[.,][0#?]+)*/);
  if (!placeholders) return null;
  const token = placeholders[0];
  const percent = body.includes('%');
  const [integerPart, fractionPart = ''] = token.split('.');
  const scaled = percent ? value * 100 : value;
  const [rawInteger, rawFraction] = Math.abs(scaled).toFixed(fractionPart.length).split('.');
  const integer = integerPart.includes(',') ? groupThousands(rawInteger) : rawInteger;
  const prefix = body.slice(0, body.indexOf(token)).replace(/["']/g, '');
  const suffix = body.slice(body.indexOf(token) + token.length).replace(/["']/g, '');
  // 括号已经表达负数时不再叠加减号，免得出现 (-1,234.00)。
  const signed = scaled < 0 && !(body.includes('(') && body.includes(')')) ? '-' : '';
  return `${prefix}${signed}${integer}${rawFraction ? `.${rawFraction}` : ''}${suffix}`;
}

/** exceljs 的 cell.text 不做数字格式化（0.03 不会显示成 3.0%），这里按 numFmt 还原单元格显示值。 */
function cellDisplayText(cell: ExcelJS.Cell) {
  const numFmt = String(cell.numFmt || '').trim();
  const value = numericCellValue(cell);
  if (value !== null && numFmt && numFmt.toLowerCase() !== 'general') {
    const formatted = formatNumber(value, numFmt);
    if (formatted) return formatted;
  }
  return String(cell.text ?? '').replace(/\s+$/, '');
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

type SheetView = { state?: string; ySplit?: number };
type ValidationEntry = { type?: string; formulae?: unknown[] };

/** 冻结窗格写在 view 里；只有纵向冻结才对预览的粘性表头有意义。 */
function frozenHeader(sheet: ExcelJS.Worksheet) {
  return ((sheet.views || []) as SheetView[]).some((view) => view.state === 'frozen' && Number(view.ySplit) > 0);
}

/**
 * 数据验证按单元格逐个记录（B2、B3…），这里按列收口成候选值，
 * 用于表头标出「这列有下拉」。取不出候选值就不标，避免误导。
 */
function listOptionsByColumn(sheet: ExcelJS.Worksheet, columnCount: number) {
  // exceljs 的 worksheet.dataValidations 没进类型声明，和生成器一样按最小接口读取。
  const model = (sheet as unknown as { dataValidations?: { model?: Record<string, ValidationEntry> } }).dataValidations?.model;
  const options = new Map<number, string[]>();
  for (const [address, validation] of Object.entries(model || {})) {
    if (validation?.type !== 'list') continue;
    const letters = /^\$?([A-Z]+)/i.exec(String(address).trim())?.[1];
    if (!letters) continue;
    const column = columnIndex(letters);
    if (column < 1 || column > columnCount) continue;
    const existing = options.get(column) || [];
    for (const value of String(validation.formulae?.[0] ?? '').replace(/^"|"$/g, '').split(',')) {
      const option = value.trim();
      if (option && !existing.includes(option)) existing.push(option);
    }
    options.set(column, existing);
  }
  return options;
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
    const options = listOptionsByColumn(sheet, columnCount);
    const frozen = frozenHeader(sheet);
    const widths = Array.from({ length: columnCount }, (_value, index) => Number(sheet.getColumn(index + 1).width) || 0);
    const widthTotal = widths.reduce((sum, value) => sum + value, 0);
    const rows: SpreadsheetCell[][] = [];
    for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
      const row = sheet.getRow(rowIndex);
      const cells: SpreadsheetCell[] = [];
      for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
        const cell = row.getCell(columnIndex);
        cells.push({
          text: cellDisplayText(cell),
          numeric: cellIsNumeric(cell),
          style: cellStyle(cell, conditional, rowIndex, columnIndex),
        });
      }
      rows.push(cells);
    }
    const head = rows[0] || [];
    const body = rows.slice(1);
    blocks.push(`<h2 class="sheet-title">${escapeHtml(sheet.name)}</h2>`);
    const meta = [
      frozen ? '冻结首行' : '',
      sheet.autoFilter ? '自动筛选' : '',
      options.size ? `${options.size} 列带下拉候选` : '',
    ].filter(Boolean);
    if (meta.length) blocks.push(`<p class="meta sheet-meta">${escapeHtml(meta.join(' · '))}</p>`);
    blocks.push(`<table${frozen ? ' class="sticky-head"' : ''}>`);
    // 列宽按 Excel 里的相对比例还原，备注这类宽列不再被挤成和数字列一样宽。
    if (widthTotal > 0) {
      blocks.push(`<colgroup>${widths.map((width) => `<col style="width:${((width / widthTotal) * 100).toFixed(2)}%" />`).join('')}</colgroup>`);
    }
    if (head.length) {
      blocks.push('<thead><tr>');
      for (const [index, cell] of head.entries()) {
        const values = options.get(index + 1);
        const marker = values?.length ? `<span class="dd" title="下拉候选：${escapeHtml(values.slice(0, 8).join('、'))}">▾</span>` : '';
        blocks.push(`<th${styleAttribute(cell.style)}>${escapeHtml(cell.text)}${marker}</th>`);
      }
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

function wordRunHtml(run: string) {
  const text = wordRunText(run);
  if (!text) return '';
  const enabled = (tag: string) => {
    const match = new RegExp(`<w:${tag}\\b([^>]*)\\/?>`).exec(run);
    return match ? !/w:val="(?:0|false|off|none)"/.test(match[1] || '') : false;
  };
  let html = escapeHtml(text);
  if (enabled('strike')) html = `<s>${html}</s>`;
  if (enabled('u')) html = `<u>${html}</u>`;
  if (enabled('i')) html = `<em>${html}</em>`;
  if (enabled('b')) html = `<strong>${html}</strong>`;
  const color = argbToCss({ argb: `FF${/<w:color\b[^>]*w:val="([0-9A-Fa-f]{6})"/.exec(run)?.[1] || ''}` });
  // 字色走 CSS 变量：文档是按白底排版的，深色主题下要整体提亮，否则标题会变成「深底深字」看不见。
  return color ? `<span class="doc-fg" style="--doc-fg:${color}">${html}</span>` : html;
}

/** 段落保留粗体、下划线、字色这类 run 级信息（同类项目 docx-preview 的目标也是保住 HTML 语义，而非还原像素）。 */
function wordRunsFragment(fragment: string) {
  const parts: string[] = [];
  for (const run of fragment.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g) || []) {
    parts.push(wordRunHtml(run));
  }
  return parts.join('');
}

/**
 * <w:hyperlink> 有两种：指向书签的目录项在预览里能直接跳转，外链在 iframe sandbox 里打不开，
 * 因此只做样式还原；域代码（TOC \h \o …）不是正文，先剥掉再取文本。
 */
function wordRunsHtml(paragraph: string) {
  const source = paragraph.replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, '');
  let html = '';
  let lastIndex = 0;
  for (const match of source.matchAll(/<w:hyperlink\b[^>]*>[\s\S]*?<\/w:hyperlink>/g)) {
    const start = match.index ?? 0;
    html += wordRunsFragment(source.slice(lastIndex, start));
    // 链接字色交给 .doc-anchor/.doc-link 决定（深色主题下要提亮），去掉 run 上的颜色包裹。
    const inner = wordRunsFragment(match[0]).replace(/<span class="doc-fg" style="--doc-fg:#[0-9a-f]{6}">([\s\S]*?)<\/span>/g, '$1');
    const anchor = /w:anchor="([^"]+)"/.exec(match[0])?.[1];
    html += anchor
      ? `<a class="doc-anchor" href="#${escapeHtml(anchor)}">${inner}</a>`
      : `<span class="doc-link">${inner}</span>`;
    lastIndex = start + match[0].length;
  }
  return html + wordRunsFragment(source.slice(lastIndex));
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

type WordTocEntry = { level: number; text: string; id: string };

type WordBlock =
  | { kind: 'heading'; level: number; text: string; id: string }
  | { kind: 'paragraph'; html: string }
  | { kind: 'code'; text: string }
  | { kind: 'toc'; entries: WordTocEntry[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; rows: WordTableCell[][] }
  | { kind: 'image'; src: string };

function wordBlocks(xml: string, resolveImage: (relationshipId: string) => string | null, orderedNumbers: Set<number>) {
  const source = xml.replace(/<w:p\b[^>]*\/>/g, '');
  const tokens = source.match(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [];
  const blocks: WordBlock[] = [];
  const headings: WordTocEntry[] = [];
  let tocIndex = -1;
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
    // 域代码里的 TOC 指令不是正文；目录块统一在解析完标题后重建，避免出现「TOC \h \o 1-3」这种原始指令。
    if (/<w:instrText\b[^>]*>\s*TOC\b/.test(token)) {
      if (tocIndex < 0) {
        tocIndex = blocks.length;
        blocks.push({ kind: 'toc', entries: [] });
      }
      continue;
    }
    // 目录缓存条目会和下面的 toc 块重复，直接跳过。
    if (/<w:pStyle\b[^>]*w:val="TOC\d+"/.test(token)) continue;
    // 等宽字体或浅底纹是代码段的标志，正文段落不会同时具备。
    if (/<w:rFonts\b[^>]*w:ascii="Consolas"/.test(token) || /<w:shd\b[^>]*w:fill="F6F8FB"/i.test(token)) {
      const code = wordRunText(token).replace(/^\n+|\n+$/g, '').replace(/\s+$/, '');
      if (code) blocks.push({ kind: 'code', text: code });
      continue;
    }
    const html = paragraphHtml(token);
    if (!html) continue;
    const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(token)?.[1] || '';
    const heading = /^Heading([1-6])$/i.exec(style) || /^Title$/i.exec(style);
    if (heading) {
      const level = heading[1] && /^\d$/.test(heading[1]) ? Number(heading[1]) : 1;
      const text = wordRunText(token).trim();
      // 生成器把标题书签写成 sanmao-h-N，目录项正好按这个锚点跳转。
      const id = /<w:bookmarkStart\b[^>]*w:name="([^"]+)"/.exec(token)?.[1] || `preview-h-${headings.length + 1}`;
      headings.push({ level, text, id });
      blocks.push({ kind: 'heading', level, text, id });
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
  if (tocIndex >= 0) blocks[tocIndex] = { kind: 'toc', entries: headings };
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
    if (block.kind === 'heading') return `<h${block.level} id="${escapeHtml(block.id)}">${escapeHtml(block.text)}</h${block.level}>`;
    if (block.kind === 'toc') {
      if (!block.entries.length) return '';
      // 目录项是文档内的书签锚点，预览里点击即可跳到对应标题。
      const items = block.entries.map((entry) => `<li style="margin-left:${(Math.min(entry.level, 3) - 1) * 16}px"><a class="doc-anchor" href="#${escapeHtml(entry.id)}">${escapeHtml(entry.text)}</a></li>`).join('');
      return `<nav class="doc-toc"><ul>${items}</ul></nav>`;
    }
    if (block.kind === 'code') return `<pre class="doc-code"><code>${escapeHtml(block.text)}</code></pre>`;
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

type SlideShape = { lines: string[]; size: number; left: number | null; top: number | null; placeholderTitle: boolean };

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
    // x/y 分两次取，避免依赖 <a:off> 里的属性顺序。
    const offset = /<a:off\b[^>]*>/.exec(shape)?.[0] || '';
    const left = /\bx="(-?\d+)"/.exec(offset)?.[1];
    const top = /\by="(-?\d+)"/.exec(offset)?.[1];
    shapes.push({
      lines,
      size: sizes.length ? Math.max(...sizes) : 0,
      left: left ? Number(left) : null,
      top: top ? Number(top) : null,
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

/** 幻灯片宽度（EMU），用来按横向位置判断两栏版式。 */
function slideWidthEmu(entries: Record<string, Uint8Array>) {
  const cx = /<p:sldSz\b[^>]*cx="(\d+)"/.exec(readPart(entries, 'ppt/presentation.xml') || '')?.[1];
  return Number(cx) || 12192000;
}

/** 幻灯片底色写在 <p:bg> 里，缺省时退回母版；取不到就不设，跟随应用主题。 */
function slideBackground(xml: string, masterXml: string) {
  for (const source of [xml, masterXml]) {
    const background = /<p:bg>[\s\S]*?<\/p:bg>/.exec(source)?.[0];
    const color = background ? /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(background)?.[1] : '';
    if (color) return `#${color.toLowerCase()}`;
  }
  return '';
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
  return slideContentShapes(shapes, titleShape, heightEmu)
    .flatMap((shape) => shape.lines)
    .filter((line) => !titleLines.has(line));
}

function slideContentShapes(shapes: SlideShape[], titleShape: SlideShape | null, heightEmu: number) {
  return shapes
    .filter((shape) => shape !== titleShape)
    .filter((shape) => shape.top === null || (shape.top < heightEmu * 0.85 && shape.top >= heightEmu * 0.12));
}

/**
 * 两栏版式（生成器的 two-column）把每栏文字画在同一列坐标上，这里按 x 聚成两栏，
 * 否则左右两栏会被拍平成一条分不清归属的列表。
 */
function slideColumnGroups(shapes: SlideShape[], widthEmu: number) {
  if (shapes.length < 2 || shapes.some((shape) => shape.left === null)) return null;
  const tolerance = widthEmu * 0.08;
  const bands: SlideShape[][] = [];
  for (const shape of [...shapes].sort((left, right) => (left.left ?? 0) - (right.left ?? 0))) {
    const band = bands[bands.length - 1];
    if (band && Math.abs((band[0].left ?? 0) - (shape.left ?? 0)) <= tolerance) band.push(shape);
    else bands.push([shape]);
  }
  return bands.length === 2 ? bands : null;
}

/** 每栏第一段文字是栏标题，其余按要点列出。 */
function slideColumnsHtml(bands: SlideShape[][]) {
  const columns = bands.map((band) => {
    const [title, ...rest] = band;
    const items = rest.flatMap((shape) => shape.lines);
    const body = items.length ? `<ul>${items.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : '';
    return `<div class="slide-col"><div class="slide-col-title">${escapeHtml(title.lines.join(' '))}</div>${body}</div>`;
  });
  return `<div class="slide-cols">${columns.join('')}</div>`;
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

type SlideTableCell = { html: string; background: string; align: string; bold: boolean };

function slideTableCell(cellXml: string): SlideTableCell {
  const paragraphs = (cellXml.match(/<a:p>[\s\S]*?<\/a:p>/g) || [])
    .map((paragraph) => decodeXml((paragraph.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [])
      .map((run) => /<a:t[^>]*>([\s\S]*?)<\/a:t>/.exec(run)?.[1] || '')
      .join('')).trim())
    .filter(Boolean);
  // tcPr 里四条边框同样是 srgbClr，先摘掉边框块才能取到真正的单元格底纹。
  const properties = (/<a:tcPr\b[^>]*>([\s\S]*?)<\/a:tcPr>/.exec(cellXml)?.[1] || '')
    .replace(/<a:ln[LRTB]\b[\s\S]*?<\/a:ln[LRTB]>/g, '');
  const fill = /<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(properties)?.[1];
  return {
    html: escapeHtml(paragraphs.join(' / ')),
    background: fill ? `#${fill.toLowerCase()}` : '',
    align: /<a:pPr\b[^>]*algn="ctr"/.test(cellXml) ? 'center' : '',
    bold: /<a:rPr\b[^>]*b="1"/.test(cellXml),
  };
}

/** 幻灯片表格写在 graphicFrame 里，按 shape 解析会整张表丢掉。 */
function slideTables(xml: string) {
  const tables: SlideTableCell[][][] = [];
  for (const frame of xml.match(/<p:graphicFrame\b[^>]*>[\s\S]*?<\/p:graphicFrame>/g) || []) {
    const body = /<a:tbl>[\s\S]*?<\/a:tbl>/.exec(frame)?.[0];
    if (!body) continue;
    const rows = (body.match(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g) || [])
      .map((rowXml) => (rowXml.match(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g) || []).map(slideTableCell));
    if (rows.length) tables.push(rows);
  }
  return tables;
}

function slideTableHtml(rows: SlideTableCell[][]) {
  const headerRow = rows[0].length > 0 && rows[0].every((cell) => cell.background);
  const body = rows.map((row, rowIndex) => `<tr>${row.map((cell) => {
    const declarations = [
      cell.background ? `background-color:${cell.background}` : '',
      cell.background ? `color:${readableTextOn(cell.background)}` : '',
      cell.align ? `text-align:${cell.align}` : '',
      cell.bold ? 'font-weight:600' : '',
    ].filter(Boolean);
    const tag = headerRow && rowIndex === 0 ? 'th' : 'td';
    return `<${tag}${declarations.length ? ` style="${declarations.join(';')}"` : ''}>${cell.html}</${tag}>`;
  }).join('')}</tr>`).join('');
  return `<table class="slide-table">${body}</table>`;
}

type ChartSeries = { name: string; values: string[]; color: string };
type ChartData = { type: string; title: string; categories: string[]; series: ChartSeries[]; pointColors: string[] };

/** 图表 XML 里的配色取自幻灯片主题，取不到时用这套兜底。 */
const CHART_PALETTE = ['#3b82f6', '#22d3ee', '#a855f7', '#f59e0b', '#10b981', '#f43f5e'];

function chartPoints(block: string) {
  return (block.match(/<c:pt\b[^>]*>[\s\S]*?<\/c:pt>/g) || [])
    .map((point) => decodeXml(/<c:v[^>]*>([\s\S]*?)<\/c:v>/.exec(point)?.[1] || '').trim());
}

/** 原生图表只有 XML：先取出缓存的数据点与配色，能画的就画，画不了再退回数据表。 */
function chartData(xml: string): ChartData {
  const series = (xml.match(/<c:ser>[\s\S]*?<\/c:ser>/g) || [])
    .map((entry, index) => {
      // 系列色在 spPr 里，但 spPr 里的 <a:ln> 边框也是 srgbClr，先摘掉边框块。
      const fill = (/<c:spPr>[\s\S]*?<\/c:spPr>/.exec(entry)?.[0] || '')
        .replace(/<a:ln\b[\s\S]*?<\/a:ln>|<a:ln\b[^>]*\/>/g, '');
      const color = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(fill)?.[1];
      return {
        name: chartPoints(/<c:tx>[\s\S]*?<\/c:tx>/.exec(entry)?.[0] || '')[0] || `系列 ${index + 1}`,
        values: chartPoints(/<c:val>[\s\S]*?<\/c:val>/.exec(entry)?.[0] || ''),
        color: color ? `#${color.toLowerCase()}` : '',
      };
    })
    .filter((entry) => entry.values.length);
  const title = decodeXml(((/<c:title>[\s\S]*?<\/c:title>/.exec(xml)?.[0] || '').match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [])
    .map((run) => /<a:t[^>]*>([\s\S]*?)<\/a:t>/.exec(run)?.[1] || '')
    .join('')).trim();
  return {
    type: (/<c:(bar|line|area|pie|doughnut)Chart>/.exec(xml)?.[1] || '').toLowerCase(),
    title,
    categories: chartPoints(/<c:cat>[\s\S]*?<\/c:cat>/.exec(xml)?.[0] || ''),
    series,
    // 饼图/环形图的颜色是按数据点分别给的，写在 dPt 里。
    pointColors: (xml.match(/<c:dPt>[\s\S]*?<\/c:dPt>/g) || [])
      .map((point) => /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(point)?.[1] || '')
      .filter(Boolean)
      .map((color) => `#${color.toLowerCase()}`),
  };
}

function chartValuesOf(series: ChartSeries) {
  return series.values.map((value) => Number(value.replace(/[,\s%]/g, '')));
}

/** 饼图与环形图共用一套画法：用虚线描边把圆切成扇区。 */
function chartSlicesSvg(data: ChartData) {
  const values = chartValuesOf(data.series[0]).map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total) return '';
  const doughnut = data.type === 'doughnut';
  const radius = doughnut ? 74 : 50;
  const stroke = doughnut ? 32 : 100;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const slices = values.map((value, index) => {
    const color = data.pointColors[index] || CHART_PALETTE[index % CHART_PALETTE.length];
    const length = (value / total) * circumference;
    const circle = `<circle cx="112" cy="112" r="${radius}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" />`;
    offset += length;
    return circle;
  }).join('');
  const legend = values.map((value, index) => {
    const color = data.pointColors[index] || CHART_PALETTE[index % CHART_PALETTE.length];
    const label = data.categories[index] || `第 ${index + 1} 项`;
    return `<g><rect x="238" y="${26 + index * 22}" width="10" height="10" rx="2" fill="${color}" /><text x="256" y="${35 + index * 22}" class="chart-label">${escapeHtml(label)} ${Math.round((value / total) * 100)}%</text></g>`;
  }).join('');
  return `<svg class="chart-svg" viewBox="0 0 460 240" role="img" aria-label="${escapeHtml(data.title || '图表')}"><g transform="rotate(-90 112 112)">${slices}</g>${legend}</svg>`;
}

/** 直角坐标系图表：柱状按分组画柱，折线/面积画折线，公用同一套坐标换算。 */
function chartAxisSvg(data: ChartData) {
  const grid = data.series.map(chartValuesOf);
  const numbers = grid.flat().filter((value) => Number.isFinite(value));
  if (!numbers.length) return '';
  const max = Math.max(...numbers, 0);
  const min = Math.min(...numbers, 0);
  const left = 52;
  const right = 632;
  const top = 16;
  const bottom = 194;
  const span = max - min || 1;
  const columnCount = Math.max(1, data.categories.length, ...grid.map((values) => values.length));
  const step = (right - left) / columnCount;
  const y = (value: number) => bottom - ((value - min) / span) * (bottom - top);
  const x = (index: number) => left + step * (index + 0.5);
  const colorOf = (index: number) => data.series[index].color || CHART_PALETTE[index % CHART_PALETTE.length];

  const bars = data.type === 'bar'
    ? grid.map((values, seriesIndex) => values.map((value, index) => {
      if (!Number.isFinite(value)) return '';
      const barWidth = Math.max(2, (step * 0.7) / grid.length);
      const offset = x(index) - (step * 0.7) / 2 + barWidth * seriesIndex;
      const top2 = Math.min(y(value), y(0));
      const height = Math.max(1, Math.abs(y(value) - y(0)));
      return `<rect x="${offset.toFixed(1)}" y="${top2.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${height.toFixed(1)}" rx="2" fill="${colorOf(seriesIndex)}" />`;
    }).join('')).join('')
    : '';

  const lines = data.type === 'bar' ? '' : grid.map((values, seriesIndex) => {
    const points = values.map((value, index) => (Number.isFinite(value) ? `${x(index).toFixed(1)},${y(value).toFixed(1)}` : '')).filter(Boolean).join(' ');
    if (!points) return '';
    const color = colorOf(seriesIndex);
    const area = data.type === 'area' && points.includes(' ')
      ? `<polygon points="${points} ${x(values.length - 1).toFixed(1)},${y(min).toFixed(1)} ${x(0).toFixed(1)},${y(min).toFixed(1)}" fill="${color}" opacity="0.18" />`
      : '';
    return `${area}<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" />`;
  }).join('');

  const labels = data.categories.slice(0, columnCount).map((category, index) => (
    `<text x="${x(index).toFixed(1)}" y="216" class="chart-label" text-anchor="middle">${escapeHtml(category)}</text>`
  )).join('');
  const axis = `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="currentColor" opacity="0.25" />`
    + `<text x="${left - 8}" y="${bottom + 4}" class="chart-label" text-anchor="end">${escapeHtml(String(min))}</text>`
    + `<text x="${left - 8}" y="${top + 8}" class="chart-label" text-anchor="end">${escapeHtml(String(max))}</text>`;
  return `<svg class="chart-svg" viewBox="0 0 640 226" role="img" aria-label="${escapeHtml(data.title || '图表')}">${axis}${bars}${lines}${labels}</svg>`;
}

function chartSvg(data: ChartData) {
  if (!data.series.length) return '';
  if (data.type === 'pie' || data.type === 'doughnut') return chartSlicesSvg(data);
  if (data.type === 'bar' || data.type === 'line' || data.type === 'area') return chartAxisSvg(data);
  return '';
}

/** 画出来的图形是示意，缓存数据点仍按原样列出，方便核对具体数值。 */
function chartHtml(data: ChartData) {
  const series = data.series;
  const head = `<tr>${data.categories.length ? '<th>类别</th>' : ''}${series.map((entry) => `<th>${escapeHtml(entry.name)}</th>`).join('')}</tr>`;
  const rowCount = Math.min(Math.max(data.categories.length, ...series.map((entry) => entry.values.length)), PREVIEW_MAX_ROWS);
  const rows = Array.from({ length: rowCount }, (_value, index) => {
    const label = data.categories.length ? `<td>${escapeHtml(data.categories[index] ?? '')}</td>` : '';
    const cells = series.map((entry) => `<td class="num">${escapeHtml(entry.values[index] ?? '')}</td>`).join('');
    return `<tr>${label}${cells}</tr>`;
  }).join('');
  const svg = chartSvg(data);
  const title = data.title ? `<h4 class="chart-title">${escapeHtml(data.title)}</h4>` : '';
  return `${title}${svg ? `<figure class="chart-figure">${svg}</figure>` : ''}<table class="chart-table">${head}${rows}</table>`;
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
  const widthEmu = slideWidthEmu(entries);
  const masterXml = readPart(entries, 'ppt/slideMasters/slideMaster1.xml') || '';
  let charts = 0;
  let truncated = slideNames.length > PREVIEW_MAX_BLOCKS;
  slideNames.slice(0, PREVIEW_MAX_BLOCKS).forEach((name, index) => {
    const xml = strFromU8(entries[name]);
    const rels = partRelationships(entries, name);
    const shapes = slideShapes(xml);
    const titleShape = slideTitleShape(shapes);
    const title = titleShape ? titleShape.lines.join('') : '';
    const lines = slideContentLines(shapes, titleShape, heightEmu);
    const bands = slideColumnGroups(slideContentShapes(shapes, titleShape, heightEmu), widthEmu);
    const background = slideBackground(xml, masterXml);
    blocks.push(`<section class="slide"${background ? ` style="background-color:${background};color:${readableTextOn(background)}"` : ''}>`);
    blocks.push(`<div class="slide-index">第 ${index + 1} 页</div>`);
    if (title) blocks.push(`<div class="slide-title">${escapeHtml(title)}</div>`);
    for (const chartId of slideChartIds(xml)) {
      if (charts >= PREVIEW_MAX_CHARTS) break;
      const target = rels.get(chartId);
      const data = target ? chartData(readPart(entries, target) || '') : null;
      if (!data?.series.length) continue;
      charts += 1;
      blocks.push(chartHtml(data));
    }
    for (const rows of slideTables(xml).slice(0, PREVIEW_MAX_TABLES)) blocks.push(slideTableHtml(rows));
    if (bands) blocks.push(slideColumnsHtml(bands));
    else if (lines.length) blocks.push(`<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`);
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
