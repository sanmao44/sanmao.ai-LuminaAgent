import sharp from 'sharp';

/**
 * Apply the optional Dutch angle as a finished-image operation.  The largest
 * centered rectangle that remains inside the rotated image is cropped and
 * then scaled to the output canvas.  This deliberately sacrifices a little
 * edge content, but never exposes transparent corners or a blurred backdrop.
 */
export async function renderAngleOutput(input: Buffer, width: number, height: number, roll = 0) {
  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));
  const normalized = await sharp(input, { failOn: 'none' }).rotate().png().toBuffer();
  if (Math.abs(roll) < 0.05) {
    return sharp(normalized)
      .resize(targetWidth, targetHeight, { fit: 'cover', position: 'centre' })
      .removeAlpha()
      .png()
      .toBuffer();
  }

  const source = await sharp(normalized).metadata();
  const sourceWidth = source.width || targetWidth;
  const sourceHeight = source.height || targetHeight;
  const radians = Math.abs(roll) * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const targetAspect = targetWidth / targetHeight;
  // For a centered crop with half-width x and half-height y, both corners
  // must satisfy x*cos + y*sin <= sourceWidth/2 and
  // x*sin + y*cos <= sourceHeight/2.  Solve those bounds at target aspect.
  const halfHeight = Math.min(
    sourceWidth / (2 * (targetAspect * cosine + sine)),
    sourceHeight / (2 * (targetAspect * sine + cosine)),
  );
  const cropWidth = Math.max(1, Math.floor(2 * targetAspect * halfHeight) - 1);
  const cropHeight = Math.max(1, Math.floor(2 * halfHeight) - 1);
  const rotated = await sharp(normalized).rotate(roll).png().toBuffer();
  const rotatedMeta = await sharp(rotated).metadata();
  const rotatedWidth = rotatedMeta.width || cropWidth;
  const rotatedHeight = rotatedMeta.height || cropHeight;
  const extractWidth = Math.min(cropWidth, rotatedWidth);
  const extractHeight = Math.min(cropHeight, rotatedHeight);

  return sharp(rotated)
    .extract({
      left: Math.max(0, Math.floor((rotatedWidth - extractWidth) / 2)),
      top: Math.max(0, Math.floor((rotatedHeight - extractHeight) / 2)),
      width: extractWidth,
      height: extractHeight,
    })
    .resize(targetWidth, targetHeight, { fit: 'fill' })
    .removeAlpha()
    .png()
    .toBuffer();
}
