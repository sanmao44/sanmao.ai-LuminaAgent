import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildMcpModule } from './tools-build.mjs';

const mcp = await buildMcpModule();

async function withDataDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-browser-ext-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

test('从「打开方式」命令行里取出可执行文件：带引号和不带引号都要认', () => {
  assert.equal(
    mcp.parseExecutableFromCommand('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" -- "%1"'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  );
  assert.equal(
    mcp.parseExecutableFromCommand('"C:\\Users\\me\\AppData\\Local\\Tabbit Browser\\Application\\Tabbit Browser.exe" --single-argument %1'),
    'C:\\Users\\me\\AppData\\Local\\Tabbit Browser\\Application\\Tabbit Browser.exe',
  );
  assert.equal(mcp.parseExecutableFromCommand('C:\\Windows\\System32\\cmd.exe /c start'), 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(mcp.parseExecutableFromCommand('   '), null);
  assert.equal(mcp.parseExecutableFromCommand(null), null);
  // 面板要给用户一个能认的名字：认得出的用常用名，其余用文件名。
  assert.equal(mcp.browserNameFromPath('C:\\x\\chrome.exe'), 'Google Chrome');
  assert.equal(mcp.browserNameFromPath('C:\\x\\Tabbit Browser.exe'), 'Tabbit Browser');
});

test('Windows reg.exe 的中文代码页输出不会把默认浏览器路径解码成乱码', () => {
  // reg.exe 在中文 Windows 上输出的「软件」是 GB18030 字节，不是 UTF-8。
  const bytes = Uint8Array.from([0xc8, 0xed, 0xbc, 0xfe]);
  assert.equal(mcp.decodeWindowsCommandOutput(bytes), '软件');
});

test('Windows 默认浏览器注册表支持 reg query 的 (Default) 前缀', () => {
  const browser = 'E:\\软件\\Tabbit Browser\\Application\\Tabbit Browser.exe';
  const detected = mcp.detectDefaultBrowserExecutable('win32', (file, args) => {
    if (file !== 'reg.exe') return null;
    if (args.includes('ProgId')) return '    ProgId    REG_SZ    TbBrHTM.TEST\r\n';
    return `    (Default)    REG_SZ    "${browser}" --single-argument %1\r\n`;
  });
  assert.equal(detected, browser);
});

test('按安装位置认 profile，扩展装没装给的是确定结论', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sanmao-browser-profile-'));
  try {
    const appDir = path.join(root, 'Tabbit Browser', 'Application');
    const exe = path.join(appDir, 'Tabbit Browser.exe');
    const userData = path.join(root, 'Tabbit Browser', 'User Data');
    await mkdir(appDir, { recursive: true });
    await writeFile(exe, '');
    await mkdir(path.join(userData, 'Default'), { recursive: true });
    // 只有装了扩展的那个浏览器才配得上「系统默认浏览器」这个身份。
    assert.equal(mcp.resolveUserDataDir(exe, 'win32'), userData);
    assert.deepEqual(mcp.listBrowserProfiles(userData), ['Default']);
    assert.equal(mcp.extensionInstalledForBrowser(exe, 'win32'), false);
    await mkdir(path.join(userData, 'Default', 'Extensions', mcp.PLAYWRIGHT_EXTENSION_ID), { recursive: true });
    assert.equal(mcp.extensionInstalledForBrowser(exe, 'win32'), true);
    // Preferences 里记着也算装过（有些安装方式不落 Extensions 目录）。
    const other = path.join(root, 'Brave', 'User Data', 'Default');
    await mkdir(other, { recursive: true });
    await writeFile(path.join(other, 'Preferences'), JSON.stringify({ extensions: { settings: { [mcp.PLAYWRIGHT_EXTENSION_ID]: { state: 1 } } } }));
    assert.equal(mcp.extensionInstalledForBrowser(path.join(root, 'Brave', 'Application', 'brave.exe'), 'win32'), true);
    // macOS / Linux 的 profile 位置各浏览器都不一样：宁可说「无法确认」，也不要误报「没装」。
    assert.equal(mcp.resolveUserDataDir(exe, 'darwin'), null);
    assert.equal(mcp.extensionInstalledForBrowser(exe, 'darwin'), null);
    assert.equal(mcp.extensionInstalledForBrowser(null, 'win32'), null);
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('接日常浏览器：浏览器路径进启动参数，扩展连接码只走环境变量', async () => {
  await withDataDir(async (dataDir) => {
    const entry = mcp.findCatalogEntry('playwright');
    const exe = path.join(dataDir, 'FakeBrowser', 'Application', 'FakeBrowser.exe');
    await mkdir(path.dirname(exe), { recursive: true });
    await writeFile(exe, '');
    await mkdir(path.join(dataDir, 'FakeBrowser', 'User Data', 'Default', 'Extensions', mcp.PLAYWRIGHT_EXTENSION_ID), { recursive: true });
    mcp.setCatalogEntryBrowserMode('playwright', 'extension', { dataDir });
    mcp.setCatalogEntryBrowserExecutablePath('playwright', exe, { dataDir });
    const config = mcp.catalogServerConfig(entry, { dataDir, enabled: true });
    assert.ok(config.args.includes('--extension'));
    assert.equal(config.args[config.args.indexOf('--executable-path') + 1], exe, '接日常浏览器要明确指定接哪一个浏览器');
    assert.ok(!config.args.includes('--browser'), '--extension 会忽略 --browser，传了只会让人以为还能选浏览器');
    assert.equal(config.env, undefined, '没配连接码就不该给环境变量');
    const bridge = mcp.catalogBrowserBridge(entry, { dataDir });
    assert.equal(bridge.source, 'override');
    assert.equal(bridge.browserName, 'FakeBrowser');
    assert.equal(bridge.extensionInstalled, true);
    assert.equal(bridge.tokenConfigured, false);
    // 扩展页给的是整行，用户多半整行复制：这里也要认。
    const token = 'abcdefghijklmnopqrstuvwxyz0123456789ABCD';
    mcp.setCatalogEntryExtensionToken('playwright', `PLAYWRIGHT_MCP_EXTENSION_TOKEN=${token}`, { dataDir });
    const withToken = mcp.catalogServerConfig(entry, { dataDir, enabled: true });
    assert.equal(withToken.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN, token);
    assert.ok(!withToken.args.join(' ').includes(token), '连接码写进命令行等于摊在进程列表里');
    assert.equal(mcp.catalogBrowserBridge(entry, { dataDir }).tokenConfigured, true);
    // 留空 = 清除：回到「每次在连接页点一次允许」。
    mcp.setCatalogEntryExtensionToken('playwright', '', { dataDir });
    assert.equal(mcp.catalogServerConfig(entry, { dataDir, enabled: true }).env, undefined);
    assert.equal(mcp.catalogBrowserBridge(entry, { dataDir }).tokenConfigured, false);
    // 不像连接码 / 不像浏览器路径的输入直接拒掉，不静默存下去。
    assert.throws(() => mcp.setCatalogEntryExtensionToken('playwright', 'not a token', { dataDir }), /连接码/);
    assert.throws(() => mcp.setCatalogEntryBrowserExecutablePath('playwright', 'chrome.exe', { dataDir }), /完整路径/);
    assert.throws(() => mcp.setCatalogEntryBrowserExecutablePath('playwright', path.join(dataDir, 'nope.exe'), { dataDir }), /没有文件/);
    // 手填的路径失效后按「没设过」处理：否则面板会一直拿一个不存在的路径去启动。
    await writeFile(path.join(dataDir, 'deleted.exe'), '');
    mcp.setCatalogEntryBrowserExecutablePath('playwright', path.join(dataDir, 'deleted.exe'), { dataDir });
    await rm(path.join(dataDir, 'deleted.exe'), { force: true });
    assert.equal(mcp.catalogEntryBrowserExecutablePath('playwright', { dataDir }), '');
  });
});

test('上游那句「未检测到扩展」要翻成能照着做的中文', () => {
  const notFound = mcp.browserExtensionHint(
    'Error: Playwright Extension not found in "C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data". Install it from https://chromewebstore.google.com/detail/playwright-extension/mmlmfjh',
    { browserName: 'Tabbit Browser', executablePath: 'C:\\Tabbit Browser\\Application\\Tabbit Browser.exe' },
  );
  assert.ok(notFound.includes('Tabbit Browser'), '要说清现在接的是哪个浏览器');
  assert.ok(notFound.includes('Playwright Extension'));
  assert.ok(notFound.includes('npm run build:playwright-extension'), '商店打不开时的退路也要给');
  const notConnected = mcp.browserExtensionHint(
    'Error: Playwright extension did not connect within 120s after opening the connect page.',
    { browserName: 'Google Chrome', executablePath: 'C:\\chrome.exe' },
  );
  assert.ok(notConnected.includes('120'));
  assert.ok(notConnected.includes('Connect'));
  assert.ok(notConnected.includes(mcp.PLAYWRIGHT_EXTENSION_TOKEN_ENV), '免点击的办法就在扩展页上，要告诉用户');
  // 等不到扩展连上来时抛的是超时（不是错误结果），这句同样要翻：不然用户只看到「超时」。
  const timedOut = mcp.browserExtensionHint('tools/call 超时（120 秒）', { browserName: 'Tabbit Browser', executablePath: 'C:\\Tabbit Browser.exe' });
  assert.ok(timedOut.includes('Connect'));
  assert.ok(timedOut.includes('扩展连接码'));
  assert.equal(mcp.browserExtensionHint('Error: browser_click: element not found', {}), null, '不认识的报错原样返回，乱加解释只会更糊');
  assert.equal(mcp.browserExtensionHint('', {}), null);
  // 代码里只该有一份官方扩展 id：面板的商店链接、profile 目录名、提示文案都对得上。
  assert.equal(mcp.findCatalogEntry('playwright').browserExtension.storeId, mcp.PLAYWRIGHT_EXTENSION_ID);
});

test('报错里的 profile 和「认定要接的浏览器」不是同一棵：说接错了浏览器，别叫用户重装', () => {
  const context = {
    browserName: 'Tabbit Browser',
    executablePath: 'C:\\Users\\me\\AppData\\Local\\Tabbit Browser\\Application\\Tabbit Browser.exe',
    userDataDir: 'C:\\Users\\me\\AppData\\Local\\Tabbit Browser\\User Data',
    extensionInstalled: true,
  };
  // 本机真实踩到的样子：扩展装在 Tabbit 里，Playwright 却去 Chrome 的 profile 里找。
  const wrongBrowser = mcp.browserExtensionHint(
    'Error: Playwright Extension not found in "C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data". Install it from https://chromewebstore.google.com/detail/playwright-extension/mmlmfjh',
    context,
  );
  assert.ok(wrongBrowser.includes('扩展确实装在 Tabbit Browser 里'), '查过装了就直说装了');
  assert.ok(wrongBrowser.includes('停掉'), '要给出「停掉再启动」这一步');
  assert.ok(!wrongBrowser.includes('npm run build:playwright-extension'), '扩展装着呢，不能再劝人装一遍');

  // 同一棵 profile 树（大小写、斜杠、子目录不同）不算接错：还是走「确认装没装」那条。
  const sameTree = mcp.browserExtensionHint(
    'Error: Playwright Extension not found in "C:/Users/me/AppData/Local/Tabbit Browser/User Data/Default/"',
    context,
  );
  assert.ok(sameTree.includes('npm run build:playwright-extension'));

  assert.equal(mcp.sameProfileTree('C:\\x\\User Data', 'c:/x/user data/'), true);
  assert.equal(mcp.sameProfileTree('C:\\x\\User Data', 'C:\\x\\User Data\\Default'), true, '子目录还是同一棵树');
  assert.equal(mcp.sameProfileTree('C:\\x\\User Data', 'C:\\y\\User Data'), false);
  assert.equal(mcp.sameProfileTree('', 'C:\\x'), false);
});

test('「运行时参数过期」的判定：一模一样才算没变，浏览器路径要取出来给人看', () => {
  const args = ['cli.js', '--extension', '--executable-path', 'C:\\Tabbit Browser.exe', '--output-dir', 'C:\\out'];
  assert.equal(mcp.sameArgs(args, [...args]), true);
  assert.equal(mcp.sameArgs(args, [...args, '--allowed-origins', 'https://a.com']), false, '多一条参数就是另一套启动参数');
  assert.equal(mcp.sameArgs(['--extension'], []), false);
  assert.equal(mcp.sameArgs([], []), true);
  assert.equal(mcp.argValue(args, '--executable-path'), 'C:\\Tabbit Browser.exe');
  assert.equal(mcp.argValue(args, '--user-data-dir'), null);
  assert.equal(mcp.argValue(['--executable-path'], '--executable-path'), null, '开关后面没值就当没有');
});
