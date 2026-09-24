import { rmSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const MODULES = [
  'lib/data-paths',
  'lib/agent/context-budget',
  'lib/agent/browser-metrics',
  'lib/agent/browser-freshness',
  'lib/agent/tool-loop',
  'lib/agent/progress',
  'lib/agent-client',
  'lib/task-store',
  'lib/agent/approval',
  'lib/tools/registry',
  'lib/tools/artifacts',
  'lib/tools/file',
  'lib/tools/image',
  'lib/tools/skills',
  'lib/tools/web',
  'lib/tools/executor',
  'lib/tools/selector',
  'lib/tools/policy',
  'lib/tools/mcp-admin',
  'lib/tools/canvas',
  'lib/tools/index',
  'lib/mcp/types',
  'lib/mcp/protocol',
  'lib/mcp/store',
  'lib/mcp/catalog',
  'lib/mcp/browser-extension',
  'lib/mcp/browser-guidance',
  'lib/mcp/browser-editors',
  'lib/mcp/catalog-remote',
  'lib/mcp/filesystem-roots',
  'lib/mcp/open-folder',
  'lib/mcp/pick-folder',
  'lib/mcp/filesystem-policy',
  'lib/mcp/browser-downloads',
  'lib/artifacts/limits',
  'lib/artifacts/types',
  'lib/artifacts/sanitize',
  'lib/artifacts/storage',
  'lib/mcp/client',
  'lib/mcp/stdio',
  'lib/mcp/catalog-runtime',
  'lib/mcp/tools',
  'lib/mcp/audit',
  'lib/mcp/admin',
  'lib/mcp/runtime-admin',
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

/**
 * 把同一个转译文件按两个不同的 URL 各导入一次，模拟 dev 下的模块热更新：
 * ESM 按完整 URL 缓存，问号不同就是两个模块实例，模块级 const 会被重新初始化。
 */
export async function importTwiceByPath(entry) {
  const outDir = await ensureBuilt();
  const url = pathToFileURL(path.join(outDir, entry)).href;
  return [await import(url), await import(`${url}?hmr=1`)];
}

/** 通用工具循环：纯逻辑、无依赖，单独跑真实实现。 */
export async function buildToolLoopModule() {
  return load('lib/agent/tool-loop.mjs');
}

export async function buildContextBudgetModule() {
  return load('lib/agent/context-budget.mjs');
}

export async function buildBrowserMetricsModule() {
  return load('lib/agent/browser-metrics.mjs');
}

export async function buildBrowserFreshnessModule() {
  return load('lib/agent/browser-freshness.mjs');
}

/** 长任务进度账本：落盘、TTL 与淘汰规则都要跑真实实现。 */
export async function buildAgentProgressModule() {
  return load('lib/agent/progress.mjs');
}

/** 前端轮询助手：停轮询的条件和秒表都要跑真实实现。 */
export async function buildAgentClientModule() {
  return load('lib/agent-client.mjs');
}

/** 产物仓库：浏览器下载导入要跑真实的落盘与元数据，不能只测假对象。 */
export async function buildArtifactStoreModule() {
  return load('lib/artifacts/storage.mjs');
}

/** 审批记录：存储、认领与风险判定都要跑真实实现，不能用假对象糊过去。 */
export async function buildApprovalModule() {
  return load('lib/agent/approval.mjs');
}
