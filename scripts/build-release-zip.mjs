#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

function usage() {
  console.log('用法: node scripts/build-release-zip.mjs --ref <git ref> --output <zip路径>');
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readCentralDirectory(buffer) {
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('ZIP 缺少结束目录记录');

  const count = buffer.readUInt16LE(endOffset + 10);
  const directoryOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  let offset = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP 中央目录格式无效');
    const flags = buffer.readUInt16LE(offset + 8);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameLength);
    entries.push({
      name: nameBytes.toString('utf8'),
      hasNonAsciiName: nameBytes.some((byte) => byte >= 0x80),
      utf8Flag: (flags & 0x0800) !== 0,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const ref = argValue('--ref');
const outputArgument = argValue('--output');
if (!ref || !outputArgument) {
  usage();
  process.exit(1);
}

const output = resolve(outputArgument);
if (existsSync(output)) unlinkSync(output);
execFileSync('git', ['archive', '--format=zip', `--output=${output}`, ref], { stdio: 'inherit' });

const entries = readCentralDirectory(readFileSync(output));
const nonUtf8Names = entries.filter((entry) => entry.hasNonAsciiName && !entry.utf8Flag);
if (nonUtf8Names.length > 0) {
  unlinkSync(output);
  throw new Error(`ZIP 中文文件名未设置 UTF-8 标志：${nonUtf8Names.map((entry) => entry.name).join('、')}`);
}

console.log(`已生成 ${output}`);
console.log(`文件数：${entries.length}`);
console.log(`中文文件名 UTF-8 校验通过：${entries.filter((entry) => entry.hasNonAsciiName).length} 个`);
