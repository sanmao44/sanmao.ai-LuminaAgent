import sharp from 'sharp';

export const VIDEO_IMAGE_MAX_EDGE = 2048;
export const VIDEO_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

type ParsedDataUrl = { mime: string; bytes: Buffer };

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
}>(input: T) {
  const [firstFrame, lastFrame, referenceImages] = await Promise.all([
    compressOptional(input.firstFrame),
    compressOptional(input.lastFrame),
    Promise.all((input.referenceImages || []).map((value) => compressVideoImageDataUrl(value).then((result) => result.value))),
  ]);
  return { ...input, firstFrame, lastFrame, referenceImages };
}
