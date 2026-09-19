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

type SpreadsheetCell = { text: string; numeric: boolean };

function cellIsNumeric(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (typeof value === 'number') return true;
  if (value && typeof value === 'object' && typeof (value as { result?: unknown }).result === 'number') return true;
  return false;
}

/** Excel 预览只读取单元格显示文本（公式取计算结果），不还原条件格式与图表。 */
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
    const rows: SpreadsheetCell[][] = [];
    for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
      const row = sheet.getRow(rowIndex);
      const cells: SpreadsheetCell[] = [];
      for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
        const cell = row.getCell(columnIndex);
        cells.push({ text: String(cell.text ?? '').replace(/\s+$/, ''), numeric: cellIsNumeric(cell) });
      }
      rows.push(cells);
    }
    const head = rows[0] || [];
    const body = rows.slice(1);
    blocks.push(`<h2 class="sheet-title">${escapeHtml(sheet.name)}</h2>`);
    blocks.push('<table>');
    if (head.length) {
      blocks.push('<thead><tr>');
      for (const cell of head) blocks.push(`<th>${escapeHtml(cell.text)}</th>`);
      blocks.push('</tr></thead>');
    }
    blocks.push('<tbody>');
    for (const row of body) {
      blocks.push('<tr>');
      for (const cell of row) blocks.push(`<td${cell.numeric ? ' class="num"' : ''}>${escapeHtml(cell.text)}</td>`);
      blocks.push('</tr>');
    }
    blocks.push('</tbody></table>');
  }
  if (truncated) blocks.push(noteBlock(TRUNCATED_NOTE));
  return blocks.join('');
}

type WordBlock = { kind: 'heading' | 'paragraph' | 'table' | 'image'; level?: number; text?: string; rows?: string[][]; src?: string };

function wordBlocks(xml: string, resolveImage: (relationshipId: string) => string | null) {
  const source = xml.replace(/<w:p\b[^>]*\/>/g, '');
  const tokens = source.match(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [];
  const blocks: WordBlock[] = [];
  for (const token of tokens) {
    if (blocks.length >= PREVIEW_MAX_BLOCKS) break;
    if (token.startsWith('<w:tbl')) {
      const rows: string[][] = [];
      for (const rowXml of token.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || []) {
        const cells: string[] = [];
        for (const cellXml of rowXml.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || []) {
          const paragraphs = (cellXml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [])
            .map((paragraph) => wordRunText(paragraph).trim())
            .filter(Boolean);
          cells.push(paragraphs.join('\n'));
        }
        rows.push(cells);
      }
      if (rows.length) blocks.push({ kind: 'table', rows });
      continue;
    }
    // 图片段落本身没有文字，必须在 `if (!text)` 之前取出，否则插图会整个丢掉。
    for (const relationshipId of embeddedImageIds(token)) {
      const src = resolveImage(relationshipId);
      if (src) blocks.push({ kind: 'image', src });
    }
    const text = wordRunText(token).trim();
    if (!text) continue;
    const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(token)?.[1] || '';
    const heading = /^Heading([1-6])$/i.exec(style) || /^Title$/i.exec(style);
    if (heading) {
      const level = heading[1] && /^\d$/.test(heading[1]) ? Number(heading[1]) : 1;
      blocks.push({ kind: 'heading', level, text });
      continue;
    }
    if (/<w:numPr\b/.test(token)) {
      const item = `<li>${escapeHtml(text)}</li>`;
      const previous = blocks[blocks.length - 1];
      if (previous && previous.kind === 'paragraph' && previous.text?.startsWith('<ul>') && previous.text.endsWith('</ul>')) {
        previous.text = `${previous.text.slice(0, -'</ul>'.length)}${item}</ul>`;
      } else {
        blocks.push({ kind: 'paragraph', text: `<ul>${item}</ul>` });
      }
      continue;
    }
    blocks.push({ kind: 'paragraph', text: `<p>${escapeHtml(text)}</p>` });
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
  });
  if (!blocks.length) return emptyBlock();
  const html = blocks.map((block) => {
    if (block.kind === 'heading') return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
    if (block.kind === 'image') return `<figure class="doc-figure"><img src="${block.src}" alt="文档插图" /></figure>`;
    if (block.kind === 'table') {
      const rows = (block.rows || []).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
      return `<table class="doc-table">${rows}</table>`;
    }
    return block.text || '';
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
