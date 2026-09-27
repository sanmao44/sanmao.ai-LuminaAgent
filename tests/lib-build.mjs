import { rmSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const BUILD_ROOT = path.join(process.cwd(), '.data', 'lib-test-build');
// node --test 并行跑多个文件，每个进程只清理自己的子目录。
const PROCESS_ROOT = path.join(BUILD_ROOT, String(process.pid));

process.on('exit', () => {
  try { rmSync(PROCESS_ROOT, { recursive: true, force: true }); } catch {}
});

/**
 * 把若干 lib 模块转译到临时目录，让测试直接跑真实的 TS 实现（包括它们之间的相对 import）。
 * 调用方按依赖顺序给出模块列表；返回入口模块和一个从同一目录加载其它模块的 load()，
 * 这样同一个模块只实例化一次，存储层的内存状态（写入队列）与线上行为一致。
 */
export async function buildLibModules(modules, entry) {
  const outDir = path.join(PROCESS_ROOT, `${Date.now()}-${Math.round(Math.random() * 1e6)}`);
  try {
    // data-paths is a shared dependency of stores that resolve their durable
    // data directory at module load time. Keep it in the isolated build even
    // when a test only names the store entry point.
    const targets = [...new Set(['lib/data-paths', ...modules])];
    for (const target of targets) {
      const compiled = ts.transpileModule(await readFile(path.join(process.cwd(), `${target}.ts`), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        fileName: `${target}.ts`,
      }).outputText;
      const rewritten = compiled.replace(/(from\s+)(["'])(\.[^"']*)(["'])/g, (match, keyword, open, specifier, close) => (
        specifier.endsWith('.mjs') ? match : `${keyword}${open}${specifier}.mjs${close}`
      ));
      const file = path.join(outDir, `${path.basename(target)}.mjs`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, rewritten);
    }
    const load = (name) => import(pathToFileURL(path.join(outDir, `${name}.mjs`)).href);
    return { main: await load(entry), load };
  } catch (error) {
    await rm(outDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
