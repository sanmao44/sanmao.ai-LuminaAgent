import ExcelJS from 'exceljs';
import {
  SPREADSHEET_MAX_CELLS,
  SPREADSHEET_MAX_CELL_CHARS,
  SPREADSHEET_MAX_COLUMNS,
  SPREADSHEET_MAX_ROWS_PER_SHEET,
  SPREADSHEET_MAX_SHEETS,
} from './limits';
import { forceArtifactExtension, sanitizeSheetName } from './sanitize';
import { spreadsheetWidth } from './typography';
import { assertArchiveParts } from './validate';
import type { ArtifactBuild } from './types';

type FormulaCell = { formula: string };
type HyperlinkCell = { url: string; text?: string };
export type SpreadsheetCellValue = string | number | boolean | null | FormulaCell | HyperlinkCell;
export type SpreadsheetRow = Record<string, SpreadsheetCellValue> | SpreadsheetCellValue[];

export type SpreadsheetColumnInput = {
  key?: string;
  header: string;
  width?: number;
  format?: string;
};

export type SpreadsheetSheetInput = {
  name?: string;
  columns?: SpreadsheetColumnInput[];
  rows?: SpreadsheetRow[];
  freezeHeader?: boolean;
  autoFilter?: boolean;
};

export type SpreadsheetInput = {
  filename?: string;
  sheets: SpreadsheetSheetInput[];
};

const HEADER_FILL = 'FF2563EB';
const HEADER_FONT = 'FFFFFFFF';
const ZEBRA_FILL = 'FFF4F7FB';
const BORDER_COLOR = 'FFD7E0EC';
const MAX_FORMULA_CHARS = 240;
const MIN_COLUMN_WIDTH = 9;
const MAX_COLUMN_WIDTH = 60;
const BODY_ROW_HEIGHT = 19;
const LINE_HEIGHT = 17;

function isFormulaCell(value: unknown): value is FormulaCell {
  return Boolean(value) && typeof value === 'object' && typeof (value as FormulaCell).formula === 'string';
}

function isHyperlinkCell(value: unknown): value is HyperlinkCell {
  return Boolean(value) && typeof value === 'object' && typeof (value as HyperlinkCell).url === 'string';
}

function normalizeCells(row: SpreadsheetRow, keys: string[]) {
  if (Array.isArray(row)) return keys.map((_, index) => row[index] ?? null);
  if (!row || typeof row !== 'object') return keys.map(() => null);
  return keys.map((key) => (row as Record<string, SpreadsheetCellValue>)[key] ?? null);
}

/** 列 key 必须唯一，否则行列映射会错位；重复的 key 自动补序号。 */
function uniqueColumnKeys(keys: string[]) {
  const used = new Set<string>();
  return keys.map((key, index) => {
    const base = String(key || `col${index + 1}`);
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let candidate = `${base}_${index + 1}`;
    while (used.has(candidate)) candidate = `${candidate}_`;
    used.add(candidate);
    return candidate;
  });
}

/** 工作表名既要唯一又要守住 Excel 的 31 字符上限，去重后缀必须计入长度。 */
function uniqueSheetName(rawName: unknown, index: number, used: Set<string>) {
  const base = sanitizeSheetName(rawName, index);
  if (!used.has(base.toLowerCase())) {
    used.add(base.toLowerCase());
    return base;
  }
  const withSuffix = (suffix: string) => `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
  for (let counter = 2; counter < 1000; counter += 1) {
    const candidate = withSuffix(`-${counter}`);
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
  }
  const fallback = withSuffix(`-${Date.now() % 1000}`);
  used.add(fallback.toLowerCase());
  return fallback;
}

/** 只有显式 { formula } 才当公式，普通文本永远不会被自动求值。 */
function toCellValue(value: SpreadsheetCellValue, warnings: string[], sheetName: string): ExcelJS.CellValue {
  if (value === null || value === undefined) return null;
  if (isFormulaCell(value)) {
    const formula = value.formula.trim().replace(/^=/, '');
    if (!formula || formula.length > MAX_FORMULA_CHARS || /[\r\n]/.test(formula)) {
      warnings.push(`${sheetName}：已忽略一条无效公式`);
      return null;
    }
    return { formula, result: undefined } as ExcelJS.CellValue;
  }
  if (isHyperlinkCell(value)) {
    if (!/^https?:\/\//i.test(value.url)) {
      warnings.push(`${sheetName}：已忽略一个非 http(s) 链接`);
      return String(value.text || value.url).slice(0, SPREADSHEET_MAX_CELL_CHARS);
    }
    return { text: String(value.text || value.url).slice(0, SPREADSHEET_MAX_CELL_CHARS), hyperlink: value.url } as ExcelJS.CellValue;
  }
  if (typeof value === 'string') {
    if (value.length > SPREADSHEET_MAX_CELL_CHARS) {
      warnings.push(`${sheetName}：存在超长文本单元格，已截断`);
      return value.slice(0, SPREADSHEET_MAX_CELL_CHARS);
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value).slice(0, SPREADSHEET_MAX_CELL_CHARS);
}

function cellText(value: ExcelJS.CellValue) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('text' in value && typeof (value as { text?: unknown }).text === 'string') return String((value as { text: string }).text);
    if ('richText' in value) return '';
    if ('result' in value && (value as { result?: unknown }).result !== undefined) return String((value as { result: unknown }).result);
    return '';
  }
  return String(value);
}

/** 数字按格式显示后会变长（千分位、百分号），列宽必须按显示后的样子测量。 */
function formatNumber(value: number, format: string) {
  if (!Number.isFinite(value)) return String(value);
  const decimals = /\.(0+)/.exec(format.replace(/"[^"]*"/g, ''))?.[1].length ?? 0;
  const percent = format.includes('%');
  const scaled = percent && !format.includes('"%"') ? value * 100 : value;
  const [integer, fraction] = Math.abs(scaled).toFixed(decimals).split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${scaled < 0 ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}${percent ? '%' : ''}`;
}

function displayText(value: ExcelJS.CellValue, format?: string) {
  if (typeof value === 'number' && format) return formatNumber(value, format);
  return cellText(value);
}

/** 列宽按内容测量（全角按两个字符宽度），保证文字不会被截断成“####”或半个字。 */
function measureColumnWidth(header: string, values: string[], explicit?: number) {
  if (Number.isFinite(explicit) && Number(explicit) > 0) {
    return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Number(explicit)));
  }
  const longest = values.reduce((max, value) => Math.max(max, spreadsheetWidth(value)), spreadsheetWidth(header));
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, longest + 3));
}

function looksLikePercentHeader(header: string) {
  return /(率|占比|比例|百分比|完成度)$/.test(header.replace(/\s/g, ''));
}

/** 数字列自动套用千分位或百分比格式，避免一列数字看起来像原始数据。 */
function inferNumberFormat(header: string, values: Array<number | null>, explicit?: string) {
  if (explicit) return String(explicit);
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!numbers.length) return undefined;
  if (looksLikePercentHeader(header)) {
    // 同一列里既有 0.9 又有 1.07 时按比率解释（90% / 107%），这是“完成率”最常见的写法。
    if (numbers.every((value) => value >= 0 && value <= 2) && numbers.some((value) => value < 1)) return '0.0%';
    // 模型有时直接给 104 这样的百分数，这时不能再乘 100。
    if (numbers.every((value) => value >= 1 && value <= 1000) && numbers.some((value) => !Number.isInteger(value))) return '#,##0.0"%"';
    if (numbers.every((value) => Number.isInteger(value) && value >= 1 && value <= 1000)) return '#,##0"%"';
  }
  // 用 '#,##0.##' 时整数会显示成「1,286,000.」（多一个尾点），所以整数列改用纯整数格式。
  if (numbers.some((value) => Math.abs(value) >= 1000)) return numbers.every((value) => Number.isInteger(value)) ? '#,##0' : '#,##0.00';
  if (!numbers.every((value) => Number.isInteger(value))) return '0.00';
  return undefined;
}

export async function buildSpreadsheet(input: SpreadsheetInput): Promise<ArtifactBuild> {
  const warnings: string[] = [];
  const sheetInputs = Array.isArray(input.sheets) ? input.sheets : [];
  if (!sheetInputs.length) throw new Error('Excel 内容为空：请至少提供一个 sheet');
  if (sheetInputs.length > SPREADSHEET_MAX_SHEETS) warnings.push(`工作表超过 ${SPREADSHEET_MAX_SHEETS} 个，已截断`);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SANMAO.AI';
  workbook.created = new Date();
  let totalCells = 0;
  const usedNames = new Set<string>();

  for (const [sheetIndex, sheetInput] of sheetInputs.slice(0, SPREADSHEET_MAX_SHEETS).entries()) {
    const name = uniqueSheetName(sheetInput.name, sheetIndex, usedNames);
    const rawColumns = Array.isArray(sheetInput.columns) ? sheetInput.columns.slice(0, SPREADSHEET_MAX_COLUMNS) : [];
    const rows = Array.isArray(sheetInput.rows) ? sheetInput.rows : [];
    const keys = uniqueColumnKeys(rawColumns.length
      ? rawColumns.map((column, index) => String(column.key || `col${index + 1}`))
      : Object.keys((rows.find((row) => row && !Array.isArray(row) && typeof row === 'object') as Record<string, unknown>) || {}).slice(0, SPREADSHEET_MAX_COLUMNS));
    const headers = rawColumns.length
      ? rawColumns.map((column, index) => String(column.header ?? '').trim() || `列 ${index + 1}`)
      : keys;
    if (!keys.length) throw new Error(`工作表「${name}」缺少列定义或数据行`);
    if (rows.length > SPREADSHEET_MAX_ROWS_PER_SHEET) warnings.push(`工作表「${name}」超过 ${SPREADSHEET_MAX_ROWS_PER_SHEET} 行，已截断`);

    const freezeHeader = sheetInput.freezeHeader !== false;
    const worksheet = workbook.addWorksheet(name, {
      views: freezeHeader ? [{ state: 'frozen', ySplit: 1 }] : undefined,
      properties: { defaultRowHeight: BODY_ROW_HEIGHT },
      pageSetup: {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printTitlesRow: '1:1',
        horizontalCentered: true,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      },
    });

    const limitedRows = rows.slice(0, SPREADSHEET_MAX_ROWS_PER_SHEET);
    const cellMatrix: ExcelJS.CellValue[][] = [];
    for (const row of limitedRows) {
      if (totalCells + keys.length > SPREADSHEET_MAX_CELLS) {
        warnings.push(`表格总单元格数超过 ${SPREADSHEET_MAX_CELLS}，后续行已截断`);
        break;
      }
      totalCells += keys.length;
      cellMatrix.push(normalizeCells(row, keys).map((value) => toCellValue(value, warnings, name)));
    }

    const columnFormats = keys.map((_, index) => inferNumberFormat(
      headers[index],
      cellMatrix.map((cells) => cells[index]).filter((cell): cell is number => typeof cell === 'number'),
      rawColumns[index]?.format,
    ));
    const textMatrix = cellMatrix.map((cells) => cells.map((cell, index) => displayText(cell, columnFormats[index])));
    const columnWidths = keys.map((_, index) => measureColumnWidth(
      headers[index],
      textMatrix.map((cells) => cells[index] || ''),
      rawColumns[index]?.width,
    ));

    worksheet.columns = keys.map((key, index) => ({
      key,
      header: headers[index],
      width: columnWidths[index],
      style: { alignment: { vertical: 'middle', horizontal: typeof cellMatrix[0]?.[index] === 'number' ? 'right' : 'left' } },
    }));

    const headerRow = worksheet.getRow(1);
    headerRow.height = 24;
    headerRow.font = { bold: true, color: { argb: HEADER_FONT }, size: 11, name: '微软雅黑' };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: BORDER_COLOR } },
        left: { style: 'thin', color: { argb: BORDER_COLOR } },
        bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
        right: { style: 'thin', color: { argb: BORDER_COLOR } },
      };
    });
    headerRow.commit();

    cellMatrix.forEach((cells, rowOffset) => {
      const row = worksheet.getRow(rowOffset + 2);
      cells.forEach((value, index) => {
        const cell = row.getCell(index + 1);
        cell.value = value;
        const width = columnWidths[index];
        const text = textMatrix[rowOffset][index] || '';
        const needsWrap = typeof value !== 'number' && spreadsheetWidth(text) > width - 1;
        cell.alignment = { vertical: 'middle', wrapText: needsWrap, horizontal: typeof value === 'number' ? 'right' : 'left' };
        cell.font = { name: '微软雅黑', size: 10.5, color: { argb: 'FF1F2937' } };
        cell.border = {
          top: { style: 'thin', color: { argb: BORDER_COLOR } },
          left: { style: 'thin', color: { argb: BORDER_COLOR } },
          bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
          right: { style: 'thin', color: { argb: BORDER_COLOR } },
        };
        if (rowOffset % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_FILL } };
        if (columnFormats[index]) cell.numFmt = columnFormats[index];
      });
      const lines = cells.reduce<number>((max, _value, index) => {
        const text = textMatrix[rowOffset][index] || '';
        const width = columnWidths[index];
        if (spreadsheetWidth(text) <= width - 1) return max;
        return Math.max(max, Math.ceil(spreadsheetWidth(text) / Math.max(4, width - 1)));
      }, 1);
      row.height = lines > 1 ? Math.max(BODY_ROW_HEIGHT, lines * LINE_HEIGHT) : BODY_ROW_HEIGHT;
      row.commit();
    });

    if (sheetInput.autoFilter !== false && keys.length > 1) {
      worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const output = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);
  assertArchiveParts(output, ['xl/workbook.xml', 'xl/worksheets/sheet1.xml'], 'Excel 表格');
  return { buffer: output, warnings };
}

export function resolveSpreadsheetFileName(rawName: unknown) {
  const base = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : 'SANMAO-表格.xlsx';
  return forceArtifactExtension(base, '.xlsx');
}
