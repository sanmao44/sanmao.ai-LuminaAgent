import { parseSpreadsheetFallback } from './spreadsheet-fallback';

export type ArtifactFallbackKind = 'document' | 'spreadsheet' | 'presentation';

export type ArtifactFallbackCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type TableData = { headers: string[]; rows: string[][] };

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(textFromContent).filter(Boolean).join('\n').trim();
  if (!value || typeof value !== 'object') return '';
  const item = value as Record<string, unknown>;
  if (typeof item.text === 'string') return item.text.trim();
  if (typeof item.content === 'string') return item.content.trim();
  if (Array.isArray(item.content)) return textFromContent(item.content);
  return '';
}

function cleanArtifactText(value: unknown): string {
  let text = textFromContent(value);
  if (!text) return '';
  text = text
    .replace(/(?:^|\n)\s*(?:(?:抱歉|很抱歉|对不起)[^\n]*|(?:我|模型|接口|当前(?:模型|接口|对话模型|系统)|本轮|系统)[^。\n]{0,36}(?:不能|无法|不支持|没有能力|未能|失败)[^\n]*(?:。|$)|(?:只能|仅能)[^\n]*(?:文字|说明)[^\n]*)/giu, '')
    .replace(/(?:当前|目前)[^。\n]{0,100}(?:无法|不能|不支持)[^。\n]{0,160}(?:\.docx|\.xlsx|\.pptx|文件|附件|下载)[^。\n]*(?:。|$)/giu, '')
    .replace(/以下内容可直接复制到\s*(?:Word|Excel|PPT)[^。\n]*(?:。|$)/giu, '')
    .replace(/不再把文字冒充附件[^。\n]*(?:。|$)/giu, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/giu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

function usefulSource(primary: unknown, fallback: unknown): string {
  const first = cleanArtifactText(primary);
  if (first.length >= 12) return first;
  const second = cleanArtifactText(fallback);
  if (second) return second;
  return '请根据本轮请求生成一个可编辑的文件模板。';
}

function jsonRecord(value: string): Record<string, unknown> | null {
  for (const candidate of [value, ...balancedObjects(value)]) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Try the next JSON-shaped candidate.
    }
  }
  return null;
}

function balancedObjects(text: string): string[] {
  const candidates: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          candidates.push(text.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return candidates;
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function markdownTable(text: string): TableData | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes('|') || !isTableSeparator(lines[index + 1])) continue;
    const headers = splitTableRow(lines[index]).map((header, cellIndex) => header || `列${cellIndex + 1}`);
    const rows: string[][] = [];
    for (let rowIndex = index + 2; rowIndex < lines.length && lines[rowIndex].includes('|'); rowIndex += 1) {
      if (isTableSeparator(lines[rowIndex])) continue;
      const cells = splitTableRow(lines[rowIndex]);
      if (cells.some(Boolean)) rows.push(headers.map((_, cellIndex) => cells[cellIndex] || ''));
    }
    return { headers, rows };
  }
  return null;
}

function delimitedTable(text: string): TableData | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const delimiter = lines.some((line) => line.includes('\t')) ? '\t' : /[,，]/.test(lines[0]) ? /[,，]/ : null;
  if (!delimiter) return null;
  const parsed = lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
  const width = parsed[0]?.length || 0;
  if (width < 2 || parsed.some((row) => row.length !== width)) return null;
  const headers = parsed[0].map((header, index) => header || `列${index + 1}`);
  const rows = parsed.slice(1).filter((row) => row.some(Boolean));
  return rows.length ? { headers, rows } : { headers, rows: [] };
}

function columnKey(header: string, index: number, used: Set<string>): string {
  const base = header.trim().replace(/[^\w\u4e00-\u9fff-]+/g, '_').replace(/^_+|_+$/g, '') || `column_${index + 1}`;
  let key = base;
  let suffix = 2;
  while (used.has(key)) key = `${base}_${suffix++}`;
  used.add(key);
  return key;
}

function instructionColumns(text: string): string[] {
  const match = text.match(/(?:包含|包括|字段(?:为)?|表头(?:为)?|列(?:为)?|需要(?:有|包含))\s*([^。！？!?\n]+)/i);
  if (!match?.[1]) return [];
  const values = match[1]
    .replace(/[。！？!?].*$/u, '')
    .split(/、|,|，|;|；|\||\/|和|及|以及/u)
    .map((value) => value.trim().replace(/^(?:等|等等)$/, ''))
    .filter((value) => value.length > 0 && value.length <= 24)
    .slice(0, 24);
  return values.length >= 2 ? values : [];
}

function templateColumns(text: string): Array<{ key: string; header: string }> {
  const requested = instructionColumns(text);
  if (requested.length) {
    const used = new Set<string>();
    return requested.map((header, index) => ({ key: columnKey(header, index, used), header }));
  }
  if (/(?:销售|订单|客户|商品|收款|业绩)/i.test(text)) {
    return [
      { key: 'sequence', header: '序号' },
      { key: 'date', header: '日期' },
      { key: 'customer', header: '客户/产品' },
      { key: 'quantity', header: '数量' },
      { key: 'unitPrice', header: '单价' },
      { key: 'amount', header: '金额' },
      { key: 'status', header: '状态' },
      { key: 'notes', header: '备注' },
    ];
  }
  if (/(?:预算|费用|成本|报销)/i.test(text)) {
    return [
      { key: 'category', header: '费用项目' },
      { key: 'budget', header: '预算金额' },
      { key: 'actual', header: '实际金额' },
      { key: 'difference', header: '差额' },
      { key: 'notes', header: '备注' },
    ];
  }
  if (/(?:计划|排期|任务|项目进度)/i.test(text)) {
    return [
      { key: 'task', header: '任务' },
      { key: 'owner', header: '负责人' },
      { key: 'startDate', header: '开始日期' },
      { key: 'endDate', header: '结束日期' },
      { key: 'status', header: '状态' },
      { key: 'notes', header: '备注' },
    ];
  }
  return [
    { key: 'sequence', header: '序号' },
    { key: 'item', header: '项目' },
    { key: 'content', header: '内容' },
    { key: 'status', header: '状态' },
    { key: 'notes', header: '备注' },
  ];
}

function spreadsheetFromText(text: string, filename: string): Record<string, unknown> {
  const parsed = parseSpreadsheetFallback(text);
  if (parsed) {
    const parsedRecord = parsed as Record<string, unknown>;
    const sourceSheets = Array.isArray(parsedRecord.sheets) ? parsedRecord.sheets : [];
    const sheets = sourceSheets.map((sourceSheet, index) => {
      const sheet = sourceSheet && typeof sourceSheet === 'object' && !Array.isArray(sourceSheet)
        ? sourceSheet as Record<string, unknown>
        : {};
      const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
      const columns = Array.isArray(sheet.columns) && sheet.columns.length
        ? sheet.columns
        : rows[0] && !Array.isArray(rows[0]) && typeof rows[0] === 'object'
          ? Object.keys(rows[0] as Record<string, unknown>).map((key) => ({ key, header: key }))
          : rows[0] && Array.isArray(rows[0])
            ? (rows[0] as unknown[]).map((_, columnIndex) => ({ key: `column_${columnIndex + 1}`, header: `列${columnIndex + 1}` }))
            : templateColumns(text);
      return {
        ...sheet,
        name: typeof sheet.name === 'string' && sheet.name.trim() ? sheet.name : index === 0 ? '数据表' : `数据表${index + 1}`,
        columns,
        rows,
        freezeHeader: sheet.freezeHeader !== false,
        autoFilter: sheet.autoFilter !== false,
      };
    });
    return {
      ...parsedRecord,
      filename: typeof parsedRecord.filename === 'string' && parsedRecord.filename.trim() ? parsedRecord.filename : filename,
      sheets: sheets.length ? sheets : [{ name: '数据表', columns: templateColumns(text), rows: [] }],
    };
  }

  const table = markdownTable(text) || delimitedTable(text);
  if (table) {
    const used = new Set<string>();
    const keys = table.headers.map((header, index) => columnKey(header, index, used));
    return {
      filename,
      sheets: [{
        name: /分镜|脚本|镜头|配音|旁白|时间/.test(text) ? '分镜脚本' : '数据表',
        columns: table.headers.map((header, index) => ({ key: keys[index], header })),
        rows: table.rows.map((row) => Object.fromEntries(keys.map((key, index) => [key, row[index] || '']))),
        freezeHeader: true,
        autoFilter: true,
      }],
    };
  }

  const lines = text.split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/, '').trim())
    .filter((line) => line && !/^[-_]{3,}$/.test(line))
    .slice(0, 500);
  const looksLikeRequestOnly = lines.length <= 3 && /(?:生成|制作|创建|导出|下载|保存|整理|excel|xlsx|表格|报表|台账|清单)/i.test(text);
  if (looksLikeRequestOnly) {
    const columns = templateColumns(text);
    return {
      filename,
      sheets: [{ name: '数据表', columns, rows: [], freezeHeader: true, autoFilter: true }],
    };
  }

  const rows = lines;
  return {
    filename,
    sheets: [{
      name: '内容',
      columns: [{ key: 'content', header: '内容' }],
      rows: rows.map((content) => ({ content })),
      freezeHeader: true,
      autoFilter: true,
    }],
  };
}

function fileName(kind: ArtifactFallbackKind, hint: string): string {
  const extension = kind === 'document' ? 'docx' : kind === 'spreadsheet' ? 'xlsx' : 'pptx';
  const match = hint.match(new RegExp(`(?:文件名|命名为|叫做|名为|filename)\\s*[:：]?\\s*["“「]?([^"”」\\n]+\\.${extension})`, 'i'))
    || hint.match(new RegExp(`(?:^|[\\s"“「：:,，])([^\\s"”」:,，。！？!?]+\\.${extension})(?=$|[\\s"”」,，。！？!?])`, 'iu'));
  if (match?.[1]?.trim()) return match[1].trim();
  return kind === 'document' ? 'SANMAO-文档.docx' : kind === 'spreadsheet' ? 'SANMAO-表格.xlsx' : 'SANMAO-演示文稿.pptx';
}

function presentationMarkdown(source: string): string {
  if (/^\s*#/m.test(source)) return source;
  return `# SANMAO.AI 交付内容\n\n## 本轮请求\n\n- ${source.replace(/\r?\n/g, '\n- ')}`;
}

export function artifactFallbackKindFor(routeKind: string, text: string): ArtifactFallbackKind | null {
  if (routeKind === 'word') return 'document';
  if (routeKind === 'excel') return 'spreadsheet';
  if (routeKind === 'ppt') return 'presentation';
  const value = String(text || '');
  if (/(?:excel|xlsx|表格|报表|台账|清单|数据表)/i.test(value)) return 'spreadsheet';
  if (/(?:ppt|pptx|幻灯片|演示文稿|演示|deck)/i.test(value)) return 'presentation';
  if (/(?:word|docx|文档|报告|方案|合同|简历|周报|日报|月报|纪要|会议记录|汇报|论文|说明书|手册)/i.test(value)) return 'document';
  return null;
}

export function artifactInputHasContent(kind: ArtifactFallbackKind, value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (kind === 'spreadsheet') {
    return Array.isArray(record.sheets) && record.sheets.some((sheet) => {
      if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) return false;
      const item = sheet as Record<string, unknown>;
      const columns = Array.isArray(item.columns) ? item.columns : [];
      const rows = Array.isArray(item.rows) ? item.rows : [];
      return columns.length > 0 || rows.some((row) => Boolean(row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).length));
    });
  }
  return (typeof record.markdown === 'string' && record.markdown.trim().length > 0)
    || (kind === 'document' && Array.isArray(record.sections) && record.sections.length > 0)
    || (kind === 'presentation' && Array.isArray(record.slides) && record.slides.length > 0);
}

export function makeArtifactFallbackCall(input: {
  kind: ArtifactFallbackKind;
  content?: unknown;
  fallbackContent?: unknown;
  filenameHint?: string;
}): ArtifactFallbackCall | null {
  const source = usefulSource(input.content, input.fallbackContent);
  if (!source) return null;
  const filename = fileName(input.kind, String(input.filenameHint || ''));
  let args: Record<string, unknown>;
  if (input.kind === 'spreadsheet') {
    args = spreadsheetFromText(source, filename);
  } else {
    const parsed = jsonRecord(source);
    const hasStructuredContent = parsed && (typeof parsed.markdown === 'string' || Array.isArray(parsed.sections) || Array.isArray(parsed.slides));
    args = hasStructuredContent
      ? { ...parsed, filename: parsed.filename || filename }
      : { filename, markdown: input.kind === 'presentation' ? presentationMarkdown(source) : source };
  }
  const name = input.kind === 'document' ? 'document_generate' : input.kind === 'spreadsheet' ? 'spreadsheet_generate' : 'presentation_generate';
  return { id: `sanmao-local-${input.kind}-fallback`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}
