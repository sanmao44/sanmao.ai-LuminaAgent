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

export type LocalEditAnnotationMove = {
  /** One or more original positions. The annotation geometry is the target. */
  from: LocalEditAnnotationGeometry[];
};

/** Serializable, source-image-normalized region metadata shown in the editor. */
export type LocalEditAnnotation = {
  id: string;
  kind: LocalEditAnnotationKind;
  description: string;
  geometry: LocalEditAnnotationGeometry;
  move?: LocalEditAnnotationMove;
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

function normalizeGeometry(value: unknown): LocalEditAnnotationGeometry | null {
  if (!value || typeof value !== "object") return null;
  const geometry = value as Record<string, unknown>;
  const kind = String(geometry.kind || "");
  if (kind === "point") {
    return {
      kind: "point",
      x: clampUnit(Number(geometry.x)),
      y: clampUnit(Number(geometry.y)),
      radius: Math.max(0.001, Math.min(1, Number(geometry.radius) || 0.03)),
    };
  }
  if (kind === "brush") {
    const points = Array.isArray(geometry.points)
      ? geometry.points.map(normalizePoint).filter((point): point is LocalEditPoint => Boolean(point))
      : [];
    return points.length
      ? { kind: "brush", points, radius: Math.max(0.001, Math.min(1, Number(geometry.radius) || 0.03)) }
      : null;
  }
  if (kind === "lasso") {
    const points = Array.isArray(geometry.points)
      ? geometry.points.map(normalizePoint).filter((point): point is LocalEditPoint => Boolean(point))
      : [];
    return points.length >= 3 ? { kind: "lasso", points } : null;
  }
  if (kind !== "rectangle" && kind !== "ellipse" && kind !== "smart") return null;
  const x = Math.min(0.999, clampUnit(Number(geometry.x)));
  const y = Math.min(0.999, clampUnit(Number(geometry.y)));
  const width = Math.min(1 - x, Math.max(0.001, Math.min(1, Number(geometry.width) || 0.001)));
  const height = Math.min(1 - y, Math.max(0.001, Math.min(1, Number(geometry.height) || 0.001)));
  return {
    kind,
    x,
    y,
    width,
    height,
    ...(typeof geometry.maskDataUrl === "string" && geometry.maskDataUrl ? { maskDataUrl: geometry.maskDataUrl } : {}),
  } as LocalEditAnnotationGeometry;
}

/** Normalize persisted annotations defensively so old/partial backups remain usable. */
export function normalizeLocalEditAnnotations(value: unknown, limit = 16): LocalEditAnnotation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, Math.max(1, limit)).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const normalized = normalizeGeometry(raw.geometry || (raw.kind ? raw : null));
    if (!normalized) return [];
    const rawMove = raw.move && typeof raw.move === "object" ? raw.move as Record<string, unknown> : null;
    const moveFrom = Array.isArray(rawMove?.from)
      ? rawMove.from.map(normalizeGeometry).filter((geometry): geometry is LocalEditAnnotationGeometry => Boolean(geometry))
      : [];
    return [{
      id: typeof raw.id === "string" && raw.id ? raw.id : `annotation-${index + 1}`,
      kind: normalized.kind,
      description: typeof raw.description === "string" ? raw.description : "",
      geometry: normalized,
      ...(moveFrom.length ? { move: { from: moveFrom } } : {}),
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

/** Rasterize one geometry into the shared editable mask. */
export function applyLocalEditGeometryMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  geometry: LocalEditAnnotationGeometry,
  mode: LocalEditRasterMode = "edit",
  smartMaskPixels?: Uint8ClampedArray,
) {
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

/** Rasterize a normalized annotation, including every saved move source and its target. */
export function applyLocalEditAnnotationMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  annotation: LocalEditAnnotation,
  mode: LocalEditRasterMode = "edit",
  smartMaskPixels?: Uint8ClampedArray,
  moveSmartMaskPixels?: ReadonlyArray<Uint8ClampedArray | undefined>,
) {
  annotation.move?.from.forEach((geometry, index) => {
    applyLocalEditGeometryMask(
      pixels,
      width,
      height,
      geometry,
      mode,
      moveSmartMaskPixels?.[index],
    );
  });
  return applyLocalEditGeometryMask(pixels, width, height, annotation.geometry, mode, smartMaskPixels);
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
    const sourceMasks = annotation.move?.from.map((_, index) => smartMasks?.get(`${annotation.id}:from:${index}`));
    applyLocalEditAnnotationMask(pixels, width, height, annotation, "edit", smartMasks?.get(annotation.id), sourceMasks);
  });
  return pixels;
}

function geometryBounds(geometry: LocalEditAnnotationGeometry) {
  if (geometry.kind === "point") {
    return { x: geometry.x - geometry.radius, y: geometry.y - geometry.radius, width: geometry.radius * 2, height: geometry.radius * 2 };
  }
  if (geometry.kind === "rectangle" || geometry.kind === "ellipse" || geometry.kind === "smart") {
    return { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
  }
  if (geometry.kind !== "brush" && geometry.kind !== "lasso") {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  if (!geometry.points.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = geometry.points.map((point) => point.x);
  const ys = geometry.points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(0, Math.max(...xs) - x), height: Math.max(0, Math.max(...ys) - y) };
}

function movementDirection(annotation: LocalEditAnnotation) {
  const source = annotation.move?.from[annotation.move.from.length - 1];
  if (!source) return "";
  const sourceBounds = geometryBounds(source);
  const targetBounds = geometryBounds(annotation.geometry);
  const dx = targetBounds.x + targetBounds.width / 2 - (sourceBounds.x + sourceBounds.width / 2);
  const dy = targetBounds.y + targetBounds.height / 2 - (sourceBounds.y + sourceBounds.height / 2);
  const horizontal = Math.abs(dx) >= 0.005 ? (dx > 0 ? "右" : "左") : "";
  const vertical = Math.abs(dy) >= 0.005 ? (dy > 0 ? "下" : "上") : "";
  return horizontal || vertical ? `向${vertical}${horizontal}` : "位置微调";
}

/** Compile the region descriptions into a provider-compatible prompt. */
export function compileLocalEditPrompt(prompt: string, annotations: LocalEditAnnotation[] = []) {
  const base = String(prompt || "").trim().replace(/\n\n局部区域说明：[\s\S]*$/u, "").trim();
  const descriptions = normalizeLocalEditAnnotations(annotations)
    .map((annotation, index) => {
      const description = annotation.description.trim();
      if (annotation.move?.from.length) {
        const direction = movementDirection(annotation);
        const history = annotation.move.from.length > 1 ? `（含之前的 ${annotation.move.from.length} 个原位置）` : "";
        return {
          index: index + 1,
          text: `将对象从原位置${history}移动到目标位置（移动方向：${direction}）；清除原位置并自然补全背景；在目标位置重建主体。${description ? `补充说明：${description}` : ""}`,
        };
      }
      return { index: index + 1, text: description };
    })
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

/**
 * Soften the protected/editable boundary of a local-edit mask.
 *
 * The mask contract stores editable pixels as transparent and protected
 * pixels as opaque.  Keeping this operation in pixel space avoids relying on
 * CanvasRenderingContext2D.filter, which is unavailable or inconsistent in
 * some embedded browsers.  A clamped box blur gives a predictable, fast
 * linear feather while preserving the white RGB mask channels.
 */
export function featherLocalEditMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
) {
  if (width <= 0 || height <= 0 || !pixels.length || radius <= 0) {
    return new Uint8ClampedArray(pixels);
  }
  const safeRadius = Math.max(1, Math.round(radius));
  const pixelCount = width * height;
  const alpha = new Float32Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    alpha[pixel] = pixels[pixel * 4 + 3] ?? 255;
  }

  const horizontal = new Float32Array(pixelCount);
  const prefix = new Float64Array(Math.max(width, height) + 1);
  for (let y = 0; y < height; y += 1) {
    prefix[0] = 0;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      prefix[x + 1] = prefix[x] + alpha[row + x];
    }
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - safeRadius);
      const right = Math.min(width - 1, x + safeRadius);
      horizontal[row + x] = (prefix[right + 1] - prefix[left]) / (right - left + 1);
    }
  }

  const output = new Uint8ClampedArray(pixels.length);
  for (let x = 0; x < width; x += 1) {
    prefix[0] = 0;
    for (let y = 0; y < height; y += 1) {
      prefix[y + 1] = prefix[y] + horizontal[y * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      const top = Math.max(0, y - safeRadius);
      const bottom = Math.min(height - 1, y + safeRadius);
      const pixel = y * width + x;
      const index = pixel * 4;
      output[index] = 255;
      output[index + 1] = 255;
      output[index + 2] = 255;
      output[index + 3] = Math.round((prefix[bottom + 1] - prefix[top]) / (bottom - top + 1));
    }
  }
  return output;
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
