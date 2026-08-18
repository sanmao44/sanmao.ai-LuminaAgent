import sharp from 'sharp';

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * Put an angle-console result on the requested canvas without cropping the
 * generated foreground. The foreground uses contain; a softened cover copy
 * only fills the unavoidable canvas margins.
 */
export async function renderAngleOutput(input: Buffer, width: number, height: number, roll = 0) {
  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));
  const normalized = await sharp(input, { failOn: 'none' }).rotate().png().toBuffer();

  const backdrop = await sharp(normalized)
    .resize(targetWidth, targetHeight, { fit: 'cover', position: 'centre' })
    .blur(Math.max(12, Math.round(Math.min(targetWidth, targetHeight) * 0.025)))
    .modulate({ brightness: 0.76, saturation: 0.92 })
    .png()
    .toBuffer();

  let foregroundPipeline = sharp(normalized);
  if (Math.abs(roll) >= 0.05) {
    // Rotate before fitting to the final canvas. `contain` then scales the
    // complete rolled frame into the canvas instead of cutting its corners.
    foregroundPipeline = foregroundPipeline.rotate(roll, { background: TRANSPARENT });
  }
  const foreground = await foregroundPipeline
    .resize(targetWidth, targetHeight, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toBuffer();

  return sharp(backdrop)
    .composite([{ input: foreground, left: 0, top: 0 }])
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .removeAlpha()
    .png()
    .toBuffer();
}

