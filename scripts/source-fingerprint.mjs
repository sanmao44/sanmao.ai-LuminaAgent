#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_DIRECTORIES = ['app', 'components', 'lib', 'public'];
const SOURCE_FILES = ['next.config.ts', 'next.config.js', 'tsconfig.json', 'package.json', 'package-lock.json'];
const DEFAULT_CONCURRENCY = 8;

function argument(name, args = process.argv.slice(2)) {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || '').trim() : '';
}

async function collectSourceFiles(root) {
  const files = [];

  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }

  for (const directory of SOURCE_DIRECTORIES) await visit(path.join(root, directory));
  for (const name of SOURCE_FILES) {
    const fullPath = path.join(root, name);
    if (existsSync(fullPath) && (await stat(fullPath)).isFile()) files.push(fullPath);
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.env') && entry.isFile()) files.push(path.join(root, entry.name));
  }

  return files.sort();
}

export async function calculateSourceFingerprint(rootPath, { concurrency = DEFAULT_CONCURRENCY } = {}) {
  const root = path.resolve(rootPath);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency must be a positive integer');
  }

  const files = await collectSourceFiles(root);
  const hash = createHash('sha256');

  for (let start = 0; start < files.length; start += concurrency) {
    const batch = files.slice(start, start + concurrency);
    const contents = await Promise.all(batch.map((file) => readFile(file)));
    for (let offset = 0; offset < batch.length; offset += 1) {
      const relativePath = path.relative(root, batch[offset]).split(path.sep).join('/');
      hash.update(relativePath);
      hash.update('\0');
      hash.update(contents[offset]);
      hash.update('\0');
    }
  }

  return hash.digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  const root = argument('--root', args) || process.cwd();
  const fingerprint = await calculateSourceFingerprint(root);
  process.stdout.write(fingerprint + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
