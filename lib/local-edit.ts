export type LocalEditRasterMode = "edit" | "protect";

export type LocalEditAnnotationKind =
  | "brush"
  | "rectangle"
  | "ellipse"
  | "lasso"
  | "point"
  | "smart";

export type LocalEditPoint = { x: number; y: number };

export type LocalEditAnnotationGeometry =
  | { kind: "brush"; points: LocalEditPoint[]; radius: number }
  | { kind: "rectangle" | "ellipse"; x: number; y: number; width: number; height: number }
  | { kind: "lasso"; points: LocalEditPoint[] }
  | { kind: "point"; x: number; y: number; radius: number }
  /** A smart-selection mask can be supplied by an optional local provider. */
  | { kind: "smart"; x: number; y: number; width: number; height: number; maskDataUrl?: string };

/** Serializable, source-image-normalized region metadata shown in the editor. */
export type LocalEditAnnotation = {
  id: string;
  kind: LocalEditAnnotationKind;
  description: string;
  geometry: LocalEditAnnotationGeometry;
  createdAt: number;
};

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function normalizePoint(value: unknown): LocalEditPoint | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return { x: clampUnit(Number(raw.x)), y: clampUnit(Number(raw.y)) };
}

/** Normalize persisted annotations defensively so old/partial backups remain usable. */
export function normalizeLocalEditAnnotations(value: unknown, limit = 16): LocalEditAnnotation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, Math.max(1, limit)).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const rawGeometry = raw.geometry;
    if (!rawGeometry || typeof rawGeometry !== "object") return [];
    const geometry = rawGeometry as Record<string, unknown>;
    const kind = String(geometry.kind || raw.kind || "");
    let normalized: LocalEditAnnotationGeometry | null = null;
    if (kind === "point") {
      normalized = {
        kind: "point",
        x: clampUnit(Number(geometry.x)),
        y: clampUnit(Number(geometry.y)),
        radius: Math.max(0.001, Math.min(1, Number(geometry.radius) || 0.03)),
      };
    } else if (kind === "brush") {
      const points = Array.isArray(geometry.points)
        ? geometry.points.map(normalizePoint).filter((point): point is LocalEditPoint => Boolean(point))
        : [];
      if (points.length) normalized = { kind: "brush", points, radius: Math.max(0.001, Math.min(1, Number(geometry.radius) || 0.03)) };
    } else if (kind === "lasso") {
      const points = Array.isArray(geometry.points)
        ? geometry.points.map(normalizePoint).filter((point): point is LocalEditPoint => Boolean(point))
        : [];
      if (points.length >= 3) normalized = { kind: "lasso", points };
    } else if (kind === "rectangle" || kind === "ellipse" || kind === "smart") {
      const x = Math.min(0.999, clampUnit(Number(geometry.x)));
      const y = Math.min(0.999, clampUnit(Number(geometry.y)));
      const width = Math.min(1 - x, Math.max(0.001, Math.min(1, Number(geometry.width) || 0.001)));
      const height = Math.min(1 - y, Math.max(0.001, Math.min(1, Number(geometry.height) || 0.001)));
      normalized = {
        kind,
        x,
        y,
        width,
        height,
        ...(typeof geometry.maskDataUrl === "string" && geometry.maskDataUrl ? { maskDataUrl: geometry.maskDataUrl } : {}),
      } as LocalEditAnnotationGeometry;
    }
    if (!normalized) return [];
    return [{
      id: typeof raw.id === "string" && raw.id ? raw.id : `annotation-${index + 1}`,
      kind: normalized.kind,
      description: typeof raw.description === "string" ? raw.description : "",
      geometry: normalized,
      createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
    }];
  });
}

function sourcePoint(point: LocalEditPoint, width: number, height: number) {
  return { x: clampUnit(point.x) * width, y: clampUnit(point.y) * height };
}

function sourceRadius(radius: number, width: number, height: number) {
  return Math.max(1, Math.max(width, height) * Math.max(0.001, Math.min(1, radius)));
}

/** Rasterize one normalized annotation into the shared editable mask. */
export function applyLocalEditAnnotationMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  annotation: LocalEditAnnotation,
  mode: LocalEditRasterMode = "edit",
  smartMaskPixels?: Uint8ClampedArray,
) {
  const geometry = annotation.geometry;
  if (geometry.kind === "smart" && smartMaskPixels) {
    const pixelCount = Math.min(pixels.length, smartMaskPixels.length);
    for (let index = 3; index < pixelCount; index += 4) {
      // Smart providers return the same mask convention as the service API:
      // transparent pixels are selected for editing, opaque pixels are kept.
      if (smartMaskPixels[index] < 128) {
        pixels[index - 3] = 255;
        pixels[index - 2] = 255;
        pixels[index - 1] = 255;
        pixels[index] = mode === "edit" ? 0 : 255;
      }
    }
    return pixels;
  }
  if (geometry.kind === "point") {
    const point = sourcePoint(geometry, width, height);
    return applyBrushMask(pixels, width, height, point.x, point.y, sourceRadius(geometry.radius, width, height), mode);
  }
  if (geometry.kind === "brush") {
    const points = geometry.points.map((item) => sourcePoint(item, width, height));
    for (let index = 0; index < points.length; index += 1) {
      applyBrushMask(pixels, width, height, points[index].x, points[index].y, sourceRadius(geometry.radius, width, height), mode);
      if (index > 0) {
        const previous = points[index - 1];
        const current = points[index];
        const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
        const steps = Math.max(1, Math.ceil(distance / Math.max(1, sourceRadius(geometry.radius, width, height) * 0.55)));
        for (let step = 1; step < steps; step += 1) {
          const ratio = step / steps;
          applyBrushMask(pixels, width, height, previous.x + (current.x - previous.x) * ratio, previous.y + (current.y - previous.y) * ratio, sourceRadius(geometry.radius, width, height), mode);
        }
      }
    }
    return pixels;
  }
  if (geometry.kind === "lasso") {
    const points = geometry.points.map((item) => sourcePoint(item, width, height));
    if (points.length < 3) return pixels;
    const minX = Math.max(0, Math.floor(Math.min(...points.map((item) => item.x))));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(...points.map((item) => item.x))));
    const minY = Math.max(0, Math.floor(Math.min(...points.map((item) => item.y))));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(...points.map((item) => item.y))));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        let inside = false;
        for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
          const current = points[index];
          const before = points[previous];
          const intersects = ((current.y > y) !== (before.y > y)) && x < ((before.x - current.x) * (y - current.y)) / (before.y - current.y || 1) + current.x;
          if (intersects) inside = !inside;
        }
        if (inside) writeAlpha(pixels, width, x, y, mode === "edit" ? 0 : 255);
      }
    }
    return pixels;
  }
  const left = clampUnit(geometry.x) * width;
  const top = clampUnit(geometry.y) * height;
  const right = Math.min(width, left + Math.max(1, geometry.width * width));
  const bottom = Math.min(height, top + Math.max(1, geometry.height * height));
  if (geometry.kind === "ellipse") return applyEllipseMask(pixels, width, height, left, top, right, bottom, mode);
  return applyRectangleMask(pixels, width, height, left, top, right, bottom, mode);
}

/** Rasterize and merge a collection of normalized annotations into one mask. */
export function rasterizeLocalEditAnnotations(
  width: number,
  height: number,
  annotations: LocalEditAnnotation[] = [],
  smartMasks?: ReadonlyMap<string, Uint8ClampedArray>,
) {
  const pixels = createProtectedMask(width, height);
  normalizeLocalEditAnnotations(annotations).forEach((annotation) => {
    applyLocalEditAnnotationMask(
      pixels,
      width,
      height,
      annotation,
      "edit",
      smartMasks?.get(annotation.id),
    );
  });
  return pixels;
}

/** Compile the region descriptions into a provider-compatible prompt. */
export function compileLocalEditPrompt(prompt: string, annotations: LocalEditAnnotation[] = []) {
  const base = String(prompt || "").trim().replace(/\n\n局部区域说明：[\s\S]*$/u, "").trim();
  const descriptions = normalizeLocalEditAnnotations(annotations)
    .map((annotation, index) => ({ index: index + 1, text: annotation.description.trim() }))
    .filter((item) => item.text);
  if (!descriptions.length) return base;
  const context = descriptions.map((item) => `区域 ${item.index}：${item.text}`).join("\n");
  return base
    ? `${base}\n\n局部区域说明：\n${context}`
    : `请根据以下局部区域说明进行局部重绘：\n${context}`;
}

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
