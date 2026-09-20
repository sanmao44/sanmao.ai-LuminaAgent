import ExcelJS from 'exceljs';
import { strFromU8, unzipSync } from 'fflate';
import { extractText, getDocumentProxy } from 'unpdf';
import { PREVIEW_MAX_COLUMNS, PREVIEW_MAX_ROWS, PREVIEW_MAX_SHEETS } from '../artifacts/limits';

/** 能解析成文字的二进制附件；文本类文件仍然由客户端本地读取，不走这里。 */
export const BINARY_ATTACHMENT_EXTENSIONS = ['docx', 'xlsx', 'pptx', 'pdf'] as const;

/** 上传原件的体积上限。Office 文件很轻松就超过文本附件的 2MB 限制，所以单独放宽。 */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * 单个附件抽取出的文字上限。客户端一轮最多带 8 个附件，而整轮文本预算是 4MB，
 * 按 UTF-8 中文最坏情况（3 字节/字）倒推，120k 字仍在预算内。
 */
export const ATTACHMENT_MAX_CHARS = 120_000;

/** PDF 逐页抽文字；页数上限只是防止超长文档把单次请求拖太久。 */
const PDF_MAX_PAGES = 100;

export type AttachmentText = { text: string; truncated: boolean };

export function attachmentExtension(name: string) {
  return /\.([a-z0-9]+)\s*$/i.exec(String(name || '').trim())?.[1]?.toLowerCase() || '';
}

export function isBinaryAttachmentName(name: string) {
  return (BINARY_ATTACHMENT_EXTENSIONS as readonly string[]).includes(attachmentExtension(name));
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

function readXml(entries: Record<string, Uint8Array>, name: string) {
  const entry = entries[name];
  return entry ? strFromU8(entry) : null;
}

/** Office 新格式都是 ZIP 包；打不开通常是损坏、加密，或者干脆是老的二进制格式改了后缀。 */
function openPackage(data: Uint8Array, label: string) {
  try {
    return unzipSync(data);
  } catch {
    throw new Error(`这个 ${label} 文件读不出来，可能已经损坏、被密码保护，或者不是标准的 ${label} 文件。`);
  }
}

/** 包内相对目标（../notesSlides/notesSlide1.xml）要还原成 ZIP 里的绝对路径才能取到部件。 */
function resolvePartPath(dir: string, target: string) {
  const parts: string[] = [];
  for (const segment of `${target.startsWith('/') ? '' : dir}${target.replace(/^\/+/, '')}`.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join('/');
}

function relatedPart(entries: Record<string, Uint8Array>, partPath: string, typePattern: RegExp) {
  const split = partPath.lastIndexOf('/');
  const dir = split >= 0 ? partPath.slice(0, split + 1) : '';
  const xml = readXml(entries, `${dir}_rels/${partPath.slice(split + 1)}.rels`);
  if (!xml) return '';
  for (const tag of xml.match(/<Relationship\b[^>]*>/g) || []) {
    if (!typePattern.test(tag)) continue;
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    const resolved = target ? resolvePartPath(dir, decodeXml(target)) : '';
    if (resolved) return resolved;
  }
  return '';
}

function finish(text: string, truncated: boolean): AttachmentText {
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (normalized.length > ATTACHMENT_MAX_CHARS) return { text: normalized.slice(0, ATTACHMENT_MAX_CHARS), truncated: true };
  return { text: normalized, truncated };
}

/** 段落内部只关心文字与换行；嵌套的 <w:p>（文本框）交给外层扫描处理，避免整段被吞掉。 */
const PARAGRAPH_TOKEN = /<w:t\b[^>]*\/>|<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>/g;

/** 正文扫描：表格结构加段落。<w:t/> 这种空 run 必须单独匹配，否则会一路吃到下一个 </w:t>。 */
const DOCX_TOKEN = /<w:tbl\b[^>]*>|<\/w:tbl>|<w:tr\b[^>]*>|<\/w:tr>|<w:tc\b[^>]*>|<w:t\b[^>]*\/>|<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g;

/**
 * Word 正文按段落抽文字，表格压成「单元格 | 单元格」的行。
 * <w:tab/>、<w:br/> 是排版语义，直接去标签会把它们丢掉；页眉页脚、批注、域代码不取。
 */
function docxText(data: Uint8Array): AttachmentText {
  const entries = openPackage(data, 'Word');
  const xml = readXml(entries, 'word/document.xml');
  if (!xml) throw new Error('这个 Word 文件里没有正文部件，可能不是标准的 .docx。');
  const lines: string[] = [];
  let tableDepth = 0;
  let rowCells: string[][] = [];
  const pushParagraph = (paragraph: string) => {
    const text = paragraphText(paragraph);
    if (!text) return;
    if (tableDepth && rowCells.length) rowCells[rowCells.length - 1].push(text);
    else lines.push(text);
  };
  for (const token of xml.match(DOCX_TOKEN) || []) {
    if (token.startsWith('<w:tbl')) {
      tableDepth += 1;
      continue;
    }
    if (token.startsWith('</w:tbl')) {
      tableDepth = Math.max(0, tableDepth - 1);
      continue;
    }
    if (token.startsWith('<w:tr')) {
      rowCells = [];
      continue;
    }
    if (token.startsWith('</w:tr')) {
      if (rowCells.length) lines.push(rowCells.map((cell) => cell.join(' ')).join(' | '));
      rowCells = [];
      continue;
    }
    if (token.startsWith('<w:tc')) {
      if (tableDepth) rowCells.push([]);
      continue;
    }
    if (token.startsWith('<w:p')) pushParagraph(token);
  }
  return finish(lines.join('\n'), false);
}

function paragraphText(paragraph: string) {
  let text = '';
  for (const token of paragraph.match(PARAGRAPH_TOKEN) || []) {
    if (token.startsWith('<w:tab')) text += '\t';
    else if (token.startsWith('<w:br') || token.startsWith('<w:cr')) text += '\n';
    else if (token.startsWith('<w:t')) text += decodeXml(token.replace(/^<w:t\b[^>]*>/, '').replace(/<\/w:t>$/, ''));
  }
  return text.trim();
}

/**
 * Excel 按工作表抽成 TSV。exceljs 的 cell.text 不做数字格式化（0.03 不会显示成 3.0%），
 * 报表里这种列最容易读错，所以按 numFmt 补一个百分比。
 */
async function xlsxText(data: Uint8Array): Promise<AttachmentText> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0]);
  } catch {
    throw new Error('这个 Excel 文件读不出来，可能已经损坏、被密码保护，或者不是标准的 .xlsx。');
  }
  const sheets = workbook.worksheets.filter((sheet) => sheet.state !== 'hidden' && sheet.state !== 'veryHidden');
  if (!sheets.length) throw new Error('这个 Excel 文件里没有可见的工作表。');
  const lines: string[] = [];
  let truncated = sheets.length > PREVIEW_MAX_SHEETS;
  for (const sheet of sheets.slice(0, PREVIEW_MAX_SHEETS)) {
    const totalRows = sheet.actualRowCount || 0;
    const totalColumns = sheet.columnCount || 1;
    const rowCount = Math.min(totalRows, PREVIEW_MAX_ROWS);
    const columnCount = Math.min(Math.max(totalColumns, 1), PREVIEW_MAX_COLUMNS);
    if (totalRows > rowCount || totalColumns > columnCount) truncated = true;
    lines.push(`【工作表：${sheet.name}】`);
    for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
      const row = sheet.getRow(rowIndex);
      const cells: string[] = [];
      for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) cells.push(sheetCellText(row.getCell(columnIndex)));
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.some(Boolean)) lines.push(cells.join('\t'));
    }
  }
  return finish(lines.join('\n'), truncated);
}

function sheetCellText(cell: ExcelJS.Cell) {
  const numFmt = String(cell.numFmt || '').trim();
  if (typeof cell.value === 'number' && numFmt.includes('%')) {
    const decimals = Math.min(/\.(0+)%/.exec(numFmt)?.[1].length || 0, 4);
    return `${(cell.value * 100).toFixed(decimals)}%`;
  }
  const text = String(cell.text ?? '').replace(/\s+$/, '');
  if (text) return text;
  const value = cell.value as { formula?: unknown; result?: unknown } | null | undefined;
  // 生成器写出的公式没有缓存结果，exceljs 读到空串；这时退回公式本身，至少让人看到这里有个公式。
  const formula = value && typeof value === 'object' && typeof value.formula === 'string' ? value.formula.trim() : '';
  if (!formula) return '';
  return value?.result === undefined || value?.result === null ? `=${formula}` : '';
}

/** 一页幻灯片里的文字：正文占位符、表格、文本框都在同一个 slideN.xml 里，按段落还原。 */
function slideText(xml: string) {
  return xml
    .split(/<\/a:p>/)
    .map((paragraph) => (paragraph.match(/<a:t\b[^>]*>[\s\S]*?<\/a:t>|<a:br\b[^>]*\/>/g) || [])
      .map((token) => (token.startsWith('<a:br')
        ? '\n'
        : decodeXml(token.replace(/^<a:t\b[^>]*>/, '').replace(/<\/a:t>$/, ''))))
      .join('')
      .trim())
    .filter(Boolean)
    .join('\n');
}

/** 备注页里除了正文还有个幻灯片编号域，只取 body 占位符并去掉域。 */
function notesText(xml: string) {
  const shape = (xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []).find((part) => /<p:ph\b[^>]*type="body"/.test(part));
  if (!shape) return '';
  return slideText(shape.replace(/<a:fld\b[\s\S]*?<\/a:fld>/g, ''));
}

function slideNumber(name: string) {
  return Number(/(\d+)/.exec(name)?.[1] || 0);
}

/** PPT 按页抽文字，演讲者备注跟在对应页后面，方便「基于旧材料改」。 */
function pptxText(data: Uint8Array): AttachmentText {
  const entries = openPackage(data, 'PowerPoint');
  const slideNames = Object.keys(entries)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => slideNumber(left) - slideNumber(right));
  if (!slideNames.length) throw new Error('这个 PPT 文件里没有幻灯片部件，可能不是标准的 .pptx。');
  const lines: string[] = [];
  slideNames.forEach((name, index) => {
    lines.push(`【第 ${index + 1} 页】`);
    const body = slideText(strFromU8(entries[name]));
    if (body) lines.push(body);
    const notesPart = relatedPart(entries, name, /Type="[^"]*\/notesSlide"/i);
    const notes = notesPart ? notesText(readXml(entries, notesPart) || '') : '';
    if (notes) lines.push(`（备注）${notes}`);
  });
  return finish(lines.join('\n'), false);
}

/** PDF 只抽文字层；扫描件和图片型 PDF 抽出来是空的，由调用方提示用户。 */
async function pdfText(data: Uint8Array): Promise<AttachmentText> {
  let pdfDocument;
  try {
    pdfDocument = await getDocumentProxy(data);
  } catch {
    throw new Error('这个 PDF 读不出来，可能已经损坏或被密码保护。');
  }
  try {
    const { text } = await extractText(pdfDocument, { mergePages: false });
    const pages = Array.isArray(text) ? text : [String(text || '')];
    const kept = pages.slice(0, PDF_MAX_PAGES);
    return finish(kept.map((page, index) => `【第 ${index + 1} 页】\n${page}`).join('\n'), pages.length > kept.length);
  } finally {
    try {
      await pdfDocument.loadingTask.destroy();
    } catch {
      // 释放失败不影响已经抽到的文字。
    }
  }
}

/** 不支持的类型返回 null，由调用方决定提示文案；解析失败一律抛中文错误，方便直接回给用户。 */
export async function extractAttachmentText(name: string, data: Uint8Array): Promise<AttachmentText | null> {
  const extension = attachmentExtension(name);
  if (!data.length) throw new Error('这个文件是空的，没有内容可以解析。');
  if (extension === 'docx') return docxText(data);
  if (extension === 'xlsx') return xlsxText(data);
  if (extension === 'pptx') return pptxText(data);
  if (extension === 'pdf') return pdfText(data);
  return null;
}
