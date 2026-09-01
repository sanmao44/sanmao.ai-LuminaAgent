export type LocalEditRasterMode = "edit" | "protect";

/** Count pixels whose alpha means "regenerate this area" in a mask PNG. */
export function calculateEditableCoverage(pixels: Uint8ClampedArray): number {
  if (!pixels.length) return 0;
  let editable = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 128) editable += 1;
  }
  return editable / (pixels.length / 4);
}

function writeAlpha(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  alpha: number,
) {
  if (x < 0 || y < 0 || x >= width) return;
  const index = (y * width + x) * 4;
  pixels[index] = 255;
  pixels[index + 1] = 255;
  pixels[index + 2] = 255;
  pixels[index + 3] = alpha;
}

export function createProtectedMask(width: number, height: number) {
  const pixels = new Uint8ClampedArray(Math.max(0, width * height * 4));
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = 255;
    pixels[index + 1] = 255;
    pixels[index + 2] = 255;
    pixels[index + 3] = 255;
  }
  return pixels;
}
export function applyBrushMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
  mode: LocalEditRasterMode = "edit",
) {
  const safeRadius = Math.max(0, radius);
  const left = Math.max(0, Math.floor(centerX - safeRadius));
  const right = Math.min(width - 1, Math.ceil(centerX + safeRadius));
  const top = Math.max(0, Math.floor(centerY - safeRadius));
  const bottom = Math.min(height - 1, Math.ceil(centerY + safeRadius));
  const radiusSquared = safeRadius * safeRadius;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const distanceX = x + 0.5 - centerX;
      const distanceY = y + 0.5 - centerY;
      if (distanceX * distanceX + distanceY * distanceY <= radiusSquared) {
        writeAlpha(pixels, width, x, y, mode === "edit" ? 0 : 255);
      }
    }
  }
  return pixels;
}

export function applyRectangleMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  mode: LocalEditRasterMode = "edit",
) {
  const left = Math.max(0, Math.floor(Math.min(startX, endX)));
  const right = Math.min(width - 1, Math.ceil(Math.max(startX, endX)) - 1);
  const top = Math.max(0, Math.floor(Math.min(startY, endY)));
  const bottom = Math.min(height - 1, Math.ceil(Math.max(startY, endY)) - 1);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) writeAlpha(pixels, width, x, y, mode === "edit" ? 0 : 255);
  }
  return pixels;
}

export function applyEllipseMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  mode: LocalEditRasterMode = "edit",
) {
  const left = Math.min(startX, endX);
  const right = Math.max(startX, endX);
  const top = Math.min(startY, endY);
  const bottom = Math.max(startY, endY);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const radiusX = Math.max(0.5, (right - left) / 2);
  const radiusY = Math.max(0.5, (bottom - top) / 2);
  for (let y = Math.max(0, Math.floor(top)); y <= Math.min(height - 1, Math.ceil(bottom)); y += 1) {
    for (let x = Math.max(0, Math.floor(left)); x <= Math.min(width - 1, Math.ceil(right)); x += 1) {
      const normalizedX = (x + 0.5 - centerX) / radiusX;
      const normalizedY = (y + 0.5 - centerY) / radiusY;
      if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) writeAlpha(pixels, width, x, y, mode === "edit" ? 0 : 255);
    }
  }
  return pixels;
}
