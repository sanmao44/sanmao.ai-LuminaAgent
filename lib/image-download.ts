function triggerImageDownload(url: string, filename: string, target = false) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    if (target) {
        anchor.target = '_blank';
        anchor.rel = 'noreferrer';
    }
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}

/** Downloads an image while preserving the existing content-type and data URL fallbacks. */
export async function downloadImage(url: string, filename: string): Promise<void> {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('fetch failed');
        const blob = await response.blob();
        const actualExtension = blob.type.includes('jpeg')
            ? 'jpg'
            : blob.type.includes('webp')
                ? 'webp'
                : blob.type.includes('png')
                    ? 'png'
                    : '';
        if (actualExtension) filename = filename.replace(/\.(png|jpe?g|webp)$/i, `.${actualExtension}`);
        const objectUrl = URL.createObjectURL(blob);
        triggerImageDownload(objectUrl, filename);
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch {
        const dataExtension = url.match(/^data:image\/(png|jpeg|webp)/i)?.[1];
        if (dataExtension) filename = filename.replace(/\.(png|jpe?g|webp)$/i, `.${dataExtension === 'jpeg' ? 'jpg' : dataExtension}`);
        triggerImageDownload(url, filename, true);
    }
}
