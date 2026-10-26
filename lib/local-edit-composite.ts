import sharp from 'sharp';
import { resolveStoredImageReference } from './image-storage';
import { repairLocalEditMoveSource } from './local-edit';
import type { GeneratedImage } from './types';

const MAX_IMAGE_BYTES = 100 * 1024 * 1024;

type RawRgba = {
  data: Buffer;
  info: { width: number; height: number; channels: number };
};

function parseDataUrl(value: string) {
  const match = String(value || '').match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  try {
    const data = match[2]
      ? Buffer.from(match[3], 'base64')
      : Buffer.from(decodeURIComponent(match[3]), 'utf8');
    if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES) throw new Error('image is too large');
    return data;
  } catch (error) {
    if (error instanceof Error && error.message === 'image is too large') throw error;
    return null;
  }
}

async function readImageBytes(value: string, storagePath?: string, signal?: AbortSignal) {
  const input = String(value || '').trim();
  const embedded = parseDataUrl(input);
  if (embedded) return embedded;

  if (input.startsWith('/api/storage/file?')) {
    const resolved = await resolveStoredImageReference(input, storagePath);
    const stored = parseDataUrl(resolved);
    if (stored) return stored;
  }

  if (/^https?:\/\//i.test(input)) {
    const timeout = AbortSignal.timeout(30_000);
    const fetchSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(input, { signal: fetchSignal, cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error(`Unable to read local-edit image: HTTP ${response.status}`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_BYTES) throw new Error('Local-edit image is too large');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('Local-edit image is too large');
    return bytes;
  }

  throw new Error('Unable to read the local-edit source image');
}

async function toRawRgba(input: Buffer, width?: number, height?: number, mask = false): Promise<RawRgba> {
  let pipeline = sharp(input, { failOn: 'none' });
  if (!mask) pipeline = pipeline.rotate();
  // Providers may return grayscale or palette images. Normalize every input
  // to four channels before applying the pixel-level mask operation.
  pipeline = pipeline.toColourspace('srgb').ensureAlpha();
  if (width && height) {
    pipeline = pipeline.resize(width, height, {
      fit: 'fill',
      kernel: mask ? sharp.kernel.nearest : sharp.kernel.lanczos3,
    });
  }
  const result = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { data: result.data, info: result.info };
}

/**
 * Merge a generated RGBA image with its source using the PNG mask contract:
 * transparent mask pixels are editable and opaque pixels are protected.
 */
export function compositeLocalEditPixels(
  source: Uint8Array,
  generated: Uint8Array,
  mask: Uint8Array,
  moveSource?: { mask: Uint8Array; original: Uint8Array; width: number; height: number },
) {
  if (source.length !== generated.length || source.length !== mask.length || source.length % 4 !== 0) {
    throw new Error('Local-edit images must have matching RGBA buffers');
  }
  if (moveSource && (moveSource.mask.length !== source.length || moveSource.original.length !== source.length)) {
    throw new Error('Move source images must have matching RGBA buffers');
  }
  let generatedPixels = generated;
  if (moveSource) {
    const duplicateMask = moveSourceDuplicateMask(
      generated,
      moveSource.original,
      source,
      moveSource.mask,
    );
    if (duplicateMask) {
      // Keep the Provider's surrounding pixels as the background and repair
      // only the pixels that still look like the old subject. Replacing the
      // whole source selection with the synthetic guide creates visible
      // seams in textured scenes.
      generatedPixels = Uint8Array.from(
        repairLocalEditMoveSource(
          Uint8ClampedArray.from(generated),
          duplicateMask,
          moveSource.width,
          moveSource.height,
        ),
      );
    }
  }
  const output = new Uint8ClampedArray(source.length);
  for (let index = 0; index < source.length; index += 4) {
    const protection = mask[index + 3] / 255;
    if (protection >= 1) {
      output[index] = source[index];
      output[index + 1] = source[index + 1];
      output[index + 2] = source[index + 2];
      output[index + 3] = source[index + 3];
      continue;
    }
    if (protection <= 0) {
      output[index] = generatedPixels[index];
      output[index + 1] = generatedPixels[index + 1];
      output[index + 2] = generatedPixels[index + 2];
      output[index + 3] = generatedPixels[index + 3];
      continue;
    }
    const editWeight = 1 - protection;
    for (let channel = 0; channel < 4; channel += 1) {
      output[index + channel] = Math.round(
        source[index + channel] * protection + generatedPixels[index + channel] * editWeight,
      );
    }
  }
  return output;
}

function moveSourceDuplicateMask(
  generated: Uint8Array,
  original: Uint8Array,
  repaired: Uint8Array,
  moveMask: Uint8Array,
): Uint8ClampedArray | undefined {
  const duplicateMask = new Uint8ClampedArray(moveMask.length);
  for (let index = 0; index < duplicateMask.length; index += 4) {
    duplicateMask[index] = 255;
    duplicateMask[index + 1] = 255;
    duplicateMask[index + 2] = 255;
    duplicateMask[index + 3] = 255;
  }
  let objectPixels = 0;
  let retainedPixels = 0;
  for (let index = 3; index < moveMask.length; index += 4) {
    if (moveMask[index] >= 32) continue;
    const repairedDifference = (
      Math.abs(original[index - 3] - repaired[index - 3])
      + Math.abs(original[index - 2] - repaired[index - 2])
      + Math.abs(original[index - 1] - repaired[index - 1])
    ) / 3;
    // The repaired guide is a cheap background estimate. Pixels that differ
    // materially from it are the useful object core for duplicate detection.
    if (repairedDifference < 24) continue;
    objectPixels += 1;
    const generatedOriginalDifference = (
      Math.abs(generated[index - 3] - original[index - 3])
      + Math.abs(generated[index - 2] - original[index - 2])
      + Math.abs(generated[index - 1] - original[index - 1])
    ) / 3;
    const generatedRepairedDifference = (
      Math.abs(generated[index - 3] - repaired[index - 3])
      + Math.abs(generated[index - 2] - repaired[index - 2])
      + Math.abs(generated[index - 1] - repaired[index - 1])
    ) / 3;
    if (generatedOriginalDifference + 8 <= generatedRepairedDifference) retainedPixels += 1;
    if (generatedOriginalDifference + 8 <= generatedRepairedDifference) {
      duplicateMask[index - 3] = 255;
      duplicateMask[index - 2] = 255;
      duplicateMask[index - 1] = 255;
      duplicateMask[index] = 0;
    }
  }
  return objectPixels > 0 && retainedPixels / objectPixels >= 0.45
    ? duplicateMask
    : undefined;
}

async function compositeLocalEditImage(
  image: GeneratedImage,
  sourceBytes: Buffer,
  maskBytes: Buffer,
  moveSourceMaskBytes?: Buffer,
  moveSourceOriginalBytes?: Buffer,
  storagePath?: string,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw signal.reason || new Error('GENERATION_CANCELLED');
  const generated = await toRawRgba(await readImageBytes(image.url, storagePath, signal));
  const width = Math.max(1, generated.info.width);
  const height = Math.max(1, generated.info.height);
  const [source, mask, moveSourceMask, moveSourceOriginal] = await Promise.all([
    toRawRgba(sourceBytes, width, height),
    toRawRgba(maskBytes, width, height, true),
    moveSourceMaskBytes ? toRawRgba(moveSourceMaskBytes, width, height, true) : Promise.resolve(undefined),
    moveSourceOriginalBytes ? toRawRgba(moveSourceOriginalBytes, width, height) : Promise.resolve(undefined),
  ]);
  if (source.info.channels !== 4 || generated.info.channels !== 4 || mask.info.channels !== 4) {
    throw new Error('Local-edit images could not be decoded as RGBA');
  }
  const pixels = compositeLocalEditPixels(
    source.data,
    generated.data,
    mask.data,
    moveSourceMask && moveSourceOriginal
      ? {
          mask: moveSourceMask.data,
          original: moveSourceOriginal.data,
          width,
          height,
        }
      : undefined,
  );
  const output = await sharp(Buffer.from(pixels), {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();
  return { ...image, url: `data:image/png;base64,${output.toString('base64')}` };
}

/**
 * Enforce local editing after the Provider response. This deliberately fails
 * closed: a malformed source, result, or mask must not leak an unconstrained
 * full-image result to the user.
 */
export async function enforceLocalEditMask(
  images: GeneratedImage[],
  sourceReference: string,
  maskReference: string,
  options: {
    storagePath?: string;
    signal?: AbortSignal;
    moveSourceMaskReference?: string;
    moveSourceOriginalReference?: string;
  } = {},
) {
  if (!images.length) return images;
  const [sourceBytes, maskBytes, moveSourceMaskBytes, moveSourceOriginalBytes] = await Promise.all([
    readImageBytes(sourceReference, options.storagePath, options.signal),
    readImageBytes(maskReference, options.storagePath, options.signal),
    options.moveSourceMaskReference
      ? readImageBytes(options.moveSourceMaskReference, options.storagePath, options.signal)
      : Promise.resolve(undefined),
    options.moveSourceOriginalReference
      ? readImageBytes(options.moveSourceOriginalReference, options.storagePath, options.signal)
      : Promise.resolve(undefined),
  ]);
  return Promise.all(images.map((image) => compositeLocalEditImage(
    image,
    sourceBytes,
    maskBytes,
    moveSourceMaskBytes,
    moveSourceOriginalBytes,
    options.storagePath,
    options.signal,
  )));
}
