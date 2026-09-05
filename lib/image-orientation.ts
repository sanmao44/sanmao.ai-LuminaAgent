import sharp from 'sharp';
import type { GeneratedImage } from './types';

type ProviderIdentity = { name?: string; baseUrl?: string };
type ImageRequest = { aspectRatio?: string; width?: number; height?: number; sizeMode?: 'system' | 'custom' };

const STARAPI_TARGET_SIZES: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1536, height: 864 },
  '9:16': { width: 864, height: 1536 },
  '4:3': { width: 1536, height: 1152 },
  '3:4': { width: 1152, height: 1536 },
  '3:2': { width: 1536, height: 1024 },
  '2:3': { width: 1024, height: 1536 },
  '5:4': { width: 1280, height: 1024 },
  '4:5': { width: 1024, height: 1280 },
  '2:1': { width: 1536, height: 768 },
  '1:2': { width: 768, height: 1536 },
  '21:9': { width: 1680, height: 720 },
  '9:21': { width: 720, height: 1680 },
};
const STARAPI_LANDSCAPE_NOTE = 'Landscape-oriented wide composition, 16:9 horizontal framing. Expand the scene left and right; do not use portrait or vertical framing.';
const STARAPI_SQUARE_NOTE = 'Square composition, 1:1 framing. Keep the subject fully inside a square frame; do not use portrait or landscape framing.';
const STARAPI_RATIO_TOLERANCE = 0.01;

function isStarApiProvider(provider: ProviderIdentity) {
  let hostname = '';
  try { hostname = new URL(provider.baseUrl || '').hostname.toLowerCase(); } catch { /* malformed custom URLs stay on the generic path */ }
  return /(?:^|\.)starapi\.cc$/i.test(hostname) || /star[\s_-]*api/i.test(String(provider.name || ''));
}

function isStarApiGptImage2(provider: ProviderIdentity, rawModelId: string) {
  return isStarApiProvider(provider) && String(rawModelId || '').trim().toLowerCase() === 'gpt-image-2';
}

function ratioValue(input: ImageRequest) {
  const ratio = String(input.aspectRatio || '').trim();
  if (ratio && ratio !== '自动' && ratio !== '自定义') {
    const [width, height] = ratio.split(':').map(Number);
    if (width > 0 && height > 0) return width / height;
  }
  if (ratio === '自定义') {
    const width = Number(input.width);
    const height = Number(input.height);
    return width > 0 && height > 0 ? width / height : 0;
  }
  return 0;
}

function ratioMatches(actual: number, requested: number) {
  return Math.abs(actual - requested) / requested <= STARAPI_RATIO_TOLERANCE;
}

function frameKind(input: ImageRequest) {
  const ratio = ratioValue(input);
  if (!ratio) return null;
  if (ratio > 1.05) return 'landscape';
  if (ratio < 0.95) return 'portrait';
  return 'square';
}

function requestedRatioLabel(input: ImageRequest) {
  const label = String(input.aspectRatio || '').trim();
  if (label && label !== '自动' && label !== '自定义') return label;
  if (label === '自定义') {
    const width = Math.round(Number(input.width));
    const height = Math.round(Number(input.height));
    if (width > 0 && height > 0) return `${width}:${height}`;
  }
  return '';
}

function landscapeNote(input: ImageRequest) {
  const label = requestedRatioLabel(input);
  if (label === '16:9') return STARAPI_LANDSCAPE_NOTE;
  return `Landscape-oriented composition, ${label || 'wide'} horizontal framing. Expand the scene left and right; do not use portrait or vertical framing.`;
}

function targetSize(input: ImageRequest, requestedRatio: number) {
  const width = Math.round(Number(input.width));
  const height = Math.round(Number(input.height));
  const hasDimensions = width > 0 && height > 0;
  const requestedLabel = String(input.aspectRatio || '').trim();

  if (input.sizeMode === 'custom' && hasDimensions && ratioMatches(width / height, requestedRatio)) {
    return { width, height };
  }

  const preset = STARAPI_TARGET_SIZES[requestedLabel];
  if (preset) return preset;

  if (hasDimensions && ratioMatches(width / height, requestedRatio)) {
    return { width, height };
  }

  const [rawWidth, rawHeight] = requestedLabel.split(':').map(Number);
  if (rawWidth > 0 && rawHeight > 0) {
    const divisor = greatestCommonDivisor(rawWidth, rawHeight);
    const reducedWidth = rawWidth / divisor;
    const reducedHeight = rawHeight / divisor;
    const scale = Math.max(1, Math.floor(1536 / Math.max(reducedWidth, reducedHeight)));
    return { width: reducedWidth * scale, height: reducedHeight * scale };
  }

  return { width: 1024, height: 1024 };
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/** Remove only orientation phrases that contradict a user-selected frame. */
export function normalizeStarApiLandscapePrompt(provider: ProviderIdentity, rawModelId: string, prompt: string, input: ImageRequest) {
  const kind = frameKind(input);
  if (!isStarApiGptImage2(provider, rawModelId) || (kind !== 'landscape' && kind !== 'square')) return prompt;
  const cleaned = kind === 'landscape'
    ? prompt
      .replace(/垂直构图|竖版构图|纵向构图|竖幅构图/g, '横向构图')
      .replace(/\b(?:portrait|vertical)[ -](?:composition|orientation|format|layout|framing)\b/gi, 'landscape framing')
    : prompt
      .replace(/垂直构图|竖版构图|纵向构图|竖幅构图|横向构图|横版构图|横幅构图/g, '方形构图')
      .replace(/\b(?:portrait|vertical|landscape|horizontal)[ -](?:composition|orientation|format|layout|framing)\b/gi, 'square framing');
  const note = kind === 'landscape' ? landscapeNote(input) : STARAPI_SQUARE_NOTE;
  return cleaned.includes(note) ? cleaned : `${cleaned.trim()}\n\n${note}`;
}

function dataUrlBuffer(url: string) {
  const match = url.match(/^data:[^;,]+(?:;base64)?,[\s\S]*$/);
  if (!match) return null;
  const comma = url.indexOf(',');
  const metadata = url.slice(0, comma);
  const body = url.slice(comma + 1);
  return metadata.toLowerCase().includes(';base64')
    ? Buffer.from(body, 'base64')
    : Buffer.from(decodeURIComponent(body), 'utf8');
}

async function imageBuffer(url: string, signal?: AbortSignal) {
  const embedded = dataUrlBuffer(url);
  if (embedded) return embedded;
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const response = await fetch(url, { signal, cache: 'no-store' });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch { return null; }
}

/**
 * StarAPI may ignore the requested image ratio and return its default native
 * frame. Preserve the complete source in the requested canvas instead of
 * silently stretching or cropping the subject. This is intentionally scoped
 * to the one incompatible provider/model combination.
 */
export async function normalizeStarApiLandscapeImages(provider: ProviderIdentity, rawModelId: string, input: ImageRequest, images: GeneratedImage[], signal?: AbortSignal) {
  const requestedRatio = ratioValue(input);
  if (!isStarApiGptImage2(provider, rawModelId) || !requestedRatio) return images;
  const requestedSize = targetSize(input, requestedRatio);
  return Promise.all(images.map(async (image) => {
    const bytes = await imageBuffer(image.url, signal);
    if (!bytes) return image;
    try {
      const source = sharp(bytes, { failOn: 'none' }).rotate();
      const metadata = await source.metadata();
      if (!metadata.width || !metadata.height) return image;
      const actualRatio = metadata.width / metadata.height;
      const exactCustomSize = input.sizeMode === 'custom'
        && metadata.width === requestedSize.width
        && metadata.height === requestedSize.height;
      if (ratioMatches(actualRatio, requestedRatio) && (input.sizeMode !== 'custom' || exactCustomSize)) return image;
      const background = metadata.hasAlpha ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 0, g: 0, b: 0, alpha: 1 };
      const output = await source.resize({ ...requestedSize, fit: 'contain', background }).png().toBuffer();
      return { ...image, url: `data:image/png;base64,${output.toString('base64')}` };
    } catch { return image; }
  }));
}
