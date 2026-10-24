import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const artifactTools = await readFile(new URL('../lib/tools/artifacts.ts', import.meta.url), 'utf8');
const fileTools = await readFile(new URL('../lib/tools/file.ts', import.meta.url), 'utf8');
const downloadRoute = await readFile(new URL('../app/api/artifacts/[id]/route.ts', import.meta.url), 'utf8');
const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const clientTypes = await readFile(new URL('../lib/agent-client.ts', import.meta.url), 'utf8');
const historyTypes = await readFile(new URL('../lib/client-history.ts', import.meta.url), 'utf8');

const load = createTsRequire(process.cwd());
const artifactFallback = load('./lib/agent/artifact-fallback');
const { historyArtifactFiles } = load('./lib/agent/artifact-references');
const artifacts = load('./lib/artifacts/index');
const artifactLimits = load('./lib/artifacts/limits');
const imageStorage = load('./lib/image-storage');
const artifactInfrastructure = {
  maxPerTurn: artifactLimits.ARTIFACT_MAX_PER_TURN,
  isValidArtifactId: artifacts.isValidArtifactId,
  getStorageRoots: imageStorage.getStorageRoots,
  generateDocumentArtifact: (input, options) => artifacts.generateDocumentArtifact(input, undefined, options),
  generateSpreadsheetArtifact: artifacts.generateSpreadsheetArtifact,
  generatePresentationArtifact: (input, options) => artifacts.generatePresentationArtifact(input, undefined, options),
  collectArchiveEntries: artifacts.collectArchiveEntries,
  generateArchiveArtifact: artifacts.generateArchiveArtifact,
};

test('artifact capability exposes dedicated Office and archive tools', () => {
  for (const tool of ['document_generate', 'spreadsheet_generate', 'presentation_generate', 'archive_generate']) {
    assert.match(artifactTools, new RegExp(`name: '${tool}'`));
  }
  assert.match(fileTools, /Word\/Excel\/PPT\/ZIP/);
});

test('artifact execution returns metadata and keeps binary content out of messages', async () => {
  const message = await load('./packages/tool-runtime/artifact-capability').executeArtifactCapability({
    state: { generatedFiles: [], generatedArtifactCount: 0 },
    call: { id: 'artifact-contract', function: { name: 'document_generate' } },
    args: { filename: 'contract.docx', markdown: '# contract' },
    signal: new AbortController().signal,
    infrastructure: artifactInfrastructure,
  });
  const payload = JSON.parse(String(message.content));
  assert.equal(payload.ok, true);
  assert.equal(typeof payload.file.artifactId, 'string');
  assert.equal(typeof payload.file.downloadUrl, 'string');
  assert.equal('content' in payload.file, false);
});

test('模型拒绝或不支持工具调用时，Office 兜底仍生成真实 Excel artifact', async () => {
  const call = artifactFallback.makeArtifactFallbackCall({
    kind: 'spreadsheet',
    content: '抱歉，我不能生成 Excel 文件，也不能提供附件。',
    fallbackContent: '请生成一个销售表格，包含产品、数量、金额和状态。',
    filenameHint: '销售数据.xlsx',
  });
  assert.ok(call);
  assert.equal(call.function.name, 'spreadsheet_generate');
  const args = JSON.parse(call.function.arguments);
  assert.equal(args.filename, '销售数据.xlsx');
  assert.deepEqual(args.sheets[0].columns.map((column) => column.header), ['产品', '数量', '金额', '状态']);

  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-agent-artifact-fallback-'));
  try {
    const store = artifacts.createArtifactStore({ root, cleanup: false });
    const message = await load('./packages/tool-runtime/artifact-capability').executeArtifactCapability({
      state: { generatedFiles: [], generatedArtifactCount: 0 },
      call,
      args,
      signal: new AbortController().signal,
      infrastructure: {
        ...artifactInfrastructure,
        generateSpreadsheetArtifact: (input) => artifacts.generateSpreadsheetArtifact(input, store),
      },
    });
    const payload = JSON.parse(String(message.content));
    assert.equal(payload.ok, true);
    assert.match(payload.file.name, /\.xlsx$/i);
    assert.ok(payload.file.artifactId);
    assert.ok(payload.file.size > 0);
    assert.equal('content' in payload.file, false);
    assert.ok(await store.read(payload.file.artifactId));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('模型正文中的 Markdown 表格会直接复用为 Excel 行列', () => {
  const call = artifactFallback.makeArtifactFallbackCall({
    kind: 'spreadsheet',
    content: '| 姓名 | 部门 |\n| --- | --- |\n| 张三 | 销售 |',
    fallbackContent: '请生成 Excel',
  });
  assert.ok(call);
  const args = JSON.parse(call.function.arguments);
  assert.deepEqual(args.sheets[0].columns.map((column) => column.header), ['姓名', '部门']);
  assert.deepEqual(args.sheets[0].rows, [{ 姓名: '张三', 部门: '销售' }]);
});

test('Word 和 PPT 在模型只返回拒绝文案时仍能形成可执行的 Office 调用', () => {
  const documentCall = artifactFallback.makeArtifactFallbackCall({
    kind: 'document',
    content: '抱歉，我无法提供 docx 附件。',
    fallbackContent: '请生成一份项目周报，包含本周完成事项和下周计划。',
  });
  const presentationCall = artifactFallback.makeArtifactFallbackCall({
    kind: 'presentation',
    content: '当前模型不支持 PPT 文件。',
    fallbackContent: '请制作一个产品介绍 PPT，包含产品定位和核心功能。',
  });
  assert.ok(documentCall);
  assert.ok(presentationCall);
  assert.equal(documentCall.function.name, 'document_generate');
  assert.equal(presentationCall.function.name, 'presentation_generate');
  const documentArgs = JSON.parse(documentCall.function.arguments);
  const presentationArgs = JSON.parse(presentationCall.function.arguments);
  assert.match(documentArgs.markdown, /项目周报/);
  assert.match(presentationArgs.markdown, /产品介绍/);
  assert.match(documentArgs.filename, /\.docx$/i);
  assert.match(presentationArgs.filename, /\.pptx$/i);
});

test('artifact download is authenticated and addressed by artifact id', () => {
  assert.match(downloadRoute, /isTrustedAppRequest\(request\)/);
  assert.match(downloadRoute, /buildArtifactResponse\(String\(id \|\| ''\)\)/);
  assert.doesNotMatch(downloadRoute, /searchParams\.get\('path'\)/);
});

test('client and history contracts preserve artifact references for later turns', () => {
  assert.match(clientTypes, /artifactId\?: string/);
  assert.match(historyTypes, /artifactId\?: string/);
  assert.match(historyTypes, /downloadUrl\?: string/);
  const result = historyArtifactFiles({
    role: 'assistant',
    files: [
      { name: 'contract.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', artifactId: 'artifact-1', size: 42 },
      { name: 'inline.txt', mimeType: 'text/plain', content: 'inline' },
    ],
  });
  assert.deepEqual(result, [{
    name: 'contract.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    artifactId: 'artifact-1',
    size: 42,
  }]);
  assert.doesNotMatch(page, /function historyArtifactFiles\(message\)/);
});
