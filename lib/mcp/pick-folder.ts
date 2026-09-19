/**
 * 「选择文件夹」：授权目录不用手打路径，直接叫出系统原生的选择框。
 *
 * 浏览器拿不到本机绝对路径（File System Access API 只给 handle，给不出 D:\文档），
 * 所以这件事只能由本机服务端做：起一个原生选择框，把用户选中的路径回给面板。
 *
 * 命令与脚本都是常量，参数以数组形式进 spawn、不走 shell，用户选的路径只作为**输出**回来，
 * 不会回填进任何命令——路径里有引号、& 、空格都只是普通文本。
 *
 * 选择框弹在跑服务的那台机器上，所以路由只认本机请求（见 app/api/mcp/pick-folder/route.ts）。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

export type FolderPickOptions = { platform?: string; spawnImpl?: typeof spawn; timeoutMs?: number };
export type FolderPickResult = { path: string | null };

const PICKER_TITLE = '选择要授权给助手的文件夹';

/**
 * Windows 用 .NET 的 FolderBrowserDialog：
 * - RootFolder 指到「此电脑」、SelectedPath 落在用户主目录，否则默认根是桌面，用户找不到 D 盘；
 * - 那个 1x1 的隐藏 owner 窗体是为了让对话框弹在最前面，不然它可能开在浏览器后面，用户以为按钮坏了；
 * - [Console]::OutputEncoding 必须先设 UTF-8：管道里的中文路径默认按系统代码页编码，Node 收到就是乱码。
 */
const WINDOWS_SCRIPT = [
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -AssemblyName System.Drawing',
  '$owner=New-Object System.Windows.Forms.Form',
  '$owner.TopMost=$true',
  '$owner.ShowInTaskbar=$false',
  '$owner.FormBorderStyle="None"',
  '$owner.Size=New-Object System.Drawing.Size(1,1)',
  '$owner.StartPosition="CenterScreen"',
  '$null=$owner.Show()',
  '$dialog=New-Object System.Windows.Forms.FolderBrowserDialog',
  `$dialog.Description="${PICKER_TITLE}"`,
  '$dialog.RootFolder=[System.Environment+SpecialFolder]::MyComputer',
  '$dialog.SelectedPath=[System.Environment]::GetFolderPath("UserProfile")',
  '$dialog.ShowNewFolderButton=$true',
  'if($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Out.Write($dialog.SelectedPath)}',
  '$owner.Close()',
].join('; ');

/** 各平台的选择框写死；顺序与参数都不接受调用方拼装。 */
export function folderPickerCommand(platform: string = process.platform) {
  if (platform === 'win32') return { command: 'powershell.exe', args: ['-NoProfile', '-STA', '-Command', WINDOWS_SCRIPT] };
  if (platform === 'darwin') return { command: 'osascript', args: ['-e', `POSIX path of (choose folder with prompt "${PICKER_TITLE}")`] };
  return { command: 'zenity', args: ['--file-selection', '--directory', `--title=${PICKER_TITLE}`] };
}

type PickerRun = { code: number | null; stdout: string; stderr: string; failure: Error | null; timedOut: boolean };

/**
 * 等选择框关掉再回话。用户可能去泡杯咖啡，但请求不能永久挂着：超时就杀掉子进程，
 * 面板那一侧拿到的和「取消」一样（什么都没选），按钮不会一直转。
 */
function runPicker(spawnImpl: typeof spawn, command: string, args: string[], timeoutMs: number) {
  return new Promise<PickerRun>((resolve) => {
    let child;
    try {
      child = spawnImpl(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: '', failure: error instanceof Error ? error : new Error('打不开系统选择框'), timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value: PickerRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 进程可能已经退出了 */ }
      finish({ code: null, stdout, stderr, failure: null, timedOut: true });
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', (error) => finish({ code: null, stdout, stderr, failure: error instanceof Error ? error : new Error('打不开系统选择框'), timedOut: false }));
    child.once('close', (code) => finish({ code, stdout, stderr, failure: null, timedOut: false }));
  });
}

/**
 * 返回选中的绝对路径；用户点了取消就是 { path: null }——取消是正常操作，不该报错。
 * 命令不存在、脚本报错这类才抛出来，让面板说清「为什么没弹窗」，并把人引到手填路径。
 */
export async function pickFolder(options: FolderPickOptions = {}): Promise<FolderPickResult> {
  const platform = options.platform || process.platform;
  const { command, args } = folderPickerCommand(platform);
  const result = await runPicker(options.spawnImpl || spawn, command, args, options.timeoutMs ?? 5 * 60_000);
  if (result.timedOut) return { path: null };
  if (result.failure) {
    if ((result.failure as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(platform === 'linux'
        ? `系统里没有 ${command}，装一个（例如 sudo apt install zenity）或直接手填绝对路径。`
        : '找不到系统选择框，直接手填绝对路径吧。');
    }
    throw new Error(result.failure.message || '打不开系统选择框');
  }
  const picked = result.stdout.trim();
  if (picked) {
    // 选择框只可能回本机路径；真收到相对路径说明这条路子被人接了，宁可不加。
    if (!path.isAbsolute(picked)) throw new Error('系统选择框回了一个无效路径，请手填绝对路径。');
    return { path: picked };
  }
  // 取消在各平台表现不一样：Windows/macOS 退 0 或报 User canceled，zenity 直接退 1 且什么都不输出。
  if (result.code === 0 || /cancel/i.test(result.stderr) || !result.stderr.trim()) return { path: null };
  throw new Error(`系统选择框没打开：${result.stderr.trim().split('\n')[0]}`);
}
