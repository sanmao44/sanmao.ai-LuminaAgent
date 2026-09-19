import { rmSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// 附件解析依赖 artifacts 的上限常量；按依赖顺序转译，保持相对目录结构。
const MODULES = [
  'lib/artifacts/limits',
  'lib/attachments/extract',
];

const BUILD_ROOT = path.join(process.cwd(), '.data', 'attachments-test-build');
// node --test 并行跑多个测试文件，每个进程只清理自己的子目录。
const PROCESS_ROOT = path.join(BUILD_ROOT, String(process.pid));

process.on('exit', () => {
  try { rmSync(PROCESS_ROOT, { recursive: true, force: true }); } catch {}
});

let sequence = 0;

/**
 * 把附件解析模块转译到项目内的临时目录（保留 node_modules 解析），
 * 让测试直接跑真实的 fflate / exceljs / unpdf 实现。
 */
export async function buildAttachmentsModule() {
  const outDir = path.join(PROCESS_ROOT, `${Date.now()}-${sequence += 1}`);
  try {
    for (const target of MODULES) {
      const compiled = ts.transpileModule(await readFile(path.join(process.cwd(), `${target}.ts`), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        fileName: `${target}.ts`,
      }).outputText;
      const rewritten = compiled.replace(/(from\s+)(["'])(\.[^"']*)(["'])/g, (match, keyword, open, specifier, close) => (
        specifier.endsWith('.mjs') ? match : `${keyword}${open}${specifier}.mjs${close}`
      ));
      const file = path.join(outDir, `${target}.mjs`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, rewritten);
    }
    return await import(pathToFileURL(path.join(outDir, 'lib/attachments/extract.mjs')).href);
  } catch (error) {
    await rm(outDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
