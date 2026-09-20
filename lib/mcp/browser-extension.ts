/**
 * 「接我日常的浏览器」真正落地需要三件事：找到用户实际在用的那个浏览器、
 * 判断它的 profile 里装没装官方扩展、把上游那句英文报错翻成能照着做的中文。
 *
 * 背景（本机踩到的坑）：Playwright MCP 的 --extension 默认只在 Chrome 的
 * `%LOCALAPPDATA%\Google\Chrome\User Data`（或 Edge 的对应目录）里找扩展。
 * 用户在别的 Chromium（Tabbit、Brave、Vivaldi…）里装了扩展时，
 * 「我明明装了」和「未检测到扩展」会同时成立。这里不再让它去猜：
 * 可执行文件交给 --executable-path，扩展装没装由我们先查一遍。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** 官方 Playwright 扩展的固定 id：商店链接和 profile 里的目录名都用它。 */
export const PLAYWRIGHT_EXTENSION_ID = 'mmlmfjhmonkocbjadbfplnigmagldckm';

/** 扩展页给的是 `PLAYWRIGHT_MCP_EXTENSION_TOKEN=xxx` 这一整行，配上它连接页不再要人点确认。 */
export const PLAYWRIGHT_EXTENSION_TOKEN_ENV = 'PLAYWRIGHT_MCP_EXTENSION_TOKEN';

/** 浏览器路径是怎么来的：用户手填 / 系统默认浏览器 / 我们的候选清单。 */
export type McpBrowserSource = 'override' | 'default' | 'candidate' | 'none';

export type McpBrowserExecutable = {
  /** 可执行文件绝对路径；null 表示这台机器上没找到能接的浏览器。 */
  path: string | null;
  /** 面板显示用的名字，例如「Google Chrome」「Tabbit Browser」。 */
  name: string;
  source: McpBrowserSource;
};

/**
 * 浏览器那一侧的扩展状态。
 * extensionInstalled 为 null 表示「推不出 profile 目录，无法确认」，不等于「没装」——
 * 这两种情况在面板上要说不同的话，否则又是一次「我明明装了」。
 */
export type McpBrowserExtensionBridge = {
  browserName: string;
  executablePath: string | null;
  source: McpBrowserSource;
  /** 按安装位置推出来的 profile 根目录；推不出来就是 null。 */
  userDataDir: string | null;
  extensionInstalled: boolean | null;
  /** 免点击连接码配好了没有；值本身永远不回传前端。 */
  tokenConfigured: boolean;
};

/** 执行外部命令：找不到命令、超时、非零退出都按「没有答案」处理，不抛。 */
type CommandRunner = (file: string, args: readonly string[]) => string | null;

/** Windows 的 reg.exe 使用系统代码页输出；中文路径不能强制按 UTF-8 解码。 */
export function decodeWindowsCommandOutput(value: Uint8Array | string): string {
  if (typeof value === 'string') return value;
  if (!value.length) return '';
  if (value[0] === 0xff && value[1] === 0xfe) return new TextDecoder('utf-16le').decode(value);
  if (value[0] === 0xfe && value[1] === 0xff) return new TextDecoder('utf-16be').decode(value);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    return new TextDecoder('gb18030').decode(value);
  }
}

const runCommand: CommandRunner = (file, args) => {
  try {
    const output = execFileSync(file, [...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return decodeWindowsCommandOutput(output);
  } catch {
    return null;
  }
};

const WINDOWS_URL_ASSOC_KEY = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice';

/**
 * 从「打开方式」命令里取出可执行文件。
 * 两种写法都要认：`"C:\…\Tabbit Browser.exe" --single-argument %1` 和 `C:\…\chrome.exe -- "%1"`。
 */
export function parseExecutableFromCommand(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const quoted = /^"([^"]+)"/.exec(text);
  if (quoted) return quoted[1];
  const withExtension = /^(.+?\.(?:exe|com|bat|cmd|sh|bin|app))(?=\s|$)/i.exec(text);
  if (withExtension) return withExtension[1];
  return text.split(/\s+/)[0] || null;
}

/** 浏览器名字：认得出的用常用名，其余用文件名（Tabbit Browser.exe → Tabbit Browser）。 */
export function browserNameFromPath(file: unknown): string {
  const base = path.basename(String(file ?? ''));
  if (!base) return '';
  const known: Record<string, string> = {
    'chrome.exe': 'Google Chrome',
    'msedge.exe': 'Microsoft Edge',
    'brave.exe': 'Brave',
    'chromium.exe': 'Chromium',
    'vivaldi.exe': 'Vivaldi',
    'google chrome': 'Google Chrome',
    'microsoft edge': 'Microsoft Edge',
    'brave browser': 'Brave',
    chromium: 'Chromium',
    vivaldi: 'Vivaldi',
  };
  const key = base.toLowerCase().replace(/\.(exe|app)$/, '');
  return known[base.toLowerCase()] || known[key] || base.replace(/\.(exe|app)$/i, '');
}

/** Windows：HKCU 的 http 关联 → ProgId → 它的「打开方式」命令行。 */
function readWindowsDefaultBrowser(run: CommandRunner): string | null {
  const choice = run('reg.exe', ['query', WINDOWS_URL_ASSOC_KEY, '/v', 'ProgId']);
  const progId = /ProgId\s+REG_SZ\s+(.+)/.exec(choice || '')?.[1]?.trim();
  if (!progId) return null;
  const command = run('reg.exe', ['query', `HKCR\\${progId}\\shell\\open\\command`, '/ve']);
  // `/ve` 的值行会带 `(Default) REG_SZ` 前缀；类型匹配不能锚定行首。
  return parseExecutableFromCommand(/REG_(?:EXPAND_)?SZ\s+(.+)/.exec(command || '')?.[1]);
}

/** macOS：LaunchServices 的 plist 文本里找 http handler 对应的 app。 */
const MAC_BROWSER_APPS: Record<string, string> = {
  'com.google.chrome': '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'com.microsoft.edgemac': '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'com.brave.browser': '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  'org.chromium.chromium': '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'com.vivaldi.vivaldi': '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
  'company.thebrowser.browser': '/Applications/Arc.app/Contents/MacOS/Arc',
};

function readMacDefaultBrowser(run: CommandRunner): string | null {
  const out = run('/usr/bin/defaults', ['read', 'com.apple.LaunchServices/com.apple.launchservices.secure']);
  if (!out) return null;
  // 输出是一段 plist 文本：一个 handler 一段，找 LSHandlerURLScheme = http 那段里的 LSHandlerRoleAll。
  for (const block of out.split('}')) {
    if (!/LSHandlerURLScheme\s*=\s*"?https?"?\s*;/.test(block)) continue;
    const bundle = /LSHandlerRoleAll\s*=\s*"?([\w.-]+)"?\s*;/.exec(block)?.[1]?.toLowerCase();
    const app = bundle ? MAC_BROWSER_APPS[bundle] : '';
    if (app && existsSync(app)) return app;
  }
  return null;
}

/** Linux：xdg 的默认浏览器 desktop 文件 → Exec=。 */
function readLinuxDefaultBrowser(run: CommandRunner): string | null {
  const desktop = (run('xdg-settings', ['get', 'default-web-browser']) || run('xdg-mime', ['query', 'default', 'x-scheme-handler/http']) || '').trim();
  if (!desktop) return null;
  const home = process.env.HOME || '';
  const files = [
    home ? path.join(home, '.local', 'share', 'applications', desktop) : '',
    path.join('/usr/share/applications', desktop),
    path.join('/usr/local/share/applications', desktop),
  ].filter(Boolean);
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      const exec = /^Exec=(\S+)/m.exec(readFileSync(file, 'utf8'))?.[1];
      if (exec) return exec;
    } catch {
      // 读不了这个 desktop 文件就换下一个位置。
    }
  }
  return null;
}

/**
 * 系统默认浏览器的可执行文件；认不出来返回 null，由调用方退回候选清单。
 * 认出来的路径必须真的存在：注册表里经常留着已经卸载的浏览器。
 */
export function detectDefaultBrowserExecutable(
  platform: string = process.platform,
  run: CommandRunner = runCommand,
): string | null {
  const raw = platform === 'win32'
    ? readWindowsDefaultBrowser(run)
    : platform === 'darwin'
      ? readMacDefaultBrowser(run)
      : platform === 'linux'
        ? readLinuxDefaultBrowser(run)
        : null;
  const file = parseExecutableFromCommand(raw);
  return file && existsSync(file) ? file : null;
}

/**
 * 按安装位置推 profile 根目录。
 * 只有 Windows 是这个规律（`…\Google\Chrome\Application\chrome.exe` → `…\Google\Chrome\User Data`）；
 * macOS / Linux 每个浏览器的 profile 位置都不一样，与其猜错不如说「无法确认」。
 */
export function resolveUserDataDir(executablePath: unknown, platform: string = process.platform): string | null {
  if (platform !== 'win32') return null;
  const file = String(executablePath ?? '').trim();
  if (!file) return null;
  const appDir = path.dirname(file);
  const candidates = [path.join(path.dirname(appDir), 'User Data'), path.join(appDir, 'User Data')];
  return candidates.find((dir) => existsSync(dir)) ?? null;
}

/** Chrome 系的 profile 目录名只有 Default 和 Profile N 两种（和 Playwright 自己的判断一致）。 */
export function listBrowserProfiles(userDataDir: string): string[] {
  try {
    return readdirSync(userDataDir)
      .filter((entry) => entry === 'Default' || /^Profile \d+$/.test(entry))
      .sort((a, b) => profileRank(a) - profileRank(b));
  } catch {
    return [];
  }
}

function profileRank(profile: string) {
  return profile === 'Default' ? -1 : Number.parseInt(profile.slice('Profile '.length), 10);
}

/**
 * 两个目录是不是同一棵 profile 树。
 * 报错里的那段目录是 Playwright 自己拼的，写法可能和我们的不一样（长路径前缀、大小写、
 * 结尾斜杠），所以按规范化之后的前缀关系比：同一条路径、或一个是另一个的上级都算同一棵。
 */
export function sameProfileTree(a: unknown, b: unknown): boolean {
  const norm = (value: unknown) => {
    const text = String(value ?? '').trim();
    if (!text) return '';
    const resolved = path.resolve(text).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return false;
  return left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
}

/** 某个 profile 里装没装扩展：认 Extensions 目录，也认 Preferences 里的记录。 */
export function profileHasPlaywrightExtension(profileDir: string): boolean {
  if (existsSync(path.join(profileDir, 'Extensions', PLAYWRIGHT_EXTENSION_ID))) return true;
  for (const name of ['Preferences', 'Secure Preferences']) {
    const file = path.join(profileDir, name);
    if (!existsSync(file)) continue;
    try {
      const prefs = JSON.parse(readFileSync(file, 'utf8')) as { extensions?: { settings?: Record<string, unknown> } };
      const record = prefs?.extensions?.settings?.[PLAYWRIGHT_EXTENSION_ID];
      if (record && typeof record === 'object' && Object.keys(record).length) return true;
    } catch {
      // 这个偏好文件读坏了不代表没装：接着看下一个。
    }
  }
  return false;
}

/** true/false 是确定结论；null 表示 profile 目录推不出来，无法确认。 */
export function extensionInstalledForBrowser(
  executablePath: unknown,
  platform: string = process.platform,
): boolean | null {
  const userDataDir = resolveUserDataDir(executablePath, platform);
  if (!userDataDir) return null;
  return listBrowserProfiles(userDataDir).some((profile) => profileHasPlaywrightExtension(path.join(userDataDir, profile)));
}

const EXTENSION_NOT_FOUND = /Playwright Extension not found in "?([^"\n]*)"?/;
const EXTENSION_NOT_CONNECTED = /Playwright extension did not connect within ([\d.]+)s/i;
const BROWSER_CHANNEL_MISSING = /"(?:chrome|msedge)" executable not found|Unsupported channel/i;
const BROWSER_SPAWN_FAILED = /spawn .*ENOENT/i;
/** 我们自己的 stdio 客户端在等不到回复时抛的那句：扩展模式下属它最常见。 */
const CALL_TIMED_OUT = /tools\/call 超时/;

/**
 * 把上游那几句英文报错翻成「现在该做什么」。
 * 只在浏览器条目的调用失败时用；没命中就返回 null，调用方原样返回原文。
 */
export function browserExtensionHint(
  text: unknown,
  context: {
    browserName?: string;
    executablePath?: string | null;
    /** 面板认定该找的那个 profile 根目录（browserBridge.userDataDir）。 */
    userDataDir?: string | null;
    /** 我们自己查过的结论：true 说明扩展确实装在这个浏览器里，就别再让人装一遍。 */
    extensionInstalled?: boolean | null;
  } = {},
): string | null {
  const raw = String(text ?? '');
  if (!raw) return null;
  const name = context.browserName || '你日常用的浏览器';
  const where = context.executablePath ? `${name}（${context.executablePath}）` : name;
  if (EXTENSION_NOT_FOUND.test(raw)) {
    const searched = EXTENSION_NOT_FOUND.exec(raw)?.[1] || '';
    // 报错里的目录和面板认定的浏览器 profile 不是同一棵树：这是**接错了浏览器**，
    // 不是「没装扩展」。用户明明装了却被叫去再装一遍，就是这么来的。
    if (searched && context.userDataDir && !sameProfileTree(searched, context.userDataDir)) {
      return [
        'SANMAO：这句是 Playwright 的原话，但它翻的是另一个浏览器的 profile：',
        `它找的是：${searched}`,
        `你现在接的是：${name}${context.userDataDir ? `（${context.userDataDir}）` : ''}`,
        context.extensionInstalled === true
          ? `扩展确实装在 ${name} 里，所以这不是「没装」，是运行时用错了浏览器。`
          : '扩展装在哪一个浏览器里，就得接哪一个。',
        '到 MCP 面板把「浏览器控制」停掉，确认「接我日常的浏览器」下面写的就是你要用的那个浏览器，再点「启动」；浏览器路径是启动时定下来的，改完不重启运行时不会生效。',
      ].join('\n');
    }
    return [
      'SANMAO：这条报错来自 Playwright 本身，它默认只在 Chrome 的 profile 里找扩展。',
      `现在接的是 ${where}：打开它的扩展页，确认「Playwright Extension」在列表里并且是启用状态，装好后保持这个浏览器开着再试一次。`,
      context.extensionInstalled === true
        ? `我们查过 ${name} 的 profile，扩展确实装在里面，所以别重装。`
        : '扩展必须装在你现在接的这个浏览器里，装在别的浏览器里不算。',
      '要是那边明明装着还报这句：多半是运行时还在用旧的启动参数（比如中途换过默认浏览器）。到 MCP 面板把「浏览器控制」停掉再点一次「启动」，让新参数生效。',
      '商店打不开时（国内常见）：在项目里运行 npm run build:playwright-extension，再到扩展页用「加载已解压的扩展程序」选中 MCP 面板里那个自建扩展目录。',
    ].join('\n');
  }
  if (EXTENSION_NOT_CONNECTED.test(raw)) {
    const seconds = EXTENSION_NOT_CONNECTED.exec(raw)?.[1] || '';
    return [
      `SANMAO：扩展没有在 ${seconds} 秒内连上来——连接页需要你确认一次。`,
      '刚才应该弹出了一个「Playwright Extension」标签页：在那里选一个标签页并点「Connect」。',
      '不想每次点：在那个页面上复制 PLAYWRIGHT_MCP_EXTENSION_TOKEN=… 整行，粘到 MCP 面板的「扩展连接码」里保存。',
    ].join('\n');
  }
  if (BROWSER_CHANNEL_MISSING.test(raw)) {
    return 'SANMAO：没找到可用的浏览器可执行文件。装一个 Chromium 系浏览器（Chrome、Edge、Brave…），或在 MCP 面板里手填浏览器路径后重试。';
  }
  if (CALL_TIMED_OUT.test(raw)) {
    return [
      'SANMAO：浏览器这一侧在超时前没有连上来。最常见的原因是连接页在等你确认：',
      '到刚弹出的「Playwright Extension」标签页里，选一个标签页并点「Connect」，然后让我重试。',
      '不想每次点：把那个页面上的 PLAYWRIGHT_MCP_EXTENSION_TOKEN=… 整行填到 MCP 面板的「扩展连接码」里。',
    ].join('\n');
  }
  if (BROWSER_SPAWN_FAILED.test(raw) && context.executablePath) {
    return `SANMAO：启动浏览器失败：${context.executablePath} 可能已经被卸载或改名。到 MCP 面板把浏览器路径改对。`;
  }
  return null;
}
