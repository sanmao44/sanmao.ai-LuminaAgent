import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifactsModule } from './artifacts-build.mjs';

const artifacts = await buildArtifactsModule();

async function withStore(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-artifacts-excel-'));
  const store = artifacts.createArtifactStore({ root, cleanup: false });
  try {
    return await run(store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('生成结构完整的 xlsx，冻结首行并写入数据', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateSpreadsheetArtifact({
      filename: '销售分析.xlsx',
      sheets: [{
        name: '销售数据',
        columns: [
          { key: 'month', header: '月份', width: 14 },
          { key: 'sales', header: '销售额', width: 16, format: '#,##0' },
        ],
        rows: [{ month: '1月', sales: 120000 }, { month: '2月', sales: 98000 }],
        freezeHeader: true,
        autoFilter: true,
      }],
    }, store);

    assert.equal(result.artifact.name, '销售分析.xlsx');
    assert.match(result.artifact.mimeType, /spreadsheetml\.sheet/);

    const buffer = await readFile((await store.read(result.artifact.id)).filePath);
    const entries = artifacts.readArchiveEntries(buffer);
    assert.ok(entries['xl/workbook.xml']);
    assert.ok(entries['xl/worksheets/sheet1.xml']);
    const sheet = artifacts.readArchiveText(buffer, 'xl/worksheets/sheet1.xml');
    assert.ok(sheet.includes('120000'));
    assert.ok(sheet.includes('<pane'), '冻结首行应写入 pane');
    const shared = artifacts.readArchiveText(buffer, 'xl/sharedStrings.xml');
    assert.ok(shared.includes('1月'), '表头和数据文本写入 sharedStrings');
    assert.ok(shared.includes('销售额'));
  });
});

test('只有显式 formula 字段才写公式，普通文本不会被当作公式', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateSpreadsheetArtifact({
      filename: '公式.xlsx',
      sheets: [{
        name: 'Sheet',
        columns: [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }],
        rows: [
          { a: 1, b: 2 },
          { a: 3, b: 4 },
          { a: { formula: '=SUM(A2:A3)' }, b: '=SUM(B2:B3)' },
        ],
      }],
    }, store);
    const sheet = artifacts.readArchiveText(await readFile((await store.read(result.artifact.id)).filePath), 'xl/worksheets/sheet1.xml');
    const formulas = sheet.match(/<f>/g) || [];
    assert.equal(formulas.length, 1, '只应有一条真正的公式');
    assert.ok(sheet.includes('SUM(A2:A3)'));
  });
});

test('非法工作表名被清洗去重，超限内容给出 warning 而不是损坏文件', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateSpreadsheetArtifact({
      sheets: [
        { name: '非法/名字[1]:超长工作表名称需要被截断到三十一个字符以内', columns: [{ key: 'a', header: 'A' }], rows: [{ a: 'x' }] },
        { name: '非法/名字[1]:超长工作表名称需要被截断到三十一个字符以内', columns: [{ key: 'a', header: 'A' }], rows: [{ a: 'y' }] },
      ],
    }, store);
    const buffer = await readFile((await store.read(result.artifact.id)).filePath);
    const workbook = artifacts.readArchiveText(buffer, 'xl/workbook.xml');
    const names = [...workbook.matchAll(/<sheet[^>]*?name="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(names.length >= 2, '应能读到工作表名');
  assert.equal(names.length, 2, '两张表就是两个工作表名，定义名（如打印标题）不算工作表名');
    for (const name of names) {
      for (const char of ['[', ']', ':', '*', '?', '/', '\\']) {
        assert.ok(!name.includes(char), `工作表名不应包含非法字符 ${char}：${name}`);
      }
      assert.ok(name.length <= 31, `工作表名不应超过 31 字符：${name}`);
    }
    assert.equal(new Set(names).size, names.length, '工作表名必须唯一');
  });
});

test('xlsx 扩展名由服务端强制，空 sheets 直接报错', async () => {
  assert.equal(artifacts.resolveSpreadsheetFileName('数据表格.csv'), '数据表格.xlsx');
  await assert.rejects(() => artifacts.buildSpreadsheet({ sheets: [] }), /内容为空/);
});

test('totals 生成合计行：数值列求和、率列取平均、排名列跳过', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateSpreadsheetArtifact({
      filename: '报表.xlsx',
      sheets: [{
        name: '销售',
        totals: true,
        columns: [
          { key: 'month', header: '月份' },
          { key: 'sales', header: '销售额' },
          { key: 'growth', header: '增长率' },
          { key: 'rank', header: '排名' },
          { key: 'note', header: '备注', total: 'count' },
        ],
        rows: [
          { month: '1月', sales: 120000, growth: 0.12, rank: 1, note: 'a' },
          { month: '2月', sales: 98000, growth: -0.08, rank: 2, note: 'b' },
        ],
      }],
    }, store);

    const buffer = await readFile((await store.read(result.artifact.id)).filePath);
    const sheet = artifacts.readArchiveText(buffer, 'xl/worksheets/sheet1.xml');
    assert.ok(sheet.includes('SUM(B2:B3)'), '销售额应求和');
    assert.ok(sheet.includes('<v>218000</v>'), '合计缓存值应写入，未重算也能看到数字');
    assert.ok(sheet.includes('AVERAGE(C2:C3)'), '率列表头应取平均而不是求和');
    assert.ok(sheet.includes('COUNT(E2:E3)'), '显式 count 应生效');
    assert.equal((sheet.match(/<f>/g) || []).length, 3, '排名列不应参与合计');
    const shared = artifacts.readArchiveText(buffer, 'xl/sharedStrings.xml');
    assert.ok(shared.includes('合计'), '合计行应带标签');
  });
});

test('total 为 none/false 时该列不合计，取值无效时回落默认并给出 warning', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateSpreadsheetArtifact({
      sheets: [{
        name: 'Sheet',
        totals: true,
        columns: [
          { key: 'name', header: '项目' },
          { key: 'amount', header: '金额', total: 'none' },
          { key: 'qty', header: '数量', total: false },
          { key: 'score', header: '得分', total: '中位数' },
        ],
        rows: [{ name: '甲', amount: 10, qty: 2, score: 8 }],
      }],
    }, store);

    const sheet = artifacts.readArchiveText(await readFile((await store.read(result.artifact.id)).filePath), 'xl/worksheets/sheet1.xml');
    assert.ok(!sheet.includes('SUM(B2:B2)'), 'none 列不应合计');
    assert.ok(!sheet.includes('SUM(C2:C2)'), 'false 列不应合计');
    assert.ok(sheet.includes('SUM(D2:D2)'), '取值无效时按默认规则求和');
    const shared = artifacts.readArchiveText(await readFile((await store.read(result.artifact.id)).filePath), 'xl/sharedStrings.xml');
    assert.ok(shared.includes('合计'), '合计行仍保留标签');
    assert.equal(result.warnings.filter((warning) => warning.includes('total 取值无效')).length, 1);
  });
});

test('options 写下拉验证，highlight 写条件格式并跳过无数值列', async () => {
  await withStore(async (store) => {
    const result = await artifacts.generateSpreadsheetArtifact({
      sheets: [{
        name: '状态表',
        columns: [
          { key: 'name', header: '项目', options: ['完成', '进行中', '完成', '含,逗号'], highlight: 'top10' },
          { key: 'amount', header: '金额', highlight: 'dataBar' },
          { key: 'growth', header: '增长率', highlight: 'negative' },
        ],
        rows: [{ name: '甲', amount: 10, growth: 0.2 }, { name: '乙', amount: -5, growth: -0.1 }],
      }],
    }, store);

    const buffer = await readFile((await store.read(result.artifact.id)).filePath);
    const sheet = artifacts.readArchiveText(buffer, 'xl/worksheets/sheet1.xml');
    const styles = artifacts.readArchiveText(buffer, 'xl/styles.xml');

    assert.ok(sheet.includes('sqref="A2:A203"'), '下拉应覆盖数据区并预留下行');
    assert.ok(sheet.includes('&quot;完成,进行中&quot;'), '重复候选应去重后写入');
    assert.ok(!sheet.includes('含,逗号'), '含逗号的候选值必须丢弃');
    assert.equal(result.warnings.filter((warning) => warning.includes('含引号、逗号或换行')).length, 1);

    assert.ok(sheet.includes('<conditionalFormatting sqref="B2:B3">'), '条件格式只覆盖数据行');
    assert.ok(sheet.includes('type="dataBar"'));
    assert.ok(sheet.includes('type="cellIs"') && sheet.includes('operator="lessThan"'), '负数规则应写入');
    assert.ok(styles.includes('FFB91C1C'), 'dxf 样式应写入负数颜色');
    assert.ok(!sheet.includes('conditionalFormatting sqref="A2:A3"'), '无数值列不应写条件格式');
    assert.equal(result.warnings.filter((warning) => warning.includes('没有数值，已跳过条件格式')).length, 1);
  });
});
