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

/** 合计行支持的聚合方式；限定白名单，避免写出 Excel 不认识的函数名。 */
export type SpreadsheetColumnTotal = 'sum' | 'average' | 'count' | 'max' | 'min' | 'none';

/** 条件格式可选样式；不传就不加颜色，避免普通数据表被涂花。 */
export type SpreadsheetColumnHighlight =
  | 'colorScale'
  | 'dataBar'
  | 'negative'
  | 'top10'
  | 'bottom10'
  | 'aboveAverage'
  | 'belowAverage';

export type SpreadsheetColumnInput = {
  key?: string;
  header: string;
  width?: number;
  format?: string;
  /** 该列在合计行里的聚合方式；none 或 false 表示这列不参与合计（如排名、编号）。 */
  total?: SpreadsheetColumnTotal | false;
  /** 该列的下拉候选值，写进 Excel 数据验证。 */
  options?: string[];
  /** 该列的条件格式。 */
  highlight?: SpreadsheetColumnHighlight;
};

export type SpreadsheetSheetInput = {
  name?: string;
  columns?: SpreadsheetColumnInput[];
  rows?: SpreadsheetRow[];
  freezeHeader?: boolean;
  autoFilter?: boolean;
  /** 在数据末尾追加合计行；数值列默认求和，其他列可用列的 total 显式指定。 */
  totals?: boolean;
};

export type SpreadsheetInput = {
  filename?: string;
  sheets: SpreadsheetSheetInput[];
};

const HEADER_FILL = 'FF2563EB';
const HEADER_FONT = 'FFFFFFFF';
const ZEBRA_FILL = 'FFF4F7FB';
const BORDER_COLOR = 'FFD7E0EC';
const TOTAL_FILL = 'FFEAF1FB';
const TOTAL_LABEL = '合计';
const RULE_GOOD_FILL = 'FFDCFCE7';
const RULE_GOOD_TEXT = 'FF15803D';
const RULE_BAD_FILL = 'FFFEE2E2';
const RULE_BAD_TEXT = 'FFB91C1C';
const DATA_BAR_COLOR = 'FF2563EB';
const SCALE_COLORS = ['FFF8696B', 'FFFFEB84', 'FF63BE7B'];
/** 下拉候选值上限：Excel 的列表公式最长 255 字符，这里留出引号与逗号的余量。 */
const MAX_VALIDATION_OPTIONS = 32;
const MAX_VALIDATION_CHARS = 240;
/** 数据区下方多留一段空行，方便用户继续录入时仍有下拉与格式。 */
const VALIDATION_EXTRA_ROWS = 200;
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

/** 排名、编号、日期这类列求和没有意义，合计行默认跳过。 */
function looksLikeIdentifierHeader(header: string) {
  return /(排名|序号|编号|工号|编码|代码|年份|年度|月份|日期|时间|周次|季度|id)$/i.test(header.replace(/\s/g, ''));
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

const COLUMN_TOTALS: readonly SpreadsheetColumnTotal[] = ['sum', 'average', 'count', 'max', 'min', 'none'];
const COLUMN_HIGHLIGHTS: readonly SpreadsheetColumnHighlight[] = ['colorScale', 'dataBar', 'negative', 'top10', 'bottom10', 'aboveAverage', 'belowAverage'];

function normalizeTotal(value: unknown): SpreadsheetColumnTotal | undefined {
  return COLUMN_TOTALS.includes(value as SpreadsheetColumnTotal) ? value as SpreadsheetColumnTotal : undefined;
}

function normalizeHighlight(value: unknown): SpreadsheetColumnHighlight | undefined {
  return COLUMN_HIGHLIGHTS.includes(value as SpreadsheetColumnHighlight) ? value as SpreadsheetColumnHighlight : undefined;
}

/** 列号转 Excel 列名（0 → A、26 → AA），合计公式与条件格式都要用它。 */
function columnLetter(index: number) {
  let value = index + 1;
  let letters = '';
  while (value > 0) {
    letters = String.fromCharCode(65 + ((value - 1) % 26)) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

function totalRange(kind: SpreadsheetColumnTotal, letter: string, firstRow: number, lastRow: number) {
  const range = `${letter}${firstRow}:${letter}${lastRow}`;
  if (kind === 'average') return `AVERAGE(${range})`;
  if (kind === 'count') return `COUNT(${range})`;
  if (kind === 'max') return `MAX(${range})`;
  if (kind === 'min') return `MIN(${range})`;
  return `SUM(${range})`;
}

/** 求和会留下浮点尾巴，缓存值先收一下，避免出现 0.30000000000000004。 */
function roundTotal(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

/** 合计值本地算好写进缓存，WPS 或预览器不重算公式也能看到数字。 */
function totalValue(kind: SpreadsheetColumnTotal, numbers: number[]) {
  if (kind === 'count') return numbers.length;
  if (!numbers.length) return 0;
  if (kind === 'average') return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  if (kind === 'max') return Math.max(...numbers);
  if (kind === 'min') return Math.min(...numbers);
  return numbers.reduce((sum, value) => sum + value, 0);
}

/** 下拉候选值里不能出现引号、逗号或换行，否则 Excel 会把一项拆成多项。 */
function validationFormula(options: unknown, warnings: string[], sheetName: string, header: string) {
  if (!Array.isArray(options)) return undefined;
  const values: string[] = [];
  let chars = 0;
  for (const raw of options) {
    const option = String(raw ?? '').trim();
    if (!option) continue;
    if (/["\r\n,]/.test(option)) {
      warnings.push(`${sheetName}：「${header}」有一个下拉候选值含引号、逗号或换行，已忽略`);
      continue;
    }
    if (values.includes(option)) continue;
    if (values.length >= MAX_VALIDATION_OPTIONS || chars + option.length > MAX_VALIDATION_CHARS) {
      warnings.push(`${sheetName}：「${header}」下拉候选值过多，已截断`);
      break;
    }
    values.push(option);
    chars += option.length + 1;
  }
  return values.length ? `"${values.join(',')}"` : undefined;
}

/** exceljs 的 worksheet.dataValidations 没进类型声明，这里收口成一个最小接口。 */
function dataValidationSink(worksheet: ExcelJS.Worksheet) {
  return (worksheet as unknown as {
    dataValidations: { add: (address: string, validation: ExcelJS.DataValidation) => void };
  }).dataValidations;
}

/** dataBar 的 color 字段在 exceljs 类型声明里缺席，但写入器确实会渲染它。 */
function highlightRule(kind: SpreadsheetColumnHighlight, priority: number): ExcelJS.ConditionalFormattingRule {
  const good: Partial<ExcelJS.Style> = {
    fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: RULE_GOOD_FILL } },
    font: { bold: true, color: { argb: RULE_GOOD_TEXT } },
  };
  const bad: Partial<ExcelJS.Style> = {
    fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: RULE_BAD_FILL } },
    font: { bold: true, color: { argb: RULE_BAD_TEXT } },
  };
  if (kind === 'colorScale') {
    return {
      type: 'colorScale',
      priority,
      cfvo: [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }],
      color: SCALE_COLORS.map((argb) => ({ argb })),
    };
  }
  if (kind === 'dataBar') {
    return { type: 'dataBar', priority, cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: DATA_BAR_COLOR } } as ExcelJS.ConditionalFormattingRule;
  }
  if (kind === 'negative') {
    return { type: 'cellIs', priority, operator: 'lessThan', formulae: [0], style: bad };
  }
  if (kind === 'top10') return { type: 'top10', priority, percent: true, rank: 10, bottom: false, style: good };
  if (kind === 'bottom10') return { type: 'top10', priority, percent: true, rank: 10, bottom: true, style: bad };
  if (kind === 'aboveAverage') return { type: 'aboveAverage', priority, aboveAverage: true, style: good };
  return { type: 'aboveAverage', priority, aboveAverage: false, style: bad };
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

    // 合计行只在有数据时出现；标签放在第一个没有合计的列，避免覆盖真实求和。
    const firstDataRow = 2;
    const lastDataRow = cellMatrix.length + 1;
    const hasData = cellMatrix.length > 0;
    const columnTotals = keys.map((_key, index) => {
      const raw = rawColumns[index]?.total;
      const explicit = normalizeTotal(raw);
      if (raw !== undefined && raw !== false && !explicit) warnings.push(`${name}：「${headers[index]}」的 total 取值无效，已忽略`);
      if (raw === false || explicit === 'none') return undefined;
      if (explicit) return explicit;
      if (!sheetInput.totals) return undefined;
      const hasNumber = cellMatrix.some((cells) => typeof cells[index] === 'number');
      if (!hasNumber || looksLikeIdentifierHeader(headers[index])) return undefined;
      // 增长率这类列求和没有意义，默认取平均。
      return looksLikePercentHeader(headers[index]) ? 'average' as SpreadsheetColumnTotal : 'sum' as SpreadsheetColumnTotal;
    });
    const labelIndex = columnTotals.findIndex((kind) => !kind);
    const totalsRowNumber = hasData && columnTotals.some(Boolean) ? lastDataRow + 1 : 0;
    if (totalsRowNumber) {
      if (labelIndex < 0) warnings.push(`${name}：合计行没有可放标签的列，已省略合计`);
      if (totalCells + keys.length > SPREADSHEET_MAX_CELLS) {
        warnings.push(`表格总单元格数超过 ${SPREADSHEET_MAX_CELLS}，合计行已省略`);
      } else {
        totalCells += keys.length;
        const totals = keys.map((_key, index) => {
          const kind = columnTotals[index];
          if (!kind || index === labelIndex) return null;
          const numbers = cellMatrix.map((cells) => cells[index]).filter((value): value is number => typeof value === 'number');
          const value = roundTotal(totalValue(kind, numbers));
          return { kind, value, text: displayText(value, columnFormats[index]) };
        });
        const row = worksheet.getRow(totalsRowNumber);
        keys.forEach((_key, index) => {
          const cell = row.getCell(index + 1);
          const total = totals[index];
          if (index === labelIndex) cell.value = TOTAL_LABEL;
          else if (total) {
            const letter = columnLetter(index);
            cell.value = { formula: totalRange(total.kind, letter, firstDataRow, lastDataRow), result: total.value } as ExcelJS.CellValue;
            // 合计往往比明细更长，列宽不够会显示成 ####，这里按合计值补一次。
            const needed = spreadsheetWidth(total.text) + 3;
            if (needed > columnWidths[index]) worksheet.getColumn(index + 1).width = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, needed));
          }
          cell.alignment = { vertical: 'middle', horizontal: total ? 'right' : 'left' };
          cell.font = { name: '微软雅黑', size: 10.5, bold: true, color: { argb: 'FF1F2937' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } };
          cell.border = {
            top: { style: 'double', color: { argb: BORDER_COLOR } },
            left: { style: 'thin', color: { argb: BORDER_COLOR } },
            bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
            right: { style: 'thin', color: { argb: BORDER_COLOR } },
          };
          if (columnFormats[index]) cell.numFmt = columnFormats[index];
        });
        row.height = BODY_ROW_HEIGHT;
        row.commit();
      }
    }

    // 下拉与条件格式只覆盖数据区，表头和合计行不参与。
    if (hasData) {
      const validationEndRow = Math.min(
        lastDataRow + VALIDATION_EXTRA_ROWS,
        totalsRowNumber ? totalsRowNumber - 1 : SPREADSHEET_MAX_ROWS_PER_SHEET,
      );
      let rulePriority = 1;
      keys.forEach((_key, index) => {
        const column = rawColumns[index];
        const letter = columnLetter(index);
        const formula = validationFormula(column?.options, warnings, name, headers[index]);
        if (formula && validationEndRow >= firstDataRow) {
          dataValidationSink(worksheet).add(`${letter}${firstDataRow}:${letter}${validationEndRow}`, {
            type: 'list',
            allowBlank: true,
            showErrorMessage: true,
            errorStyle: 'warning',
            errorTitle: '不在候选范围',
            error: `建议使用「${headers[index]}」列的候选值，也可以继续输入其他内容。`,
            formulae: [formula],
          });
        }
        const rawHighlight = column?.highlight;
        const highlight = normalizeHighlight(rawHighlight);
        if (rawHighlight !== undefined && !highlight) warnings.push(`${name}：「${headers[index]}」的 highlight 取值无效，已忽略`);
        if (!highlight) return;
        if (!cellMatrix.some((cells) => typeof cells[index] === 'number')) {
          warnings.push(`${name}：「${headers[index]}」没有数值，已跳过条件格式`);
          return;
        }
        worksheet.addConditionalFormatting({
          ref: `${letter}${firstDataRow}:${letter}${lastDataRow}`,
          rules: [highlightRule(highlight, rulePriority)],
        });
        rulePriority += 1;
      });
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
