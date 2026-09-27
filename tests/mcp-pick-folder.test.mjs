/**
 * 「选择文件夹」：授权目录不用手打路径，由本机服务端起系统原生选择框。
 *
 * 这层唯一要防的是「把外部输入拼进命令」和「弹不出来却假装成功」：
 * 前者靠命令常量 + 数组参数，后者靠取消/失败/超时三种结局分开处理。
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildMcpModule } from './tools-build.mjs';

const mcp = await buildMcpModule();
const route = await readFile(new URL('../app/api/mcp/pick-folder/route.ts', import.meta.url), 'utf8');
const toolsRoute = await readFile(new URL('../app/api/tools/route.ts', import.meta.url), 'utf8');
const panel = await readFile(new URL('../components/McpManager.tsx', import.meta.url), 'utf8');

/** 假的 spawn：只记下「打算用什么命令、什么参数」，不会真的弹窗。 */
function fakeSpawn(result = {}) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      // 真子进程被 kill 之后句柄就释放了，假 child 也要一样，否则事件循环会被一直吊着。
      if (child.keepAlive) clearTimeout(child.keepAlive);
    };
    if (result.hang) {
      // 真弹窗没关时，子进程句柄是活的、事件循环因此不空；假 child 得自己撑着。
      // 不然 unref 过的超时定时器根本没机会触发，测到的就不是「超时」而是「进程提前退出」。
      child.keepAlive = setTimeout(() => {}, 10_000);
    } else {
      setImmediate(() => {
        if (result.error) { child.emit('error', result.error); return; }
        if (result.stdout) child.stdout.emit('data', result.stdout);
        if (result.stderr) child.stderr.emit('data', result.stderr);
        child.emit('close', result.code ?? 0);
      });
    }
    return child;
  };
  return { spawnImpl, calls };
}

test('选择框按平台写死：Windows 走 PowerShell、macOS 走 osascript、其余走 zenity', () => {
  const win = mcp.folderPickerCommand('win32');
  assert.equal(win.command, 'powershell.exe');
  assert.deepEqual(win.args.slice(0, 2), ['-NoProfile', '-STA'], 'WinForms 对话框要在 STA 线程里开');
  assert.equal(win.args[2], '-Command');
  const script = win.args[3];
  // 中文路径经过管道默认按系统代码页编码，不设 UTF-8 Node 收到的就是乱码。
  assert.match(script, /\[Console\]::OutputEncoding=\[System\.Text\.Encoding\]::UTF8/);
  // 根目录不指到「此电脑」的话，默认根是桌面，用户找不到 D 盘。
  assert.match(script, /RootFolder=\[System\.Environment\+SpecialFolder\]::MyComputer/);
  assert.match(script, /SelectedPath=/);
  // 对话框要压在最前面，否则它可能开在浏览器后面，用户以为按钮没反应。
  assert.match(script, /\$owner\.TopMost=\$true/);
  assert.match(script, /ShowDialog\(\$owner\)/);
  assert.match(script, /\[Console\]::Out\.Write\(\$dialog\.SelectedPath\)/);

  const mac = mcp.folderPickerCommand('darwin');
  assert.equal(mac.command, 'osascript');
  assert.deepEqual(mac.args.slice(0, 1), ['-e']);
  assert.match(mac.args[1], /POSIX path of \(choose folder with prompt /);

  const linux = mcp.folderPickerCommand('linux');
  assert.equal(linux.command, 'zenity');
  assert.deepEqual(linux.args.slice(0, 2), ['--file-selection', '--directory']);
});

test('命令是常量：参数以数组给、不进 shell，用户选的路径只作为输出回来', async () => {
  const { spawnImpl, calls } = fakeSpawn({ stdout: 'D:\\资料\\项目\n' });
  const picked = await mcp.pickFolder({ platform: 'win32', spawnImpl });
  assert.deepEqual(picked, { path: 'D:\\资料\\项目' }, '末尾换行要去掉');
  assert.equal(calls.length, 1);
  assert.notEqual(calls[0].options?.shell, true, '不能走 shell，路径里的特殊字符才会是普通文本');
  assert.deepEqual(calls[0].args, mcp.folderPickerCommand('win32').args);
});

test('取消是正常操作：三个平台的取消形态都不报错', async () => {
  // Windows / macOS：关掉对话框，脚本不输出。
  const win = fakeSpawn({ code: 0, stdout: '' });
  assert.deepEqual(await mcp.pickFolder({ platform: 'win32', spawnImpl: win.spawnImpl }), { path: null });
  const mac = fakeSpawn({ code: 1, stderr: 'execution error: User canceled. (-128)\n' });
  assert.deepEqual(await mcp.pickFolder({ platform: 'darwin', spawnImpl: mac.spawnImpl }), { path: null });
  // zenity：取消时退 1，且什么都不说。
  const linux = fakeSpawn({ code: 1, stdout: '' });
  assert.deepEqual(await mcp.pickFolder({ platform: 'linux', spawnImpl: linux.spawnImpl }), { path: null });
});

test('弹不出来要说清原因：没装 zenity 时把人引到手填路径', async () => {
  const missing = Object.assign(new Error('spawn zenity ENOENT'), { code: 'ENOENT' });
  const linux = fakeSpawn({ error: missing });
  await assert.rejects(() => mcp.pickFolder({ platform: 'linux', spawnImpl: linux.spawnImpl }), /zenity/);
  const win = fakeSpawn({ error: Object.assign(new Error('spawn powershell.exe ENOENT'), { code: 'ENOENT' }) });
  await assert.rejects(() => mcp.pickFolder({ platform: 'win32', spawnImpl: win.spawnImpl }), /手填绝对路径/);
  // 脚本自己报错（比如没有桌面会话）时，原样把第一行递出去。
  const failed = fakeSpawn({ code: 1, stderr: '无法加载 Windows Forms\n第二行' });
  await assert.rejects(() => mcp.pickFolder({ platform: 'win32', spawnImpl: failed.spawnImpl }), /无法加载 Windows Forms/);
});

test('超时不会把请求挂死：杀掉子进程，按「什么都没选」处理', async () => {
  const { spawnImpl, calls } = fakeSpawn({ hang: true });
  const child = { killed: false };
  const wrapped = (command, args, options) => {
    const spawned = spawnImpl(command, args, options);
    child.killed = () => spawned.killed;
    return spawned;
  };
  assert.deepEqual(await mcp.pickFolder({ platform: 'win32', spawnImpl: wrapped, timeoutMs: 20 }), { path: null });
  assert.equal(calls.length, 1);
  assert.equal(child.killed(), true, '超时要把对话框进程关掉');
});

test('选择框只能回本机绝对路径，别的都拒绝', async () => {
  const relative = fakeSpawn({ stdout: '文档/项目' });
  await assert.rejects(() => mcp.pickFolder({ platform: 'win32', spawnImpl: relative.spawnImpl }), /绝对路径/);
});

test('弹窗只在本机开：路由挡住远程访问，也不给助手留入口', () => {
  assert.match(route, /if \(!isTrustedAppRequest\(request\) \|\| !isLoopbackRequest\(request\)\)/);
  assert.match(route, /export const runtime = 'nodejs';/);
  // 助手的 MCP 管理工具走 /api/tools 的白名单动作，弹窗不在里面：模型叫不出系统对话框。
  assert.doesNotMatch(toolsRoute, /pick-folder|pickFolder/);
  assert.doesNotMatch(panel, /action: 'pick-folder'/);
});

test('面板把「选择文件夹…」接在本机选择框上，并保留手填路径这条路', () => {
  assert.match(panel, /await requestJson\('\/api\/mcp\/pick-folder', \{ method: 'POST' \}\)/);
  assert.match(panel, /onClick=\{\(\) => void pickRootFolder\(\)\}/);
  assert.match(panel, /选完直接加入授权/);
  // 选完直接进授权清单，复用同一个 roots-add 动作，服务端照旧做完整校验。
  assert.match(panel, /await addRootPath\(picked\)/);
  assert.match(panel, /onClick=\{\(\) => void addRootPath\(suggestion\)\}/, '常用位置仍然是一键授权');
});
