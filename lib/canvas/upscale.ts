export type CanvasUpscaleTarget = "auto" | "1K" | "2K" | "4K";

/** Reads the intrinsic dimensions of an image without changing the source. */
export function loadImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({
      width: Math.max(1, Math.round(image.naturalWidth)),
      height: Math.max(1, Math.round(image.naturalHeight)),
    });
    image.onerror = () => reject(new Error("无法读取原图尺寸，请重新上传图片后再试"));
    image.src = url;
  });
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : Math.max(1, Math.abs(a));
}

/** Calculates the same aspect-preserving target size used by the main editor. */
export function seedVrTargetSize(
  width: number,
  height: number,
  scale: number,
  target: CanvasUpscaleTarget,
) {
  const sourceWidth = Math.max(1, Math.round(width));
  const sourceHeight = Math.max(1, Math.round(height));
  const safeScale = Math.max(1, Math.min(4, Number(scale) || 1));
  if (target === "auto") {
    return {
      width: Math.max(1, Math.round(sourceWidth * safeScale)),
      height: Math.max(1, Math.round(sourceHeight * safeScale)),
    };
  }
  const edge = target === "4K" ? 4096 : target === "2K" ? 2048 : 1024;
  const divisor = gcd(sourceWidth, sourceHeight);
  const unitWidth = sourceWidth / divisor;
  const unitHeight = sourceHeight / divisor;
  const multiple = Math.max(1, Math.round(edge / Math.max(unitWidth, unitHeight)));
  return {
    width: Math.max(1, Math.round(unitWidth * multiple)),
    height: Math.max(1, Math.round(unitHeight * multiple)),
  };
}

export function canvasUpscaleSize(
  width: number,
  height: number,
  scale: number,
  target: CanvasUpscaleTarget,
) {
  const result = seedVrTargetSize(width, height, scale, target);
  return `${result.width}x${result.height}`;
}
