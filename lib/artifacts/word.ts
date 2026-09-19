import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import {
  DOCUMENT_MAX_BULLETS_PER_SECTION,
  DOCUMENT_MAX_PARAGRAPHS_PER_SECTION,
  DOCUMENT_MAX_SECTIONS,
  DOCUMENT_MAX_TABLE_COLUMNS,
  DOCUMENT_MAX_TABLE_ROWS,
  DOCUMENT_MAX_TEXT_CHARS,
} from './limits';
import { forceArtifactExtension } from './sanitize';
import { textWidthEm } from './typography';
import { assertArchiveParts } from './validate';
import { loadArtifactImages, type ArtifactGenerateOptions, type ArtifactImage, type ArtifactImageInput } from './images';
import type { ArtifactBuild } from './types';

const A4_CONTENT_WIDTH_DXA = 9026;
const BODY_FONT = { ascii: '微软雅黑', hAnsi: '微软雅黑', eastAsia: '微软雅黑' };
const MONO_FONT = { ascii: 'Consolas', hAnsi: 'Consolas', eastAsia: '微软雅黑' };
const COLOR_TITLE = '0F172A';
const COLOR_SUBTITLE = '5B6472';
const COLOR_HEADING = '1D4ED8';
const COLOR_BODY = '1F2937';
const COLOR_MUTED = '6B7280';
const HEADER_FILL = 'DCE6F5';
const ZEBRA_FILL = 'F4F7FB';
const TABLE_BORDER = 'D7E0EC';
const CODE_COLOR = 'B91C5C';
const CELL_MARGIN = { top: 80, bottom: 80, left: 120, right: 120 };
/** 有序列表的编号定义引用名，Document.numbering 里注册一次，段落按引用渲染。 */
const ORDERED_LIST_REFERENCE = 'sanmao-ordered-list';
const LINK_COLOR = '1D4ED8';
/** 只放行常见安全协议，避免模型输出的 `javascript:` / `data:` 变成可点击链接。 */
const SAFE_LINK_PATTERN = /^(https?:\/\/|mailto:|tel:)/i;
/** A4 正文宽度 6.27in ≈ 602px、可用高度 9.69in ≈ 930px（96dpi）。 */
const DOCUMENT_IMAGE_MAX_WIDTH_PX = 600;
const DOCUMENT_IMAGE_MAX_HEIGHT_PX = 900;

export type DocumentTableInput = {
  columns?: string[];
  rows: Array<Array<string | number | null>>;
};

export type DocumentSectionInput = {
  heading?: string;
  level?: 1 | 2 | 3;
  paragraphs?: string[];
  bullets?: string[];
  orderedBullets?: string[];
  images?: ArtifactImageInput[];
  tables?: DocumentTableInput[];
};

type LooseSectionInput = DocumentSectionInput & {
  type?: string;
  text?: string;
  items?: string[];
  ordered?: string[];
  columns?: string[];
  rows?: Array<Array<string | number | null>>;
};

/**
 * 模型可能给 Markdown 块形状（type/text/items）的章节，这里统一归一化成章节结构，
 * 避免字段名不匹配时静默交付一份空文档。
 */
export function normalizeSections(raw: unknown): DocumentSectionInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): DocumentSectionInput[] => {
    if (!item || typeof item !== 'object') return [];
    const section = item as LooseSectionInput;
    const normalized: DocumentSectionInput = {
      heading: typeof section.heading === 'string' ? section.heading : undefined,
      level: section.level,
      paragraphs: Array.isArray(section.paragraphs) ? section.paragraphs.map(String) : undefined,
      bullets: Array.isArray(section.bullets) ? section.bullets.map(String) : undefined,
      orderedBullets: Array.isArray(section.orderedBullets) ? section.orderedBullets.map(String) : undefined,
      images: Array.isArray(section.images) ? section.images : undefined,
      tables: Array.isArray(section.tables) ? section.tables : undefined,
    };
    const text = typeof section.text === 'string' ? section.text : '';
    if (section.type === 'heading') {
      return [{ ...normalized, heading: normalized.heading || text, level: normalized.level || 1 }];
    }
    if (text && !normalized.paragraphs) normalized.paragraphs = [text];
    if (Array.isArray(section.items) && !normalized.bullets) normalized.bullets = section.items.map(String);
    if (Array.isArray(section.ordered) && !normalized.orderedBullets) normalized.orderedBullets = section.ordered.map(String);
    if (Array.isArray(section.rows) && !normalized.tables) normalized.tables = [{ columns: section.columns, rows: section.rows }];
    return [normalized];
  });
}

export type DocumentInput = {
  filename?: string;
  title?: string;
  subtitle?: string;
  author?: string;
  markdown?: string;
  sections?: DocumentSectionInput[];
  /** 在正文前插入目录；条目用缓存写出，Word/WPS 打开时会自动刷新真实页码。 */
  toc?: boolean;
};

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'ordered'; items: string[] }
  | { type: 'image'; alt: string; ref: string }
  | { type: 'code'; text: string }
  | { type: 'table'; columns: string[]; rows: string[][] };

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string) {
  return /^\|?[\s:-]*-[\s|:-]*\|?$/.test(line.trim()) && line.includes('-');
}

/** 只识别最常用的 Markdown 结构，避免模型为了填 JSON 重复输出一遍长文。 */
export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    const standaloneImage = trimmed.match(/^!\[([^\]]*)\]\(([^\s)]+)\)$/);
    if (standaloneImage) {
      blocks.push({ type: 'image', alt: standaloneImage[1].trim(), ref: standaloneImage[2].trim() });
      index += 1;
      continue;
    }
    if (trimmed.startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3, text: heading[2].trim() });
      index += 1;
      continue;
    }
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*+]\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'bullets', items });
      continue;
    }
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+[.)]\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'ordered', items });
      continue;
    }
    if (trimmed.startsWith('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const columns = splitTableRow(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: 'table', columns, rows });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (!current || current.startsWith('#') || current.startsWith('```') || current.startsWith('![') || /^[-*+]\s+/.test(current) || /^\d+[.)]\s+/.test(current) || current.startsWith('|')) break;
      paragraph.push(current);
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}

export function markdownToSections(markdown: string): DocumentSectionInput[] {
  const sections: DocumentSectionInput[] = [];
  for (const block of parseMarkdownBlocks(markdown)) {
    if (block.type === 'heading') {
      sections.push({ heading: block.text, level: block.level });
      continue;
    }
    if (!sections.length) sections.push({});
    const current = sections[sections.length - 1];
    if (block.type === 'paragraph' || block.type === 'code') {
      current.paragraphs = [...(current.paragraphs || []), block.text];
    } else if (block.type === 'bullets') {
      current.bullets = [...(current.bullets || []), ...block.items];
    } else if (block.type === 'ordered') {
      current.orderedBullets = [...(current.orderedBullets || []), ...block.items];
    } else if (block.type === 'image') {
      current.images = [...(current.images || []), { ref: block.ref, caption: block.alt }];
    } else if (block.type === 'table') {
      current.tables = [...(current.tables || []), { columns: block.columns, rows: block.rows }];
    }
  }
  return sections;
}

type InlineRun = { text: string; bold?: boolean; code?: boolean; link?: string };

/** 链接只放行白名单协议；不合规时返回空串，调用方按纯文本输出。 */
function safeLink(raw: string) {
  const value = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return SAFE_LINK_PATTERN.test(value) ? value : '';
}

function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]\n]+\]\([^\s)]+\))/g;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > lastIndex) runs.push({ text: text.slice(lastIndex, start) });
    const token = match[0];
    if (token.startsWith('**')) {
      runs.push({ text: token.slice(2, -2), bold: true });
    } else if (token.startsWith('`')) {
      runs.push({ text: token.slice(1, -1), code: true });
    } else {
      const labelEnd = token.indexOf(']');
      const url = safeLink(token.slice(labelEnd + 2, -1));
      runs.push(url ? { text: token.slice(1, labelEnd), link: url } : { text: token });
    }
    lastIndex = start + token.length;
  }
  if (lastIndex < text.length) runs.push({ text: text.slice(lastIndex) });
  return runs.length ? runs : [{ text }];
}

function clipText(text: string, warnings: string[], context: string) {
  const value = String(text ?? '');
  if (value.length <= DOCUMENT_MAX_TEXT_CHARS) return value;
  warnings.push(`${context}内容过长，已截断到 ${DOCUMENT_MAX_TEXT_CHARS} 字`);
  return value.slice(0, DOCUMENT_MAX_TEXT_CHARS);
}

/**
 * 把内联片段转成 Word 子节点。链接必须是 ExternalHyperlink，否则只会得到一段普通文字。
 * `styleCode` 只在正文里给代码片段上色，表格里保持与单元格一致的朴素样式。
 */
function inlineChildren(runs: InlineRun[], bold: boolean, styleCode: boolean): Array<TextRun | ExternalHyperlink> {
  return runs.map((run) => {
    if (run.link) {
      return new ExternalHyperlink({
        link: run.link,
        children: [new TextRun({ text: run.text, bold: bold || run.bold, color: LINK_COLOR, underline: {} })],
      });
    }
    return new TextRun({
      text: run.text,
      bold: bold || run.bold,
      font: run.code ? MONO_FONT : undefined,
      size: run.code && styleCode ? 19 : undefined,
      color: run.code && styleCode ? CODE_COLOR : undefined,
    });
  });
}

function textRuns(text: string, warnings: string[], context: string) {
  return inlineChildren(parseInline(clipText(text, warnings, context)), false, true);
}

function cellRuns(text: string, warnings: string[], context: string, bold = false) {
  return inlineChildren(parseInline(clipText(text, warnings, context)), bold, false);
}

/** 单元格左右内边距合计（dxa）；测量列宽时必须算进去，否则长表头会被迫折行。 */
const CELL_MARGIN_DXA = CELL_MARGIN.left + CELL_MARGIN.right;
/** 表格正文字号：21 半磅 = 10.5pt。 */
const TABLE_FONT_HALF_POINTS = 21;
/**
 * 该字号下一个全角字符的宽度（dxa），用来把 em 宽度换算成版面宽度。
 * 乘 1.12 是实测放量：Word/WPS 实际渲染的字宽比“字号 = 全角字宽”略宽。
 */
const TABLE_EM_DXA = (TABLE_FONT_HALF_POINTS / 2 / 72) * 1440 * 1.12;

/**
 * 表格列宽：先给每列留出“放下最长内容 + 内边距”的最小宽度，再把剩余宽度按内容权重分配，
 * 这样内容放得下时所有单元格都是单行；放不下才等比收缩。总和严格等于正文宽度，永不出框。
 */
export function distributeTableWidths(matrix: string[][], columnCount: number) {
  const floor = Math.floor(A4_CONTENT_WIDTH_DXA * 0.078);
  const longestOf = (index: number) => matrix.reduce((max, row) => Math.max(max, textWidthEm(row[index] ?? '')), 0);
  const needs = Array.from({ length: columnCount }, (_, index) => (
    Math.max(floor, Math.round(longestOf(index) * TABLE_EM_DXA) + CELL_MARGIN_DXA)
  ));
  const totalNeed = needs.reduce((sum, value) => sum + value, 0) || columnCount;
  const weights = Array.from({ length: columnCount }, (_, index) => Math.max(4, Math.min(20, longestOf(index) + 0.6)));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || columnCount;
  let widths: number[];
  if (totalNeed <= A4_CONTENT_WIDTH_DXA) {
    widths = needs.map((need, index) => need + ((A4_CONTENT_WIDTH_DXA - totalNeed) * weights[index]) / totalWeight);
  } else {
    // 放不下时只压缩“下限以上的部分”，任何一列都不会被压到放不下一个字。
    const surplus = totalNeed - A4_CONTENT_WIDTH_DXA;
    const flexible = needs.reduce((sum, value) => sum + Math.max(0, value - floor), 0);
    widths = needs.map((need) => (flexible ? need - (surplus * Math.max(0, need - floor)) / flexible : need));
  }
  const rounded = widths.map((value) => Math.max(1, Math.round(value)));
  const drift = A4_CONTENT_WIDTH_DXA - rounded.reduce((sum, value) => sum + value, 0);
  if (drift) {
    const widest = rounded.indexOf(Math.max(...rounded));
    rounded[widest] = Math.max(1, rounded[widest] + drift);
  }
  return rounded;
}

function buildTable(spec: DocumentTableInput, warnings: string[]): Table {
  const maxColumns = Math.max(
    1,
    Math.min(DOCUMENT_MAX_TABLE_COLUMNS, Math.max(spec.columns?.length || 0, ...spec.rows.map((row) => row.length), 1)),
  );
  const rows = spec.rows.slice(0, DOCUMENT_MAX_TABLE_ROWS);
  if (spec.rows.length > DOCUMENT_MAX_TABLE_ROWS) warnings.push(`表格超过 ${DOCUMENT_MAX_TABLE_ROWS} 行，已截断`);
  if (maxColumns > 8) warnings.push('表格列数较多，建议拆分以免过于拥挤');

  const headerTexts = (spec.columns || []).slice(0, maxColumns).map((column) => String(column ?? '').trim() || ' ');
  const bodyTexts = rows.map((row) => Array.from({ length: maxColumns }, (_, index) => String(row[index] ?? '')));
  const widths = distributeTableWidths([headerTexts, ...bodyTexts], maxColumns);

  const cells = (texts: string[], options: { header?: boolean; zebra?: boolean }) => texts.map((text, index) => new TableCell({
    width: { size: widths[index], type: WidthType.DXA },
    shading: options.header
      ? { type: ShadingType.CLEAR, fill: HEADER_FILL }
      : options.zebra ? { type: ShadingType.CLEAR, fill: ZEBRA_FILL } : undefined,
    margins: CELL_MARGIN,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      spacing: { before: 20, after: 20 },
      alignment: options.header ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: cellRuns(text, warnings, options.header ? '表头' : '单元格', options.header),
    })],
  }));

  const tableRows: TableRow[] = [];
  if (headerTexts.length) {
    tableRows.push(new TableRow({ tableHeader: true, cantSplit: true, children: cells(headerTexts, { header: true }) }));
  }
  bodyTexts.forEach((texts, index) => {
    tableRows.push(new TableRow({ cantSplit: true, children: cells(texts, { zebra: index % 2 === 1 }) }));
  });

  return new Table({
    rows: tableRows,
    width: { size: A4_CONTENT_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
      left: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
      right: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
    },
  });
}

function headingLevel(level: number) {
  if (level === 1) return HeadingLevel.HEADING_1;
  if (level === 2) return HeadingLevel.HEADING_2;
  return HeadingLevel.HEADING_3;
}

function headingParagraph(level: 1 | 2 | 3, text: string, warnings: string[], bookmarkId?: string) {
  const runs = textRuns(text, warnings, '小标题');
  return new Paragraph({
    heading: headingLevel(level),
    spacing: { before: level === 1 ? 320 : 260, after: level === 1 ? 160 : 120 },
    border: level === 1
      ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: HEADER_FILL, space: 4 } }
      : undefined,
    // 目录的缓存条目靠书签才能在域刷新前跳转。
    children: bookmarkId ? [new Bookmark({ id: bookmarkId, children: runs })] : runs,
  });
}

function codeParagraph(text: string, warnings: string[]) {
  return new Paragraph({
    // 不显式左对齐时，WPS 会按中文两端对齐把代码里的空格拉开。
    alignment: AlignmentType.LEFT,
    spacing: { before: 80, after: 160 },
    shading: { type: ShadingType.CLEAR, fill: 'F6F8FB' },
    indent: { left: 120, right: 120 },
    children: [
      new TextRun({ text: clipText(text, warnings, '代码'), font: MONO_FONT, size: 19, color: '334155' }),
    ],
  });
}

/** 图片按 A4 正文区等比缩放，绝不超出页宽或页高。 */
function fitDocumentImage(image: ArtifactImage) {
  const scale = Math.min(1, DOCUMENT_IMAGE_MAX_WIDTH_PX / image.width, DOCUMENT_IMAGE_MAX_HEIGHT_PX / image.height);
  return { width: Math.max(1, Math.round(image.width * scale)), height: Math.max(1, Math.round(image.height * scale)) };
}

/** 图片必须是 ImageRun，纯文本占位在 Word 里不会显示任何图形。 */
function imageParagraphs(images: ArtifactImage[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const image of images) {
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: image.caption ? 60 : 160 },
      children: [new ImageRun({ type: image.type, data: image.data, transformation: fitDocumentImage(image) })],
    }));
    if (image.caption) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [new TextRun({ text: image.caption, size: 18, color: COLOR_MUTED })],
      }));
    }
  }
  return paragraphs;
}

function titleBlock(input: DocumentInput, warnings: string[]) {
  const children: Paragraph[] = [];
  if (input.title?.trim()) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 120 },
      children: [new TextRun({ text: clipText(input.title.trim(), warnings, '标题'), bold: true, size: 44, color: COLOR_TITLE })],
    }));
  }
  if (input.subtitle?.trim()) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: clipText(input.subtitle.trim(), warnings, '副标题'), size: 24, color: COLOR_SUBTITLE })],
    }));
  }
  if (children.length) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 320 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: HEADER_FILL, space: 6 } },
      children: [new TextRun({ text: input.author?.trim() || 'SANMAO.AI', size: 18, color: COLOR_MUTED })],
    }));
  }
  return children;
}

type TocEntry = { title: string; level: number; href: string };

/**
 * 目录用缓存条目把条目直接写进文件，任何阅读器都能看到；
 * 同时把域标成 dirty 并开启 updateFields，Word/WPS 打开时按真实页码刷新。
 */
function buildToc(entries: TocEntry[], warnings: string[]): Array<Paragraph | TableOfContents> {
  if (entries.length < 2) {
    warnings.push('目录至少需要 2 个标题，已跳过目录');
    return [];
  }
  return [
    new Paragraph({
      children: [new TextRun({ text: '目录', bold: true, size: 32, color: COLOR_HEADING })],
      spacing: { after: 200 },
    }),
    new TableOfContents('目录', {
      hyperlink: true,
      headingStyleRange: '1-3',
      cachedEntries: entries,
    }),
    // 目录单独占一页，正文从下一页开始。
    new Paragraph({ pageBreakBefore: true, children: [] }),
  ];
}

export async function buildWordDocument(input: DocumentInput, options: ArtifactGenerateOptions = {}): Promise<ArtifactBuild> {
  const warnings: string[] = [];
  const sections = normalizeSections(input.sections);
  if (typeof input.markdown === 'string' && input.markdown.trim()) sections.push(...markdownToSections(input.markdown));
  const sectionCount = sections.length;
  const titleChildren = titleBlock(input, warnings);
  const children: Array<Paragraph | Table> = [];
  const tocEntries: TocEntry[] = [];
  for (const [sectionIndex, section] of sections.slice(0, DOCUMENT_MAX_SECTIONS).entries()) {
    if (section.heading?.trim()) {
      const level = section.level === 1 || section.level === 2 || section.level === 3 ? section.level : 1;
      const bookmarkId = `sanmao-h-${sectionIndex + 1}`;
      children.push(headingParagraph(level, section.heading, warnings, input.toc ? bookmarkId : undefined));
      if (input.toc) tocEntries.push({ title: section.heading.trim().slice(0, 120), level, href: bookmarkId });
    }
    for (const paragraph of (section.paragraphs || []).slice(0, DOCUMENT_MAX_PARAGRAPHS_PER_SECTION)) {
      const lines = String(paragraph).split('\n');
      const isCode = lines.length > 1 && /^\s{2,}|\t/.test(lines[1] || '');
      if (isCode) {
        children.push(codeParagraph(String(paragraph), warnings));
        continue;
      }
      for (const line of lines) {
        children.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 120 }, children: textRuns(line, warnings, '正文') }));
      }
    }
    for (const bullet of (section.bullets || []).slice(0, DOCUMENT_MAX_BULLETS_PER_SECTION)) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        alignment: AlignmentType.LEFT,
        spacing: { after: 80 },
        children: textRuns(bullet, warnings, '列表'),
      }));
    }
    for (const item of (section.orderedBullets || []).slice(0, DOCUMENT_MAX_BULLETS_PER_SECTION)) {
      children.push(new Paragraph({
        numbering: { reference: ORDERED_LIST_REFERENCE, level: 0 },
        alignment: AlignmentType.LEFT,
        spacing: { after: 80 },
        children: textRuns(item, warnings, '编号列表'),
      }));
    }
    for (const table of section.tables || []) {
      children.push(buildTable(table, warnings));
      children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    }
    if (section.images?.length) {
      const images = await loadArtifactImages(section.images, {
        warnings,
        context: section.heading?.trim() ? `章节「${section.heading.trim().slice(0, 20)}」` : '正文',
        roots: options.imageRoots,
      });
      children.push(...imageParagraphs(images));
    }
  }
  if (sections.length > DOCUMENT_MAX_SECTIONS) warnings.push(`章节超过 ${DOCUMENT_MAX_SECTIONS} 个，已截断`);
  if (!sections.length) throw new Error('Word 文档内容为空：请在 markdown 或 sections 里提供正文内容');
  if (!children.length) {
    throw new Error('Word 文档内容为空：每个 section 至少要有 heading / paragraphs / bullets / tables 之一');
  }

  const tocChildren = input.toc ? buildToc(tocEntries, warnings) : [];

  const document = new Document({
    creator: input.author?.trim() || 'SANMAO.AI',
    title: input.title?.trim() || undefined,
    description: `由 SANMAO.AI 生成（${sectionCount} 个章节）`,
    // 目录域需要打开时刷新，否则只显示写进文件的缓存条目。
    features: input.toc ? { updateFields: true } : undefined,
    numbering: {
      config: [{
        reference: ORDERED_LIST_REFERENCE,
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      }],
    },
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: 21, color: COLOR_BODY },
          paragraph: { spacing: { line: 320, after: 120 } },
        },
        heading1: { run: { font: BODY_FONT, size: 30, bold: true, color: COLOR_HEADING } },
        heading2: { run: { font: BODY_FONT, size: 26, bold: true, color: COLOR_TITLE } },
        heading3: { run: { font: BODY_FONT, size: 23, bold: true, color: COLOR_BODY } },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          size: { width: 11906, height: 16838 },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER, space: 6 } },
            children: [
              new TextRun({ text: 'SANMAO.AI  ·  第 ', size: 16, color: COLOR_MUTED }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: COLOR_MUTED }),
              new TextRun({ text: ' 页 / 共 ', size: 16, color: COLOR_MUTED }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: COLOR_MUTED }),
              new TextRun({ text: ' 页', size: 16, color: COLOR_MUTED }),
            ],
          })],
        }),
      },
      children: [...titleChildren, ...tocChildren, ...children],
    }],
  });
  const buffer = await Packer.toBuffer(document);
  assertArchiveParts(buffer, ['[Content_Types].xml', 'word/document.xml'], 'Word 文档');
  return { buffer, warnings };
}

export function resolveDocumentFileName(rawName: unknown) {
  const base = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : 'SANMAO-文档.docx';
  return forceArtifactExtension(base, '.docx');
}
