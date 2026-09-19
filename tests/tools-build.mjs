import { rmSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const MODULES = [
  'lib/tools/registry',
  'lib/tools/artifacts',
  'lib/tools/file',
  'lib/tools/image',
  'lib/tools/skills',
  'lib/tools/web',
  'lib/tools/index',
];

const BUILD_ROOT = path.join(process.cwd(), '.data', 'tools-test-build');
// node --test 并行跑多个文件，每个进程只清理自己的子目录。
const PROCESS_ROOT = path.join(BUILD_ROOT, String(process.pid));

process.on('exit', () => {
  try { rmSync(PROCESS_ROOT, { recursive: true, force: true }); } catch {}
});

/** 把 lib/tools 按依赖顺序转译到临时目录，让测试直接跑真实的工具注册表代码。 */
export async function buildToolsModule() {
  const outDir = path.join(PROCESS_ROOT, String(Date.now()));
  try {
    for (const target of MODULES) {
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
    return await import(pathToFileURL(path.join(outDir, 'index.mjs')).href);
  } catch (error) {
    await rm(outDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
