function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Convert a source frame into a stable grayscale depth-like fallback frame. */
export function applyFallbackDepthPixels(pixels: Uint8ClampedArray) {
  for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
    const luminance = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
    const depthValue = clampByte((luminance - 128) * 1.18 + 128);
    pixels[offset] = depthValue;
    pixels[offset + 1] = depthValue;
    pixels[offset + 2] = depthValue;
    pixels[offset + 3] = 255;
  }
  return pixels;
}
