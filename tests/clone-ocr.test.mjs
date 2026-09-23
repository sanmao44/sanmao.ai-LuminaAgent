import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(repoRoot, 'lib', 'clone', 'ocr.ts');

function moduleCandidates(file) {
  return [file, `${file}.ts`, `${file}.tsx`, `${file}.js`, `${file}.mjs`, path.join(file, 'index.ts')];
}

async function resolveLocalModule(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of moduleCandidates(base)) if (existsSync(candidate)) return candidate;
  return null;
}

async function materializeModuleGraph(entry, outputRoot) {
  const files = new Map();
  const visit = async (sourceFile) => {
    if (files.has(sourceFile)) return files.get(sourceFile);
    const outputFile = path.join(outputRoot, path.relative(repoRoot, sourceFile).replace(/\.(?:tsx?|mts|cts)$/u, '.mjs'));
    files.set(sourceFile, outputFile);
    const transformed = ts.transpileModule(await readFile(sourceFile, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: sourceFile,
    }).outputText;
    let output = transformed;
    for (const match of transformed.matchAll(/(?:from\s+|import\s*\(\s*)(['"])(\.[^'"]+)\1/gu)) {
      const localFile = await resolveLocalModule(sourceFile, match[2]);
      if (!localFile) continue;
      const importedFile = await visit(localFile);
      let replacement = path.relative(path.dirname(outputFile), importedFile).replaceAll('\\', '/');
      if (!replacement.startsWith('.')) replacement = `./${replacement}`;
      output = output.replaceAll(`'${match[2]}'`, `'${replacement}'`).replaceAll(`"${match[2]}"`, `"${replacement}"`);
    }
    await mkdir(path.dirname(outputFile), { recursive: true });
    await import('node:fs/promises').then(({ writeFile }) => writeFile(outputFile, output, 'utf8'));
    return outputFile;
  };
  return pathToFileURL(await visit(entry)).href;
}

const tempRoot = await mkdtemp(path.join(repoRoot, 'tests', '.clone-ocr-'));
const ocr = await import(await materializeModuleGraph(sourcePath, path.join(tempRoot, 'modules')));

test('Tesseract TSV 解析会过滤无效行并归一化文字框', () => {
  const tsv = [
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    '5\t1\t1\t1\t1\t1\t100\t200\t300\t100\t92.5\tHello',
    '5\t1\t1\t1\t1\t2\t0\t0\t0\t10\t99\tbad-box',
    '5\t1\t1\t1\t1\t3\t0\t0\t100\t20\t-1\tignored',
    '5\t1\t1\t1\t1\t4\t900\t700\t300\t500\t80\tWorld',
  ].join('\n');
  const observations = ocr.parseTesseractTsv(tsv, 1000, 1000);
  assert.equal(observations.length, 2);
  assert.deepEqual(observations[0], {
    text: 'Hello',
    bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
    confidence: 0.93,
    source: 'tesseract',
  });
  assert.deepEqual(observations[1].bounds, { x: 0.9, y: 0.7, width: 0.3, height: 0.5 });
});

test('OCR 文本合并去重，位置推导稳定', () => {
  const observations = [
    { text: '  SANMAO  AI ', source: 'vision' },
    { text: 'SANMAO AI', source: 'tesseract' },
    { text: '新品', source: 'tesseract' },
  ];
  assert.equal(ocr.mergeOcrText(observations), 'SANMAO AI 新品');
  assert.equal(ocr.ocrPosition({ x: 0.4, y: 0.05, width: 0.2, height: 0.1 }), 'top-center');
  assert.equal(ocr.ocrPosition({ x: 0.75, y: 0.75, width: 0.1, height: 0.1 }), 'bottom-right');
  assert.equal(ocr.ocrPosition(), undefined);
});

test('OCR 不可用时不会伪造已识别结果', async () => {
  assert.equal(typeof ocr.localOcrAvailable(), 'boolean');
  assert.match(await readFile(sourcePath, 'utf8'), /buffer\[0\] === 0x89/u);
  assert.match(await readFile(sourcePath, 'utf8'), /spawnSync\(candidate, \['--version'\]/u);
  assert.match(await readFile(sourcePath, 'utf8'), /return null;/u);
});

await rm(tempRoot, { recursive: true, force: true });
