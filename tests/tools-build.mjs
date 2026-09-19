import { rmSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const MODULES = [
  'lib/data-paths',
  'lib/tools/registry',
  'lib/tools/artifacts',
  'lib/tools/file',
  'lib/tools/image',
  'lib/tools/skills',
  'lib/tools/web',
  'lib/tools/executor',
  'lib/tools/policy',
  'lib/tools/mcp-admin',
  'lib/tools/index',
  'lib/mcp/types',
  'lib/mcp/store',
  'lib/mcp/client',
  'lib/mcp/tools',
  'lib/mcp/admin',
  'lib/mcp/index',
];

const BUILD_ROOT = path.join(process.cwd(), '.data', 'tools-test-build');
// node --test 并行跑多个文件，每个进程只清理自己的子目录。
const PROCESS_ROOT = path.join(BUILD_ROOT, String(process.pid));

process.on('exit', () => {
  try { rmSync(PROCESS_ROOT, { recursive: true, force: true }); } catch {}
});

/**
 * 目录结构按原样镜像，所以 `@/lib/x` 别名要换算成相对路径；
 * 相对导入统一补 `.mjs`，让 node 不用 loader 也能直接跑转译结果。
 */
function rewriteSpecifiers(code, outFile, outDir) {
  return code.replace(/(from\s+|import\s+)(["'])([^"']+)(["'])/g, (match, keyword, open, specifier, close) => {
    if (specifier.startsWith('@/lib/')) {
      const target = path.join(outDir, 'lib', `${specifier.slice('@/lib/'.length)}.mjs`);
      let relative = path.relative(path.dirname(outFile), target).split(path.sep).join('/');
      if (!relative.startsWith('.')) relative = `./${relative}`;
      return `${keyword}${open}${relative}${close}`;
    }
    if (specifier.startsWith('.') && !specifier.endsWith('.mjs')) return `${keyword}${open}${specifier}.mjs${close}`;
    return match;
  });
}

async function build(outDir) {
  for (const target of MODULES) {
    const compiled = ts.transpileModule(await readFile(path.join(process.cwd(), `${target}.ts`), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: `${target}.ts`,
    }).outputText;
    const file = path.join(outDir, `${target}.mjs`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, rewriteSpecifiers(compiled, file, outDir));
  }
  return outDir;
}

// 同一个进程里只转译一次：模块只加载一次，缓存、会话这类模块级状态才和线上一致。
let pending = null;

async function ensureBuilt() {
  if (!pending) {
    const outDir = path.join(PROCESS_ROOT, `${Date.now()}-${String(Math.random()).slice(2, 8)}`);
    pending = build(outDir).catch(async (error) => {
      await rm(outDir, { recursive: true, force: true }).catch(() => undefined);
      pending = null;
      throw error;
    });
  }
  return pending;
}

async function load(entry) {
  const outDir = await ensureBuilt();
  return import(pathToFileURL(path.join(outDir, entry)).href);
}

/** 把 lib/tools 按依赖顺序转译到临时目录，让测试直接跑真实的工具注册表代码。 */
export async function buildToolsModule() {
  return load('lib/tools/index.mjs');
}

/** 统一执行点单独作为一个入口，避免 index ↔ policy 互相 re-export 形成环。 */
export async function buildToolPolicyModule() {
  return load('lib/tools/policy.mjs');
}

/** 同一套转译结果里的 MCP 模块，测试要用真实的 store / client / 工具翻译逻辑。 */
export async function buildMcpModule() {
  return load('lib/mcp/index.mjs');
}
