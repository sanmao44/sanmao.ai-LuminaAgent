import { rmSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const MODULES = [
  'lib/data-paths',
  'lib/media-paths',
  'lib/image-storage',
  'lib/artifacts/limits',
  'lib/artifacts/types',
  'lib/artifacts/typography',
  'lib/artifacts/sanitize',
  'lib/artifacts/validate',
  'lib/artifacts/images',
  'lib/artifacts/storage',
  'lib/artifacts/word',
  'lib/artifacts/excel',
  'lib/artifacts/powerpoint',
  'lib/artifacts/archive',
  'lib/artifacts/index',
  'lib/artifacts/download',
  'lib/artifacts/preview',
];

const BUILD_ROOT = path.join(process.cwd(), '.data', 'artifacts-test-build');
// node --test 会并行跑多个测试文件，每个进程只清理自己的子目录；
// 否则先退出的进程会把别人正在使用的转译结果一起删掉，导致随机 MODULE_NOT_FOUND。
const PROCESS_ROOT = path.join(BUILD_ROOT, String(process.pid));

process.on('exit', () => {
  try { rmSync(PROCESS_ROOT, { recursive: true, force: true }); } catch {}
});

let sequence = 0;

/**
 * 把 artifact 子系统按依赖图转译到项目内的临时目录（保留 node_modules 解析），
 * 让测试可以直接跑真实的 docx/exceljs/pptxgenjs/fflate 代码。
 */
export async function buildArtifactsModule() {
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
    const artifacts = await import(pathToFileURL(path.join(outDir, 'lib/artifacts/index.mjs')).href);
    const download = await import(pathToFileURL(path.join(outDir, 'lib/artifacts/download.mjs')).href);
    // 排版测量与列宽分配是排版测试的直接断言目标，单独导出。
    const typography = await import(pathToFileURL(path.join(outDir, 'lib/artifacts/typography.mjs')).href);
    const word = await import(pathToFileURL(path.join(outDir, 'lib/artifacts/word.mjs')).href);
    const preview = await import(pathToFileURL(path.join(outDir, 'lib/artifacts/preview.mjs')).href);
    return { ...artifacts, ...download, ...typography, ...word, ...preview };
  } catch (error) {
    await rm(outDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function cleanupArtifactsBuild() {
  await rm(PROCESS_ROOT, { recursive: true, force: true }).catch(() => undefined);
}
