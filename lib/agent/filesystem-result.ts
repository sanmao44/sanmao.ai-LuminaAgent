import { stat } from 'node:fs/promises';

/** Do not repeat a write when the MCP result cannot be verified. */
export async function verifyFilesystemMove(args: Record<string, unknown>) {
  if (typeof args.source !== 'string' || typeof args.destination !== 'string') return '缺少改名前后的路径，无法核验结果';
  try {
    await stat(args.destination);
    try {
      await stat(args.source);
      // Case-only renames on Windows refer to the same file through both names.
      if (process.platform === 'win32' && args.source.toLowerCase() === args.destination.toLowerCase()) return '';
      return '目标路径存在，但原路径仍然存在，改名结果尚未确认；不要重复执行';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    }
  } catch {
    return '改名后的目标路径无法读取，结果尚未确认；不要重复执行';
  }
}
