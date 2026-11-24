import { isPublicCangyuanMediaUrl, type Cangyuan3DOptions } from '@/packages/contracts/cangyuan-media';
import { asDataUrl } from './api';
import { canvasFileFromDataUrl } from './file-input';
import { CANVAS_THREE_D_VIEWS } from './three-d-references';

/** Publish browser-local references through the same relay as the upload control. */
export async function publishCanvasThreeDReferences(options: Cangyuan3DOptions): Promise<Cangyuan3DOptions> {
  const uploaded = new Map<string, Promise<string>>();
  const publish = async (url: string) => {
    if (isPublicCangyuanMediaUrl(url) && new URL(url).pathname !== '/api/storage/file') return url;
    const previous = uploaded.get(url);
    if (previous) return previous;
    const pending = (async () => {
      const file = canvasFileFromDataUrl(await asDataUrl(url), '三维参考图.png');
      const form = new FormData();
      form.set('kind', 'image');
      form.set('file', file);
      const response = await fetch('/api/cangyuan/media/upload', { method: 'POST', body: form });
      const payload = await response.json().catch(() => null) as { url?: unknown; error?: unknown } | null;
      if (!response.ok || typeof payload?.url !== 'string' || !isPublicCangyuanMediaUrl(payload.url)) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : '画布参考图准备失败，请重新选择。');
      }
      return payload.url;
    })();
    uploaded.set(url, pending);
    return pending;
  };
  const next = { ...options };
  if (options.mode === 'image-to-3d' && options.imageUrl) next.imageUrl = await publish(options.imageUrl);
  if (options.mode === 'multiview-to-3d') {
    next.multiviewImages = {};
    await Promise.all(CANVAS_THREE_D_VIEWS.map(async (view) => {
      const url = options.multiviewImages?.[view];
      if (url) next.multiviewImages![view] = await publish(url);
    }));
  }
  return next;
}
