type DirectoryWritePermission = {
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
};

const imageExtensions: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
};

async function requireDirectoryWritePermission(handle: FileSystemDirectoryHandle): Promise<void> {
  // TypeScript's DOM definitions omit the File System Access permission methods.
  const directory = handle as FileSystemDirectoryHandle & DirectoryWritePermission;
  try {
    const permission = await directory.queryPermission?.({ mode: 'readwrite' });
    if (permission === 'granted') return;
    if (await directory.requestPermission?.({ mode: 'readwrite' }) === 'granted') return;
  } catch {
    throw new Error('无法获取目录写入权限，请重新选择本地目录并允许写入。');
  }
  throw new Error('目录写入权限未获授权，请重新选择本地目录并允许写入。');
}

/**
 * Save browser-visible, archived image URLs to the user's selected directory.
 * The caller owns directory selection, persistence and user notifications.
 */
export async function saveImagesToDirectory(
  handle: FileSystemDirectoryHandle,
  images: readonly { url: string }[],
): Promise<void> {
  if (!images.length) return;
  await requireDirectoryWritePermission(handle);

  const savedAt = Date.now();
  const batchId = globalThis.crypto.randomUUID();
  const failures: string[] = [];
  let savedCount = 0;

  for (const [index, image] of images.entries()) {
    let writable: FileSystemWritableFileStream | undefined;
    try {
      const response = await fetch(image.url);
      if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
      const blob = await response.blob();
      const mimeType = (response.headers.get('content-type') || blob.type).split(';')[0].trim().toLowerCase();
      const extension = imageExtensions[mimeType];
      if (!extension) throw new Error('返回内容不是受支持的图片格式');

      const file = await handle.getFileHandle(`SANMAO-${savedAt}-${batchId}-${index + 1}.${extension}`, { create: true });
      writable = await file.createWritable();
      await writable.write(blob);
      await writable.close();
      writable = undefined;
      savedCount += 1;
    } catch (error) {
      if (writable) {
        try {
          await writable.abort();
        } catch {
          // Preserve the original failure and continue saving the other images.
        }
      }
      failures.push(`第 ${index + 1} 张：${error instanceof Error ? error.message : '保存失败'}`);
    }
  }

  if (failures.length) {
    const details = failures.slice(0, 3).join('；');
    const remaining = failures.length > 3 ? `；另有 ${failures.length - 3} 张失败` : '';
    throw new Error(`已保存 ${savedCount}/${images.length} 张图片，${failures.length} 张未保存。${details}${remaining}`);
  }
}
