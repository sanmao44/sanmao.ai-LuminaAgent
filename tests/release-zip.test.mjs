import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const execFileAsync = promisify(execFile);

function readCentralDirectory(buffer) {
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  assert.notEqual(endOffset, -1, 'ZIP 应包含结束目录记录');

  const count = buffer.readUInt16LE(endOffset + 10);
  const directoryOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  let offset = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, 'ZIP 中央目录条目格式有效');
    const flags = buffer.readUInt16LE(offset + 8);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameLength);
    entries.push({ name: nameBytes.toString('utf8'), nameBytes, flags });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test('发布 ZIP 为中文文件名设置 UTF-8 标志', async () => {
  const temporaryDirectory = await mkdtemp(join(resolve('.data'), 'release-zip-test-'));
  const output = join(temporaryDirectory, 'release.zip');
  try {
    await execFileAsync(process.execPath, [
      'scripts/build-release-zip.mjs',
      '--ref',
      'HEAD',
      '--output',
      output,
    ], { cwd: resolve('.') });

    const entries = readCentralDirectory(await readFile(output));
    const nonAsciiEntries = entries.filter((entry) => entry.nameBytes.some((byte) => byte >= 0x80));
    assert.ok(nonAsciiEntries.length > 0, '发布包应包含当前项目的中文文件名');
    assert.ok(nonAsciiEntries.every((entry) => (entry.flags & 0x0800) !== 0));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
