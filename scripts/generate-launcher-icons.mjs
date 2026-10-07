import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptsDir, '..');
const sourcePath = path.join(root, 'public', 'icons', 'icon-512.png');
const outputDir = path.join(root, 'assets', 'launcher-icons');

const variants = [
  { name: 'sanmao-windows-blue', color: '#2f80ed', format: 'ico' },
  { name: 'sanmao-lan-green', color: '#20b26b', format: 'ico' },
  { name: 'sanmao-macos-orange', color: '#f08a24', format: 'icns' },
];

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icnsEntries = [
  [16, 'icp4'],
  [32, 'icp5'],
  [48, 'icp6'],
  [128, 'ic07'],
  [256, 'ic08'],
  [512, 'ic09'],
  [1024, 'ic10'],
];

async function renderPng(size, color) {
  return sharp(sourcePath)
    .tint(color)
    .resize(size, size, { fit: 'cover', kernel: 'lanczos3' })
    .png()
    .toBuffer();
}

function makeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = header.length + images.length * 16;
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(image.size === 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size === 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += image.data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

function makeIcns(images) {
  const chunks = images.map(({ type, data }) => {
    const chunk = Buffer.alloc(8);
    chunk.write(type, 0, 4, 'ascii');
    chunk.writeUInt32BE(8 + data.length, 4);
    return Buffer.concat([chunk, data]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

await fs.mkdir(outputDir, { recursive: true });

for (const variant of variants) {
  const outputPath = path.join(outputDir, `${variant.name}.${variant.format}`);
  if (variant.format === 'ico') {
    const images = await Promise.all(
      icoSizes.map(async (size) => ({ size, data: await renderPng(size, variant.color) })),
    );
    await fs.writeFile(outputPath, makeIco(images));
  } else {
    const images = await Promise.all(
      icnsEntries.map(async ([size, type]) => ({ type, data: await renderPng(size, variant.color) })),
    );
    await fs.writeFile(outputPath, makeIcns(images));
  }
  console.log(`Generated ${path.relative(root, outputPath)}`);
}
