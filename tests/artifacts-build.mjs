import { rmSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const MODULES = [
  'lib/data-paths',
  'lib/artifacts/limits',
  'lib/artifacts/types',
  'lib/artifacts/sanitize',
  'lib/artifacts/validate',
  'lib/artifacts/storage',
  'lib/artifacts/word',
  'lib/artifacts/excel',
  'lib/artifacts/powerpoint',
  'lib/artifacts/archive',
  'lib/artifacts/index',
  'lib/artifacts/download',
];

const BUILD_ROOT = path.join(process.cwd(), '.data', 'artifacts-test-build');

process.on('exit', () => {
  try { rmSync(BUILD_ROOT, { recursive: true, force: true }); } catch {}
});

let sequence = 0;

/**
 * 把 artifact 子系统按依赖图转译到项目内的临时目录（保留 node_modules 解析），
 * 让测试可以直接跑真实的 docx/exceljs/pptxgenjs/fflate 代码。
 */
export async function buildArtifactsModule() {
  const outDir = path.join(BUILD_ROOT, `${process.pid}-${Date.now()}-${sequence += 1}`);
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
    return { ...artifacts, ...download };
  } catch (error) {
    await rm(outDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function cleanupArtifactsBuild() {
  await rm(BUILD_ROOT, { recursive: true, force: true }).catch(() => undefined);
}
