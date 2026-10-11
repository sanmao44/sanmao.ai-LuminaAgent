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

function isVideoFile(file: ChatFile) {
    const mimeType = String(file.mimeType || '').split(';', 1)[0].trim().toLowerCase();
    return mimeType.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name || '');
}

/** Downloads either an authenticated artifact URL or the inline file content stored in history. */
export async function downloadChatFile(file: ChatFile): Promise<void> {
    if (file.downloadUrl) {
        // Keep large local videos as a browser stream. Fetching them into a Blob
        // first duplicates hundreds of megabytes in memory and makes a click
        // appear to do nothing while the browser buffers the entire file.
        if (isVideoFile(file)) {
            triggerDownload(file.downloadUrl, file.name || 'SANMAO-video');
            return;
        }
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
