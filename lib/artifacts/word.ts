import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
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
import { assertArchiveParts } from './validate';
import type { ArtifactBuild } from './types';

const A4_CONTENT_WIDTH_DXA = 9026;
const BODY_FONT = '微软雅黑';
const HEADER_FILL = 'EFF3F8';

export type DocumentTableInput = {
  columns?: string[];
  rows: Array<Array<string | number | null>>;
};

export type DocumentSectionInput = {
  heading?: string;
  level?: 1 | 2 | 3;
  paragraphs?: string[];
  bullets?: string[];
  tables?: DocumentTableInput[];
};

export type DocumentInput = {
  filename?: string;
  title?: string;
  subtitle?: string;
  author?: string;
  markdown?: string;
  sections?: DocumentSectionInput[];
};

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
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
      blocks.push({ type: 'bullets', items });
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
      if (!current || current.startsWith('#') || current.startsWith('```') || /^[-*+]\s+/.test(current) || /^\d+[.)]\s+/.test(current) || current.startsWith('|')) break;
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
    } else if (block.type === 'table') {
      current.tables = [...(current.tables || []), { columns: block.columns, rows: block.rows }];
    }
  }
  return sections;
}

type InlineRun = { text: string; bold?: boolean; code?: boolean };

function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > lastIndex) runs.push({ text: text.slice(lastIndex, start) });
    const token = match[0];
    if (token.startsWith('**')) runs.push({ text: token.slice(2, -2), bold: true });
    else runs.push({ text: token.slice(1, -1), code: true });
    lastIndex = start + token.length;
  }
  if (lastIndex < text.length) runs.push({ text: text.slice(lastIndex) });
  return runs.length ? runs : [{ text }];
}

function textRuns(text: string, warnings: string[], context: string) {
  const clipped = clipText(text, warnings, context);
  return parseInline(clipped).map((run) => new TextRun({ text: run.text, bold: run.bold, font: run.code ? 'Consolas' : undefined, size: run.code ? 20 : undefined }));
}

function clipText(text: string, warnings: string[], context: string) {
  const value = String(text ?? '');
  if (value.length <= DOCUMENT_MAX_TEXT_CHARS) return value;
  warnings.push(`${context}内容过长，已截断到 ${DOCUMENT_MAX_TEXT_CHARS} 字`);
  return value.slice(0, DOCUMENT_MAX_TEXT_CHARS);
}

function buildTable(spec: DocumentTableInput, warnings: string[]): Table {
  const maxColumns = Math.max(
    1,
    Math.min(DOCUMENT_MAX_TABLE_COLUMNS, Math.max(spec.columns?.length || 0, ...spec.rows.map((row) => row.length), 1)),
  );
  const rows = spec.rows.slice(0, DOCUMENT_MAX_TABLE_ROWS);
  if (spec.rows.length > DOCUMENT_MAX_TABLE_ROWS) warnings.push(`表格超过 ${DOCUMENT_MAX_TABLE_ROWS} 行，已截断`);
  const columnWidth = Math.floor(A4_CONTENT_WIDTH_DXA / maxColumns);
  const tableRows: TableRow[] = [];
  if (spec.columns?.length) {
    tableRows.push(new TableRow({
      tableHeader: true,
      children: spec.columns.slice(0, maxColumns).map((column) => new TableCell({
        width: { size: columnWidth, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: HEADER_FILL },
        children: [new Paragraph({ children: [new TextRun({ text: clipText(column, warnings, '表头'), bold: true, size: 20 })] })],
      })),
    }));
  }
  for (const row of rows) {
    tableRows.push(new TableRow({
      children: Array.from({ length: maxColumns }, (_, columnIndex) => new TableCell({
        width: { size: columnWidth, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun({ text: clipText(String(row[columnIndex] ?? ''), warnings, '单元格'), size: 20 })] })],
      })),
    }));
  }
  return new Table({ rows: tableRows, width: { size: A4_CONTENT_WIDTH_DXA, type: WidthType.DXA }, columnWidths: Array.from({ length: maxColumns }, () => columnWidth) });
}

function headingLevel(level: number) {
  if (level === 1) return HeadingLevel.HEADING_1;
  if (level === 2) return HeadingLevel.HEADING_2;
  return HeadingLevel.HEADING_3;
}

export function buildWordDocument(input: DocumentInput): Promise<ArtifactBuild> {
  const warnings: string[] = [];
  const sections = [...(Array.isArray(input.sections) ? input.sections : [])];
  if (typeof input.markdown === 'string' && input.markdown.trim()) sections.push(...markdownToSections(input.markdown));
  const sectionCount = sections.length;
  const children: Array<Paragraph | Table> = [];
  if (input.title?.trim()) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: clipText(input.title, warnings, '标题'), bold: true, size: 44 })] }));
  }
  if (input.subtitle?.trim()) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 280 }, children: [new TextRun({ text: clipText(input.subtitle, warnings, '副标题'), size: 24, color: '5B6472' })] }));
  }
  for (const section of sections.slice(0, DOCUMENT_MAX_SECTIONS)) {
    if (section.heading?.trim()) {
      const level = section.level === 1 || section.level === 2 || section.level === 3 ? section.level : 1;
      children.push(new Paragraph({ heading: headingLevel(level), spacing: { before: 240, after: 120 }, children: textRuns(section.heading, warnings, '小标题') }));
    }
    for (const paragraph of (section.paragraphs || []).slice(0, DOCUMENT_MAX_PARAGRAPHS_PER_SECTION)) {
      for (const line of String(paragraph).split('\n')) {
        children.push(new Paragraph({ spacing: { after: 120 }, children: textRuns(line, warnings, '正文') }));
      }
    }
    for (const bullet of (section.bullets || []).slice(0, DOCUMENT_MAX_BULLETS_PER_SECTION)) {
      children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: textRuns(bullet, warnings, '列表') }));
    }
    for (const table of section.tables || []) {
      children.push(buildTable(table, warnings));
      children.push(new Paragraph({ text: '' }));
    }
  }
  if (sections.length > DOCUMENT_MAX_SECTIONS) warnings.push(`章节超过 ${DOCUMENT_MAX_SECTIONS} 个，已截断`);
  if (!sections.length) throw new Error('Word 文档内容为空：请在 markdown 或 sections 里提供正文内容');
  const document = new Document({
    creator: input.author?.trim() || 'SANMAO.AI',
    title: input.title?.trim() || undefined,
    description: `由 SANMAO.AI 生成（${sectionCount} 个章节）`,
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: 22 },
          paragraph: { spacing: { line: 320, after: 120 } },
        },
      },
    },
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children,
    }],
  });
  return Packer.toBuffer(document).then((buffer) => {
    assertArchiveParts(buffer, ['[Content_Types].xml', 'word/document.xml'], 'Word 文档');
    return { buffer, warnings };
  });
}

export function resolveDocumentFileName(rawName: unknown) {
  const base = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : 'SANMAO-文档.docx';
  return forceArtifactExtension(base, '.docx');
}
