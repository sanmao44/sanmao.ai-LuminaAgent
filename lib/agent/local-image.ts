import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { filesystemApprovalReason, filesystemPathProblem } from '../mcp/filesystem-policy';

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|webp|gif|bmp)$/i;

export function isLocalImageRead(tool: string, args: Record<string, unknown>) {
  return ['read_media_file', 'read_file'].includes(tool) && typeof args.path === 'string' && IMAGE_EXTENSIONS.test(args.path);
}

/** Keep bytes on the server; only the stored reference enters the conversation. */
export async function importLocalImage(
  target: string,
  options: { roots: readonly string[]; dataDir?: string },
  save: (bytes: Buffer) => Promise<{ url: string }>,
) {
  const resolved = await realpath(target);
  const problem = filesystemPathProblem(resolved, options) || filesystemApprovalReason(resolved, options);
  if (problem) throw new Error(problem);
  if (!IMAGE_EXTENSIONS.test(resolved)) throw new Error('只支持 PNG、JPEG、WebP、GIF 或 BMP 图片');
  const file = await open(resolved, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size <= 0 || info.size > MAX_IMAGE_BYTES) throw new Error('图片必须是小于 32MB 的普通文件');
    const data = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await file.read(data, offset, data.length - offset, offset);
      if (!bytesRead) throw new Error('图片读取不完整，请重试');
      offset += bytesRead;
    }
    const stored = await save(data);
    return { url: stored.url, name: path.basename(resolved), size: data.length };
  } finally {
    await file.close();
  }
}
