/**
 * Filesystem 目录：授权清单 + 路径策略。
 *
 * 这层是「本地文件」服务真正的边界：服务端的 allowed-directories 只能证明它自己没越界，
 * 证明不了模型这次给的路径正好是用户想开放的那棵树。所以测试也按这两件事分开写。
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildMcpModule } from './tools-build.mjs';

const mcp = await buildMcpModule();
const agentRoute = await readFile(new URL('../app/api/agent/route.ts', import.meta.url), 'utf8');
const resume = await readFile(new URL('../lib/agent/resume.ts', import.meta.url), 'utf8');
const toolsRoute = await readFile(new URL('../app/api/tools/route.ts', import.meta.url), 'utf8');

async function withTemp(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-fs-policy-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

test('常用位置只建议桌面/文档/下载，且不重复已授权的目录', async () => {
  await withTemp(async (home) => {
    await mkdir(path.join(home, 'Desktop'), { recursive: true });
    await mkdir(path.join(home, 'Documents'), { recursive: true });
    await mkdir(path.join(home, 'Downloads'), { recursive: true });
    // 主目录本身、以及同名文件都不该被建议：一键把整个用户目录交出去比用户想给的大。
    await mkdir(path.join(home, 'Pictures'), { recursive: true });
    await writeFile(path.join(home, 'Videos'), 'not a folder');

    const suggestions = mcp.suggestFilesystemRoots({ home });
    assert.deepEqual(suggestions.map((item) => path.basename(item)).sort(), ['Desktop', 'Documents', 'Downloads']);
    assert.equal(suggestions.some((item) => item === home), false, '不要建议整个主目录');

    const filtered = mcp.suggestFilesystemRoots({ home, excluded: [path.join(home, 'Downloads')] });
    assert.equal(filtered.some((item) => path.basename(item) === 'Downloads'), false);

    assert.deepEqual(mcp.suggestFilesystemRoots({ home: path.join(home, '不存在的目录') }), []);
  });
});

/** 造一个「授权目录 + 数据目录」的完整场景。 *//** 造一个「授权目录 + 数据目录」的完整场景。 */
async function withScene(run) {
  await withTemp(async (base) => {
    const dataDir = path.join(base, 'data');
    const root = path.join(base, 'docs');
    await mkdir(dataDir, { recursive: true });
    await mkdir(path.join(root, 'sub'), { recursive: true });
    await writeFile(path.join(root, 'note.txt'), 'hello\n');
    await writeFile(path.join(root, 'sub', 'deep.txt'), 'deep\n');
    await writeFile(path.join(root, '.env'), 'TOKEN=1\n');
    await writeFile(path.join(root, 'id_rsa'), 'PRIVATE\n');
    await writeFile(path.join(dataDir, 'mcp', 'servers.json'), '{}\n').catch(async () => {
      await mkdir(path.join(dataDir, 'mcp'), { recursive: true });
      await writeFile(path.join(dataDir, 'mcp', 'servers.json'), '{}\n');
    });
    return run({ base, dataDir, root });
  });
}

/** 造出「已经装好」的假安装目录：没装好的条目本来就不该出现在工具表里。 */
async function fakeInstall(dataDir) {
  const file = path.join(dataDir, 'mcp', 'filesystem', 'node_modules', '@modelcontextprotocol', 'server-filesystem', 'dist', 'index.js');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '// fake\n');
}

test('授权目录：只接受已存在的绝对路径文件夹，应用数据目录不许授权', async () => {
  await withScene(async ({ dataDir, root }) => {
    assert.deepEqual(mcp.listFilesystemRoots({ dataDir }), []);
    assert.deepEqual(mcp.addFilesystemRoot(root, { dataDir }), [root], 'normalize 之后的路径才是授权值');
    assert.deepEqual(mcp.listFilesystemRoots({ dataDir }), [root]);
    // 幂等：同一个目录点两次不会变成两条。
    assert.deepEqual(mcp.addFilesystemRoot(root, { dataDir }), [root]);
    assert.deepEqual(mcp.addFilesystemRoot(`${root}${path.sep}`, { dataDir }), [root]);

    assert.throws(() => mcp.addFilesystemRoot('docs', { dataDir }), /绝对路径/);
    assert.throws(() => mcp.addFilesystemRoot(path.join(root, 'note.txt'), { dataDir }), /只能授权文件夹/);
    assert.throws(() => mcp.addFilesystemRoot(path.join(root, 'missing'), { dataDir }), /找不到这个文件夹/);
    assert.throws(() => mcp.addFilesystemRoot(path.parse(root).root, { dataDir }), /磁盘根目录/);
    assert.throws(() => mcp.addFilesystemRoot(path.join(dataDir, 'mcp'), { dataDir }), /应用自己的数据目录/);

    assert.deepEqual(mcp.removeFilesystemRoot(root, { dataDir }), []);
    assert.deepEqual(mcp.listFilesystemRoots({ dataDir }), []);
  });
});

test('路径策略：授权目录里放行，越界与 `..` 一律拒绝', async () => {
  await withScene(async ({ base, dataDir, root }) => {
    const roots = [root];
    const options = { roots, dataDir };
    assert.equal(mcp.filesystemPathProblem(path.join(root, 'note.txt'), options), null);
    assert.equal(mcp.filesystemPathProblem(path.join(root, 'sub', 'deep.txt'), options), null);
    assert.equal(mcp.filesystemPathProblem(path.join(root, 'new-file.txt'), options), null, '还不存在的文件也要能写');
    assert.match(String(mcp.filesystemPathProblem(path.join(base, 'outside.txt'), options)), /不在授权文件夹里/);
    assert.match(String(mcp.filesystemPathProblem(path.join(root, '..', 'outside.txt'), options)), /不在授权文件夹里/);
    assert.match(String(mcp.filesystemPathProblem(path.join(root, 'sub', '..', '..', 'outside.txt'), options)), /不在授权文件夹里/);
    assert.match(String(mcp.filesystemPathProblem('note.txt', options)), /绝对路径/);
    // .env 不是「永远不给读」，而是要走一次用户确认，所以这里只判「是否需要确认」。
    assert.equal(mcp.filesystemPathProblem(path.join(root, '.env'), options), null);
    assert.match(String(mcp.filesystemApprovalReason(path.join(root, '.env'), options)), /敏感配置文件/);
    assert.match(String(mcp.filesystemPathProblem(path.join(root, 'id_rsa'), options)), /凭据\/私钥类文件/);
    assert.match(String(mcp.filesystemPathProblem(path.join(dataDir, 'mcp', 'servers.json'), { roots: [dataDir], dataDir })), /凭据|数据目录/);
    assert.match(String(mcp.filesystemPathProblem(path.join(root, 'note.txt'), { roots: [], dataDir })), /还没有授权任何文件夹/);
  });
});

test('符号链接指向授权目录之外时，realpath 之后必须拒绝', async (t) => {
  await withScene(async ({ base, dataDir, root }) => {
    const outside = path.join(base, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'secret.txt'), 'secret\n');
    const link = path.join(root, 'link');
    try {
      await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      t.skip('当前环境不允许建符号链接/junction，跳过');
      return;
    }
    assert.match(String(mcp.filesystemPathProblem(path.join(link, 'secret.txt'), { roots: [root], dataDir })), /不在授权文件夹里/);
    // 反向也要成立：从外面指向授权目录里的软链，路径本身在授权目录之外，同样拒绝。
    const reverse = path.join(base, 'reverse');
    try {
      await symlink(root, reverse, process.platform === 'win32' ? 'junction' : 'dir');
      assert.match(String(mcp.filesystemPathProblem(path.join(reverse, 'note.txt'), { roots: [root], dataDir })), /不在授权文件夹里/);
    } catch {}
  });
});

test('敏感配置：读 .env 要用户确认，私钥直接拒绝', async () => {
  await withScene(async ({ dataDir, root }) => {
    const options = { roots: [root], dataDir };
    // .env 放行但要带理由：agent 路由据此走一次确认，不能默默读进上下文。
    const env = mcp.guardFilesystemCall({ path: path.join(root, '.env') }, options);
    assert.equal(env.ok, true);
    assert.match(String(env.approval), /敏感配置文件/);
    assert.equal(mcp.filesystemApprovalReason(path.join(root, 'note.txt'), options), null);

    const key = mcp.guardFilesystemCall({ path: path.join(root, 'id_rsa') }, options);
    assert.equal(key.ok, false);
    assert.match(key.error, /凭据\/私钥类文件/);

    const read = mcp.guardFilesystemCall({ path: path.join(root, 'note.txt') }, options);
    assert.equal(read.ok, true);
    assert.equal(read.approval, null);

    const multi = mcp.guardFilesystemCall({ paths: [path.join(root, 'note.txt'), path.join(root, '..', 'x')] }, options);
    assert.equal(multi.ok, false, '批量路径里只要有一个越界就整次拒绝');
  });
});

test('浏览器上传：只能用授权目录或应用自己产出的文件', async () => {
  await withScene(async ({ base, dataDir, root }) => {
    const options = { roots: [root], dataDir };
    const media = path.join(dataDir, 'media');
    await mkdir(media, { recursive: true });
    await writeFile(path.join(media, 'shot.png'), 'x');
    await writeFile(path.join(base, 'other.txt'), 'x');

    assert.equal(mcp.guardUploadCall({ paths: [path.join(root, 'note.txt')] }, options).ok, true);
    assert.equal(mcp.guardUploadCall({ paths: [path.join(media, 'shot.png')] }, options).ok, true);
    assert.equal(mcp.guardUploadCall({ paths: [path.join(base, 'other.txt')] }, options).ok, false);
    assert.equal(mcp.guardUploadCall({ paths: [path.join(root, '.env')] }, options).ok, false, '凭据文件不许上传');
    assert.equal(mcp.guardUploadCall({ paths: ['note.txt'] }, options).ok, false);
    assert.equal(mcp.guardUploadCall({}, options).ok, false);
    // 只有浏览器上传走这条规则，其他浏览器工具不受影响。
    assert.equal(mcp.guardMcpServerCall({ catalogId: 'playwright' }, 'browser_navigate', { url: 'https://x' }, options).ok, true);
    assert.equal(mcp.guardMcpServerCall({ catalogId: 'playwright' }, 'browser_file_upload', { paths: [path.join(base, 'other.txt')] }, options).ok, false);
    assert.equal(mcp.guardMcpServerCall({ id: 'my-remote' }, 'read_file', { path: 'whatever' }, options).ok, true, '用户自己配的服务不在这层职责里');
  });
});

test('没有授权目录时 Filesystem 不进工具表，授权后带上目录启动参数', async () => {
  await withScene(async ({ dataDir, root }) => {
    assert.equal(mcp.listMcpServers({ dataDir }).some((server) => server.id === 'filesystem'), false);
    mcp.setCatalogEntryEnabled('filesystem', true, { dataDir });
    assert.equal(mcp.listCatalogServers({ dataDir }).length, 0, '开了开关但没授权目录：不进工具表');
    await fakeInstall(dataDir);
    const servers = mcp.listCatalogServers({ dataDir, roots: [root] });
    assert.equal(servers.length, 1);
    assert.equal(servers[0].catalogId, 'filesystem');
    assert.deepEqual(servers[0].args.slice(-1), [root]);
    // store 层会给 roots 补默认值：漏传的调用方拿到的也是同一份授权清单。
    assert.equal(mcp.listMcpServers({ dataDir }).length, 0, '默认从本地授权清单读，此时清单是空的');
    mcp.addFilesystemRoot(root, { dataDir });
    assert.equal(mcp.listMcpServers({ dataDir }).some((server) => server.id === 'filesystem'), true);
  });
});

test('授权目录变化后，read/resume/tools 三处都要走同一套路径策略', () => {
  assert.match(agentRoute, /const guard = guardMcpCall\(mcpGuardMeta, args\);/);
  assert.match(agentRoute, /sensitiveHint: mcpGuardApproval/);
  assert.match(agentRoute, /const mcpFilesystemRoots = listFilesystemRoots\(\);/);
  assert.match(resume, /const guardOptions = \{ roots: listFilesystemRoots\(\), dataDir: resolveLocalDataDir\(\) \};/);
  assert.equal((resume.match(/guardMcpServerCall\(server, meta\.toolName, args, guardOptions\)/g) || []).length, 2);
  assert.match(toolsRoute, /if \(action === 'roots-add'\) addFilesystemRoot\(data\?\.path\);/);
  assert.match(toolsRoute, /closeStdioServer\('filesystem'\);/);
});
