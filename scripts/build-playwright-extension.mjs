#!/usr/bin/env node
/**
 * 构建官方 Playwright 扩展的解包目录（「接我日常的浏览器」的国内可用路径）。
 *
 * 为什么需要这一步：微软官方扩展只上架了 Chrome 网上应用商店，国内打不开。
 * 扩展源码是 Apache-2.0，而且是自包含的（只依赖 react / vite，服务端 worker 零依赖），
 * 所以这里直接从 microsoft/playwright 拉一份指定 ref 的 packages/extension，
 * 用最小依赖集构建出解包目录，让用户在浏览器扩展页「加载已解压的扩展程序」。
 *
 * 用法：
 *   npm run build:playwright-extension                  # 默认 main
 *   npm run build:playwright-extension -- --ref v1.64.0 # 指定 tag / 分支
 *   npm run build:playwright-extension -- --keep        # 保留临时目录方便排查
 *
 * 产物：<项目>/.data/browser/extension（不进仓库，也不进发布包）。
 * 面板上的「打开自建扩展目录」按钮打开的就是这个目录。
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM = 'https://github.com/microsoft/playwright.git';
/** 构建扩展需要的依赖：与上游 packages/extension 的源码一致，多一个都不装。 */
const BUILD_DEPS = ['vite', '@vitejs/plugin-react', 'react', 'react-dom'];

function parseArgs(argv) {
  const options = { ref: process.env.PLAYWRIGHT_EXTENSION_REF?.trim() || 'main', keep: false, out: process.env.PLAYWRIGHT_EXTENSION_OUT?.trim() || '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--ref') options.ref = String(argv[++index] || '').trim() || options.ref;
    else if (arg.startsWith('--ref=')) options.ref = arg.slice('--ref='.length).trim() || options.ref;
    else if (arg === '--out') options.out = String(argv[++index] || '').trim() || options.out;
    else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length).trim();
    else if (arg === '--keep') options.keep = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

/** 和 lib/data-paths.ts 的 resolveLocalDataDir 保持一致：SANMAO_DATA_DIR 优先，默认 <项目>/.data。 */
function resolveOutDir(override) {
  if (override) return path.resolve(REPO_ROOT, override);
  const configured = String(process.env.SANMAO_DATA_DIR || '').trim();
  const dataDir = configured ? path.resolve(REPO_ROOT, configured) : path.join(REPO_ROOT, '.data');
  return path.join(dataDir, 'browser', 'extension');
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...options });
}

/**
 * 用 Node 自带的 npm CLI，而不是 shell 里的 `npm`：
 * Windows 上 npm 是 npm.cmd，spawn 不带 shell 时找不到（ENOENT）。这与运行时安装依赖同一套做法。
 */
function resolveNpmCli() {
  const candidate = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!existsSync(candidate)) throw new Error('这台机器上找不到 npm，无法安装构建依赖');
  return candidate;
}

/** 两个 vite 构建（页面 + service worker）复刻上游 packages/extension 的产物结构。 */
function viteConfigSources(sources, outDir) {
  const pages = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: ${JSON.stringify(sources.ui)},
  plugins: [react()],
  build: {
    outDir: ${JSON.stringify(outDir)},
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: [${JSON.stringify(path.join(sources.ui, 'connect.html'))}, ${JSON.stringify(path.join(sources.ui, 'status.html'))}],
      output: {
        manualChunks: undefined,
        entryFileNames: 'lib/ui/[name].js',
        chunkFileNames: 'lib/ui/[name].js',
        assetFileNames: 'lib/ui/[name].[ext]',
      },
    },
  },
});
`;
  const sw = `import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: ${JSON.stringify(outDir)},
    emptyOutDir: false,
    minify: false,
    lib: { entry: ${JSON.stringify(path.join(sources.src, 'background.ts'))}, fileName: 'lib/background', formats: ['es'] },
  },
});
`;
  return { pages, sw };
}

/**
 * manifest 里写死的是 lib/background.mjs，而 vite 的产物后缀取决于 package.json 的 type。
 * 与其赌后缀，不如构建后按 manifest 对齐一次（缺什么补什么）。
 */
function alignServiceWorker(outDir) {
  const manifestPath = path.join(outDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const expected = String(manifest?.background?.service_worker || '').trim();
  if (!expected) return '（manifest 里没有 service_worker，跳过对齐）';
  const target = path.join(outDir, expected);
  if (existsSync(target)) return expected;
  const dir = path.dirname(target);
  const base = path.basename(expected).replace(/\.[^.]+$/, '');
  const candidate = existsSync(dir) ? readdirSync(dir).find((name) => name === `${base}.js` || name === `${base}.mjs`) : undefined;
  if (!candidate) throw new Error(`构建产物里没有找到 service worker（manifest 期望 ${expected}）`);
  renameSync(path.join(dir, candidate), target);
  return expected;
}

/** html 里按源码目录写的 `../../icons/`，构建后图标就在同级的 icons/ 下。 */
function fixHtmlAssetPaths(outDir) {
  for (const name of readdirSync(outDir)) {
    if (!name.endsWith('.html')) continue;
    const file = path.join(outDir, name);
    const html = readFileSync(file, 'utf8');
    const fixed = html.replaceAll('../../icons/', 'icons/');
    if (fixed !== html) writeFileSync(file, fixed, 'utf8');
  }
}

/**
 * 图标和 manifest 不走 vite 打包，直接按 manifest 期望的位置铺到产物目录。
 * 用 vite-plugin-static-copy 的话它会保留 glob 的目录层级，产物会变成 icons/icons/*。
 */
function copyStaticAssets(sources, outDir) {
  const iconOut = path.join(outDir, 'icons');
  mkdirSync(iconOut, { recursive: true });
  for (const name of readdirSync(sources.icons)) {
    const from = path.join(sources.icons, name);
    if (existsSync(from)) copyFileSync(from, path.join(iconOut, name));
  }
  copyFileSync(sources.manifest, path.join(outDir, 'manifest.json'));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：npm run build:playwright-extension -- [--ref <tag|branch>] [--out <目录>] [--keep]');
    return;
  }
  const outDir = resolveOutDir(options.out);
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'sanmao-pw-extension-'));
  let succeeded = false;
  try {
    const clone = path.join(tempRoot, 'playwright');
    console.log(`[1/4] 拉取 microsoft/playwright@${options.ref}（只取 packages/extension）`);
    run('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', options.ref, UPSTREAM, clone]);
    run('git', ['-C', clone, 'sparse-checkout', 'set', 'packages/extension']);
    const extensionDir = path.join(clone, 'packages', 'extension');
    if (!existsSync(path.join(extensionDir, 'src', 'ui', 'connect.html'))) {
      throw new Error('拉下来的仓库里没有 packages/extension 的界面源码，可能上游改了目录结构');
    }
    const commit = run('git', ['-C', clone, 'rev-parse', 'HEAD']).trim();

    console.log('[2/4] 安装构建依赖（只装 vite / react 这几个，不动上游工作区）');
    // 依赖装在临时仓库的上一层：vite 解析 `react` 是从「引用它的源文件」所在目录逐级向上找
    // node_modules，装在兄弟目录里会找不到。
    const buildDir = tempRoot;
    mkdirSync(buildDir, { recursive: true });
    // 不写 "type": "module"：vite 的 lib 模式据此产出 .mjs，与扩展 manifest 一致。
    writeFileSync(path.join(buildDir, 'package.json'), `${JSON.stringify({ name: 'sanmao-playwright-extension-build', private: true }, null, 2)}\n`, 'utf8');
    run(process.execPath, [resolveNpmCli(), 'install', '--no-audit', '--no-fund', '--loglevel=error', ...BUILD_DEPS], { cwd: buildDir });

    console.log('[3/4] 构建扩展');
    const sources = {
      ui: path.join(extensionDir, 'src', 'ui'),
      src: path.join(extensionDir, 'src'),
      icons: path.join(extensionDir, 'icons'),
      manifest: path.join(extensionDir, 'manifest.json'),
    };
    const configs = viteConfigSources(sources, outDir);
    const pagesConfig = path.join(buildDir, 'vite.pages.config.mjs');
    const swConfig = path.join(buildDir, 'vite.sw.config.mjs');
    writeFileSync(pagesConfig, configs.pages, 'utf8');
    writeFileSync(swConfig, configs.sw, 'utf8');
    const viteBin = path.join(buildDir, 'node_modules', 'vite', 'bin', 'vite.js');
    run(process.execPath, [viteBin, 'build', '--config', pagesConfig], { cwd: buildDir });
    run(process.execPath, [viteBin, 'build', '--config', swConfig], { cwd: buildDir });

    console.log('[4/4] 复制 manifest 与图标，校正产物');
    copyStaticAssets(sources, outDir);
    fixHtmlAssetPaths(outDir);
    const worker = alignServiceWorker(outDir);
    writeFileSync(path.join(outDir, 'BUILD-INFO.json'), `${JSON.stringify({ ref: options.ref, commit, builtAt: new Date().toISOString(), source: UPSTREAM }, null, 2)}\n`, 'utf8');
    succeeded = true;
    console.log('');
    console.log(`扩展已构建：${outDir}`);
    console.log(`上游提交：${commit}（${options.ref}）`);
    console.log(`service worker：${worker}`);
    console.log('');
    console.log('接下来：在浏览器里打开扩展页 → 打开「开发者模式」→「加载已解压的扩展程序」→ 选上面这个目录。');
    console.log('装好之后回到 SANMAO 的工具面板，把浏览器控制的接入方式切到「接我日常的浏览器」。');
  } finally {
    if (succeeded && !options.keep) {
      rmSync(tempRoot, { recursive: true, force: true });
    } else {
      console.log(`临时目录：${tempRoot}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error('');
  console.error(`构建失败：${error instanceof Error ? error.message : String(error)}`);
  console.error('如果是网络问题，可以挂上代理再试一次；也可以先用 Chrome 网上应用商店里的官方扩展。');
  process.exitCode = 1;
}
