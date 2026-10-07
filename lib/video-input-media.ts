import sharp from 'sharp';

export const VIDEO_IMAGE_MAX_EDGE = 2048;
export const VIDEO_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

type ParsedDataUrl = { mime: string; bytes: Buffer };

type VideoReferencePreparationOptions = {
  /** Providers may follow the reference canvas more strongly than aspect_ratio. */
  aspectRatio?: string;
};

function parseImageDataUrl(value: string): ParsedDataUrl | null {
  const match = String(value || '').match(/^data:(image\/[^;,]+)(;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  try {
    return {
      mime: match[1].toLowerCase(),
      bytes: match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8'),
    };
  } catch {
    return null;
  }
}

function toDataUrl(bytes: Buffer, mime: string) {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function parseAspectRatio(value: unknown) {
  const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

/** Frame an image for the requested output ratio while preserving the whole subject. */
export async function fitVideoReferenceToAspect(value: string, aspectRatio?: string) {
  const parsed = parseImageDataUrl(value);
  const targetRatio = parseAspectRatio(aspectRatio);
  if (!parsed || !parsed.bytes.length || !targetRatio) return { value, changed: false };

  const source = sharp(parsed.bytes, { failOn: 'none' }).rotate();
  const metadata = await source.metadata();
  const sourceWidth = Number(metadata.width || 0);
  const sourceHeight = Number(metadata.height || 0);
  if (!sourceWidth || !sourceHeight || Math.abs(sourceWidth / sourceHeight - targetRatio) < 0.01) {
    return { value, changed: false };
  }

  const maxEdge = 1400;
  const width = targetRatio >= 1 ? maxEdge : Math.max(1, Math.round(maxEdge * targetRatio));
  const height = targetRatio >= 1 ? Math.max(1, Math.round(maxEdge / targetRatio)) : maxEdge;
  const background = await source.clone()
    .resize({ width, height, fit: 'cover' })
    .blur(24)
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  const foreground = await source.clone()
    .resize({ width, height, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const framed = await sharp(background)
    .composite([{ input: foreground }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return { value: toDataUrl(framed, 'image/jpeg'), changed: true };
}

async function encodeImage(bytes: Buffer, hasAlpha: boolean, maxEdge: number, quality: number) {
  const resized = sharp(bytes, { failOn: 'none' })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true });

  if (hasAlpha) {
    const png = await resized.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    if (png.length <= VIDEO_IMAGE_MAX_BYTES) return { bytes: png, mime: 'image/png' };
    // A large transparent source is uncommon for video references. Flatten only
    // when PNG compression still exceeds the provider-safe limit.
    const jpeg = await sharp(bytes, { failOn: 'none' })
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    return { bytes: jpeg, mime: 'image/jpeg' };
  }

  const jpeg = await resized.jpeg({ quality, mozjpeg: true }).toBuffer();
  return { bytes: jpeg, mime: 'image/jpeg' };
}

export async function compressVideoImageDataUrl(value: string) {
  const parsed = parseImageDataUrl(value);
  if (!parsed || !parsed.bytes.length) return { value, changed: false, originalBytes: 0, outputBytes: 0 };

  const metadata = await sharp(parsed.bytes, { failOn: 'none' }).metadata();
  const originalBytes = parsed.bytes.length;
  const originalMaxEdge = Math.max(metadata.width || 0, metadata.height || 0);
  if (originalBytes <= VIDEO_IMAGE_MAX_BYTES && originalMaxEdge <= VIDEO_IMAGE_MAX_EDGE) {
    return { value, changed: false, originalBytes, outputBytes: originalBytes };
  }

  let maxEdge = VIDEO_IMAGE_MAX_EDGE;
  let quality = 82;
  let encoded = await encodeImage(parsed.bytes, Boolean(metadata.hasAlpha), maxEdge, quality);
  for (let attempt = 0; attempt < 5 && encoded.bytes.length > VIDEO_IMAGE_MAX_BYTES; attempt += 1) {
    quality = Math.max(52, quality - 7);
    maxEdge = Math.max(1024, Math.round(maxEdge * 0.9));
    encoded = await encodeImage(parsed.bytes, Boolean(metadata.hasAlpha), maxEdge, quality);
  }

  return {
    value: toDataUrl(encoded.bytes, encoded.mime),
    changed: true,
    originalBytes,
    outputBytes: encoded.bytes.length,
  };
}

async function compressOptional(value: string | undefined) {
  return value ? (await compressVideoImageDataUrl(value)).value : value;
}

export async function prepareVideoInputMedia<T extends {
  firstFrame?: string;
  lastFrame?: string;
  referenceImages?: string[];
}>(input: T, options: VideoReferencePreparationOptions = {}) {
  const [firstFrame, lastFrame, referenceImages] = await Promise.all([
    compressOptional(input.firstFrame).then((value) => value ? fitVideoReferenceToAspect(value, options.aspectRatio).then((result) => result.value) : value),
    compressOptional(input.lastFrame).then((value) => value ? fitVideoReferenceToAspect(value, options.aspectRatio).then((result) => result.value) : value),
    Promise.all((input.referenceImages || []).map(async (value) => {
      const compressed = await compressVideoImageDataUrl(value);
      return (await fitVideoReferenceToAspect(compressed.value, options.aspectRatio)).value;
    })),
  ]);
  return { ...input, firstFrame, lastFrame, referenceImages };
}
