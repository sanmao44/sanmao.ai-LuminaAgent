import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const requireTs = createTsRequire(process.cwd());
const fallback = requireTs('./lib/agent/spreadsheet-fallback');

const workbook = {
  filename: '销售表.xlsx',
  sheets: [{
    name: '销售明细',
    columns: [{ key: 'product', header: '产品' }, { key: 'amount', header: '金额' }],
    rows: [{ product: 'A', amount: 10 }],
  }],
};

test('解析纯 Excel JSON', () => {
  assert.deepEqual(fallback.parseSpreadsheetFallback(JSON.stringify(workbook)), workbook);
});

test('解析 fenced JSON', () => {
  assert.deepEqual(fallback.parseSpreadsheetFallback(`结果如下：\n\`\`\`json\n${JSON.stringify(workbook)}\n\`\`\``), workbook);
});

test('解析带说明文字的 JSON', () => {
  assert.deepEqual(fallback.parseSpreadsheetFallback(`我已整理好：${JSON.stringify(workbook)}，请查收。`), workbook);
});

test('没有 sheets 时拒绝普通 JSON', () => {
  assert.equal(fallback.parseSpreadsheetFallback('{"filename":"空.xlsx","rows":[]}'), null);
});

test('兜底提示要求模型只返回 JSON', () => {
  assert.match(fallback.SPREADSHEET_FALLBACK_SYSTEM_PROMPT, /合法的 JSON/);
  assert.match(fallback.SPREADSHEET_FALLBACK_SYSTEM_PROMPT, /sheets 数组/);
});
