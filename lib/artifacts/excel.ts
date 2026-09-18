import ExcelJS from 'exceljs';
import {
  SPREADSHEET_MAX_CELLS,
  SPREADSHEET_MAX_CELL_CHARS,
  SPREADSHEET_MAX_COLUMNS,
  SPREADSHEET_MAX_ROWS_PER_SHEET,
  SPREADSHEET_MAX_SHEETS,
} from './limits';
import { forceArtifactExtension, sanitizeSheetName } from './sanitize';
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

const HEADER_FILL = 'FFEFF3F8';
const HEADER_FONT = 'FF1F2937';
const MAX_FORMULA_CHARS = 240;
const MIN_COLUMN_WIDTH = 8;
const MAX_COLUMN_WIDTH = 60;

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
    });
    worksheet.columns = keys.map((key, index) => {
      const format = rawColumns[index]?.format;
      return {
        key,
        header: headers[index],
        width: Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Number(rawColumns[index]?.width) || 16)),
        ...(format ? { style: { numFmt: String(format) } } : {}),
      };
    });
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: HEADER_FONT } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    headerRow.alignment = { vertical: 'middle' };
    headerRow.height = 20;
    headerRow.commit();

    const limitedRows = rows.slice(0, SPREADSHEET_MAX_ROWS_PER_SHEET);
    for (const row of limitedRows) {
      if (totalCells + keys.length > SPREADSHEET_MAX_CELLS) {
        warnings.push(`表格总单元格数超过 ${SPREADSHEET_MAX_CELLS}，后续行已截断`);
        break;
      }
      totalCells += keys.length;
      worksheet.addRow(normalizeCells(row, keys).map((value) => toCellValue(value, warnings, name)));
    }
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
