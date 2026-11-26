import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

test('reviewed file edit and undo report actual outcomes without using a model', async (t) => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'sanmao-resume-reviewed-edit-'));
  const oldDataDir = process.env.SANMAO_DATA_DIR;
  const dataDir = path.join(temp, 'data');
  process.env.SANMAO_DATA_DIR = dataDir;
  t.after(() => {
    if (oldDataDir === undefined) delete process.env.SANMAO_DATA_DIR;
    else process.env.SANMAO_DATA_DIR = oldDataDir;
    rmSync(temp, { recursive: true, force: true });
  });
  const root = path.join(temp, 'source');
  const target = path.join(root, 'file.txt');
  const unrelated = path.join(root, 'user-draft.txt');
  const original = 'initial line\r\nkeep this line\r\n';
  mkdirSync(root);
  writeFileSync(target, original);
  writeFileSync(unrelated, 'unsaved work\r\n');

  let modelCalls = 0;
  const server = { id: 'filesystem', catalogId: 'filesystem', name: 'Fixture Filesystem', transport: 'stdio', enabled: true, allowWrite: true };
  const tool = {
    id: 'mcp:filesystem:edit_file', name: 'filesystem__edit_file', source: 'mcp',
    risk: 'external_side_effect', mcp: { serverId: 'filesystem', toolName: 'edit_file', serverName: server.name, readOnly: false, blocked: false },
  };
  const loadTs = createTsRequire(process.cwd(), {
    '@/lib/runtime-operation': { beginRuntimeRequest: async () => async () => {} },
    '@/lib/providers': { chatCompletion: async () => {
      modelCalls += 1;
      assert.fail('reviewed file edits and undo do not call the model');
    } },
    '@/lib/store': { getRuntimeModel: async () => ({ provider: 'test', model: { rawId: 'test-model', maxInputTokens: 6000 } }) },
    '@/lib/mcp/client': {
      MCP_TOOL_MAX_CALLS_PER_TURN: 8, MCP_TURN_TIME_BUDGET_MS: 60000,
      callMcpTool: async () => assert.fail('reviewed edits use the local filesystem adapter'),
    },
    '@/lib/mcp/catalog-remote': { noteRemoteCatalogCallFailure() {}, noteRemoteCatalogCallSuccess() {} },
    '@/lib/mcp/store': { listMcpServers: () => [server] },
    '@/lib/mcp/tools': { lazyMcpGroupKeywords: () => ({}), loadMcpToolRuntime: async () => ({ servers: [server], tools: [tool] }) },
    '@/lib/tools/selector': { selectToolsForTurn: () => [] },
    '@/lib/tools/policy': { resolveToolPolicy: (name) => ({ allowed: name === tool.name, tool: name === tool.name ? tool : null }) },
    '@/lib/mcp/audit': { recordMcpCall() {} },
    '@/lib/tabbit-cli': { isTabbitCliAvailable: () => false },
    '@/lib/tools': { tabbitBrowserTool: null },
  });
  const approval = loadTs('./lib/agent/approval');
  const filesystem = loadTs('./lib/mcp/filesystem-roots');
  const { prepareFilesystemEdit } = loadTs('./lib/mcp/filesystem-edit');
  const { POST } = loadTs('./app/api/agent/runs/[id]/route');
  filesystem.addFilesystemRoot(root, { dataDir, write: true });

  async function request(id, action) {
    const response = await POST(new Request(`http://127.0.0.1/api/agent/runs/${id}`, { method: 'POST', body: JSON.stringify({ action }) }), { params: Promise.resolve({ id }) });
    return { status: response.status, body: await response.json() };
  }

  function prepareApproval() {
    const args = { path: target, edits: [{ oldText: 'initial line', newText: 'corrected line' }] };
    const prepared = prepareFilesystemEdit(args, { roots: [root], writeRoots: [root], dataDir });
    assert.equal(prepared.ok, true);
    const call = { callId: 'edit', name: tool.name, toolId: tool.id, ...tool.mcp, risk: 'external_side_effect', reason: 'fixture', args, filesystemEdit: prepared.approval };
    return approval.createApproval({
      provider: 'test', model: 'test-model', gating: {}, messages: [{ role: 'user', content: 'Edit the local fixture.' }],
      assistant: { content: null, tool_calls: [{ id: call.callId, type: 'function', function: { name: call.name, arguments: JSON.stringify(args) } }] },
      pending: [call], executed: [],
    }, { dataDir });
  }

  async function approve() {
    const record = prepareApproval();
    assert.equal(readFileSync(target, 'utf8'), original);
    const { status, body } = await request(record.id, 'approve');
    assert.equal(status, 200);
    assert.equal(body.mcpTools[0].ok, true);
    assert.equal(body.message, '已写入本次文件修改，可点击下方按钮撤销。');
    assert.deepEqual(readFileSync(target), Buffer.from(original.replace('initial line', 'corrected line')));
    const [receipt] = body.filesystemUndos;
    assert.match(receipt.id, /^undo_[a-f0-9]{32}$/);
    assert.equal(receipt.path, target);
    assert.ok(receipt.expiresAt > Date.now());
    return receipt.id;
  }
  const first = await approve();
  const attempts = await Promise.all([request(first, 'undo'), request(first, 'undo')]);
  assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 404]);
  assert.equal(attempts.find((response) => response.status === 200)?.body.message, '已撤销这次文件编辑。');
  assert.deepEqual(readFileSync(target), Buffer.from(original));
  assert.equal(readFileSync(unrelated, 'utf8'), 'unsaved work\r\n');

  const stale = prepareApproval();
  appendFileSync(target, 'saved after preview\r\n');
  const changedAfterPreview = readFileSync(target);
  const staleApproval = await request(stale.id, 'approve');
  assert.equal(staleApproval.status, 200);
  assert.equal(staleApproval.body.mcpTools[0].ok, false);
  assert.equal(staleApproval.body.message, '文件在预览后已发生变化，本次没有写入。请重新生成预览再确认。');
  assert.equal(staleApproval.body.filesystemUndos, undefined);
  assert.deepEqual(readFileSync(target), changedAfterPreview);

  writeFileSync(target, original);

  const second = await approve();
  appendFileSync(target, 'another editor saved\r\n');
  const externalVersion = readFileSync(target);
  const conflict = await request(second, 'undo');
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /编辑后已发生变化/);
  assert.equal(conflict.body.consumed, true);
  assert.deepEqual(readFileSync(target), externalVersion);
  const conflictRetry = await request(second, 'undo');
  assert.equal(conflictRetry.status, 404);
  assert.equal(conflictRetry.body.consumed, true);
  assert.deepEqual(readFileSync(target), externalVersion);

  writeFileSync(target, original);
  const third = await approve();
  const applied = readFileSync(target);
  filesystem.setFilesystemRootWrite(root, false, { dataDir });
  const revoked = await request(third, 'undo');
  assert.equal(revoked.status, 409);
  assert.match(revoked.body.error, /授权目录打开写入/);
  assert.equal(revoked.body.consumed, true);
  assert.deepEqual(readFileSync(target), applied);
  assert.equal(modelCalls, 0);
});
