import type { ChatFile } from '@/lib/client-history';

function triggerDownload(url: string, filename: string, revoke = false) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    if (revoke) window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Downloads either an authenticated artifact URL or the inline file content stored in history. */
export async function downloadChatFile(file: ChatFile): Promise<void> {
    if (file.downloadUrl) {
        const response = await fetch(file.downloadUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(response.status === 404 ? '文件已过期或被清理，请重新生成' : '文件下载失败');
        }
        const objectUrl = URL.createObjectURL(await response.blob());
        triggerDownload(objectUrl, file.name || 'SANMAO-file', true);
        return;
    }

    const blob = file.encoding === 'base64'
        ? new Blob([
            Uint8Array.from(atob(file.content?.replace(/\s/g, '') || ''), (character) => character.charCodeAt(0)),
        ], { type: file.mimeType || 'application/octet-stream' })
        : new Blob([file.content || ''], { type: file.mimeType || 'text/plain;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    triggerDownload(objectUrl, file.name || 'SANMAO-file.txt', true);
}
