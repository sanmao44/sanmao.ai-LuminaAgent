import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import type { CloneOcrBounds, CloneOcrObservation } from './types';

type OcrResult = { observations: CloneOcrObservation[]; engine: 'tesseract' };

function resolveTesseract() {
  const candidates = [
    process.env.SANMAO_TESSERACT_PATH,
    process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tesseract-OCR', 'tesseract.exe') : '',
    process.platform === 'win32' ? path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Tesseract-OCR', 'tesseract.exe') : '',
    'tesseract',
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => {
    if (candidate !== 'tesseract') return existsSync(candidate);
    try {
      return spawnSync(candidate, ['--version'], { windowsHide: true, stdio: 'ignore' }).status === 0;
    } catch {
      return false;
    }
  }) || null;
}

function run(command: string, args: string[], timeoutMs = 30_000) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* process already exited */ }
      reject(new Error('本地 OCR 执行超时'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function parseTsv(stdout: string, width: number, height: number): CloneOcrObservation[] {
  const result: CloneOcrObservation[] = [];
  for (const line of stdout.split(/\r?\n/u).slice(1)) {
    const fields = line.split('\t');
    if (fields.length < 12) continue;
    const confidence = Number(fields[10]);
    const text = fields.slice(11).join('\t').trim();
    const left = Number(fields[6]);
    const top = Number(fields[7]);
    const boxWidth = Number(fields[8]);
    const boxHeight = Number(fields[9]);
    if (!text || !Number.isFinite(confidence) || confidence < 0 || !Number.isFinite(left) || !Number.isFinite(top) || boxWidth <= 0 || boxHeight <= 0) continue;
    const bounds: CloneOcrBounds = {
      x: Math.max(0, Math.min(1, left / Math.max(1, width))),
      y: Math.max(0, Math.min(1, top / Math.max(1, height))),
      width: Math.max(0, Math.min(1, boxWidth / Math.max(1, width))),
      height: Math.max(0, Math.min(1, boxHeight / Math.max(1, height))),
    };
    result.push({ text, bounds, confidence: Math.round(confidence) / 100, source: 'tesseract' });
  }
  return result;
}

async function imageSize(file: string) {
  // PNG/JPEG dimensions are enough for normalizing OCR boxes and avoid adding
  // another media probe to the clone pipeline.
  const buffer = await readFile(file);
  const isPng = buffer.length >= 24
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a;
  if (isPng) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < buffer.length) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      offset += Math.max(2, length + 2);
    }
  }
  return { width: 1, height: 1 };
}

export async function ocrImageFile(file: string): Promise<OcrResult | null> {
  const command = resolveTesseract();
  if (!command) return null;
  const size = await imageSize(file);
  const languages = process.env.SANMAO_TESSERACT_LANG ? [process.env.SANMAO_TESSERACT_LANG] : ['eng+chi_sim', 'eng'];
  for (const language of languages) {
    try {
      const result = await run(command, [file, 'stdout', '-l', language, '--psm', '11', 'tsv']);
      if (result.code !== 0) continue;
      return { observations: parseTsv(result.stdout, size.width, size.height), engine: 'tesseract' };
    } catch {
      return null;
    }
  }
  return null;
}

export function parseTesseractTsv(stdout: string, width: number, height: number) {
  return parseTsv(stdout, width, height);
}

export function mergeOcrText(observations: readonly CloneOcrObservation[]) {
  return [...new Set(observations.map((item) => item.text.replace(/\s+/gu, ' ').trim()).filter(Boolean))].join(' ');
}

export function localOcrAvailable() {
  return Boolean(resolveTesseract());
}

export function ocrPosition(bounds?: CloneOcrBounds) {
  if (!bounds) return undefined;
  const centerY = bounds.y + bounds.height / 2;
  const centerX = bounds.x + bounds.width / 2;
  const vertical = centerY < 0.33 ? 'top' : centerY > 0.67 ? 'bottom' : 'center';
  const horizontal = centerX < 0.33 ? 'left' : centerX > 0.67 ? 'right' : 'center';
  return `${vertical}-${horizontal}`;
}
