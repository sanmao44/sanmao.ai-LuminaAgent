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

/** Every submitted local edit gets a small transition zone, even at UI value 0. */
export const LOCAL_EDIT_MIN_FUSION_FEATHER = 2;

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

/** Return a normalized geometry's visual bounds in source-image coordinates. */
export function localEditGeometryBounds(geometry: LocalEditAnnotationGeometry) {
  if (geometry.kind === "point") {
    return {
      x: geometry.x - geometry.radius,
      y: geometry.y - geometry.radius,
      width: geometry.radius * 2,
      height: geometry.radius * 2,
    };
  }
  if (geometry.kind === "rectangle" || geometry.kind === "ellipse" || geometry.kind === "smart") {
    return { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
  }
  if (geometry.kind === "brush" || geometry.kind === "lasso") {
    const points = geometry.points;
    if (!points.length) return { x: 0, y: 0, width: 0.01, height: 0.01 };
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(0.01, Math.max(...xs) - Math.min(...xs)),
      height: Math.max(0.01, Math.max(...ys) - Math.min(...ys)),
    };
  }
  return { x: 0, y: 0, width: 0.01, height: 0.01 };
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

function withoutConflictingMoveInstruction(prompt: string) {
  return prompt
    .replace(/(?:^|\n)\s*保持主体、姿态和构图不变，只编辑指定范围。?\s*(?=\n|$)/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function stripCompiledLocalEditPrompt(prompt: string) {
  let base = String(prompt || "").replace(/\r\n?/gu, "\n").trim();
  const generatedSection = base.search(/\n\n(?:局部区域说明|局部处理要求)：/u);
  if (generatedSection >= 0) base = base.slice(0, generatedSection).trim();
  if (/^请根据以下局部区域说明进行局部重绘：(?:\n区域 \d+：[\s\S]*)?$/u.test(base)) return "";
  return base;
}

/** Compile the region descriptions into a provider-compatible prompt. */
export function compileLocalEditPrompt(prompt: string, annotations: LocalEditAnnotation[] = []) {
  const normalized = normalizeLocalEditAnnotations(annotations);
  const rawBase = stripCompiledLocalEditPrompt(prompt);
  const base = normalized.some((annotation) => annotation.move?.from.length)
    ? withoutConflictingMoveInstruction(rawBase)
    : rawBase;
  const descriptions = normalized
    .map((annotation, index) => {
      const description = annotation.description.trim();
      if (annotation.move?.from.length) {
        const sourceLocations = annotation.move.from.length > 1 ? "所有记录的原位置" : "原位置";
        return {
          index: index + 1,
          text: `移动参考图已经标出最终摆放：将圈选物体完整迁移到目标位置，严格保持其外观、比例、姿态和光影；移除${sourceLocations}的该物体并自然补全背景。不要移动选区外的人物、主体或画面构图，不要留下重复物体、矩形边界、硬边、透明洞或拼接痕迹。${description ? `补充说明：${description}` : ""}`,
        };
      }
      return { index: index + 1, text: description };
    })
    .filter((item) => item.text);
  const fusionRequirement = "只修改编辑范围，并与周围画面自然融合，不要留下矩形边界、硬边或拼接痕迹。";
  if (!descriptions.length) {
    if (!fusionRequirement) return base;
    return base
      ? `${base}\n\n局部处理要求：${fusionRequirement}`
      : `请根据局部编辑范围进行重绘：${fusionRequirement}`;
  }
  const context = descriptions.map((item) => `区域 ${item.index}：${item.text}`).join("\n");
  const compiled = base
    ? `${base}\n\n局部区域说明：\n${context}`
    : `请根据以下局部区域说明进行局部重绘：\n${context}`;
  return fusionRequirement ? `${compiled}\n\n局部处理要求：${fusionRequirement}` : compiled;
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

function repairLocalEditMoveSource(
  source: Uint8ClampedArray,
  selectionMask: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const pixelCount = width * height;
  const selected = new Uint8Array(pixelCount);
  let selectedCount = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (selectionMask[pixel * 4 + 3] >= 253) continue;
    selected[pixel] = 1;
    selectedCount += 1;
  }
  if (!selectedCount) return new Uint8ClampedArray(source);

  // Start from the background pixels immediately surrounding the selection,
  // then propagate their colors inward. This gives the provider an opaque,
  // readable source repair guide instead of a black/transparent cutout.
  const nearestBackground = new Int32Array(pixelCount);
  nearestBackground.fill(-1);
  const queue = new Int32Array(pixelCount);
  let tail = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (!selected[pixel]) continue;
      const candidates = [
        x > 0 ? pixel - 1 : -1,
        x + 1 < width ? pixel + 1 : -1,
        y > 0 ? pixel - width : -1,
        y + 1 < height ? pixel + width : -1,
      ];
      for (const candidate of candidates) {
        if (candidate < 0 || selected[candidate] || nearestBackground[candidate] >= 0) continue;
        nearestBackground[candidate] = candidate;
        queue[tail++] = candidate;
      }
    }
  }

  for (let head = 0; head < tail; head += 1) {
    const pixel = queue[head];
    const owner = nearestBackground[pixel];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const candidates = [
      x > 0 ? pixel - 1 : -1,
      x + 1 < width ? pixel + 1 : -1,
      y > 0 ? pixel - width : -1,
      y + 1 < height ? pixel + width : -1,
    ];
    for (const candidate of candidates) {
      if (candidate < 0 || !selected[candidate] || nearestBackground[candidate] >= 0) continue;
      nearestBackground[candidate] = owner;
      queue[tail++] = candidate;
    }
  }

  const repaired = new Uint8ClampedArray(source);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const owner = nearestBackground[pixel];
    if (!selected[pixel] || owner < 0) continue;
    const index = pixel * 4;
    const ownerIndex = owner * 4;
    repaired[index] = source[ownerIndex];
    repaired[index + 1] = source[ownerIndex + 1];
    repaired[index + 2] = source[ownerIndex + 2];
  }

  // Two small local smoothing passes remove the staircase edge left by a
  // nearest-background fill while retaining nearby texture for the model.
  let smoothed = repaired;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = new Uint8ClampedArray(smoothed);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        if (!selected[pixel]) continue;
        const index = pixel * 4;
        const candidates = [
          pixel,
          x > 0 ? pixel - 1 : -1,
          x + 1 < width ? pixel + 1 : -1,
          y > 0 ? pixel - width : -1,
          y + 1 < height ? pixel + width : -1,
        ];
        for (let channel = 0; channel < 3; channel += 1) {
          let total = 0;
          let samples = 0;
          for (const candidate of candidates) {
            if (candidate < 0) continue;
            total += smoothed[candidate * 4 + channel];
            samples += 1;
          }
          next[index + channel] = Math.round(total / Math.max(1, samples));
        }
      }
    }
    smoothed = next;
  }

  const output = new Uint8ClampedArray(source);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 4;
    const weight = 1 - selectionMask[index + 3] / 255;
    if (weight <= 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      output[index + channel] = Math.round(source[index + channel] * (1 - weight) + smoothed[index + channel] * weight);
    }
  }
  return output;
}

/**
 * Move a selected region into a new location while repairing its source area.
 * The output stays opaque, so it can be shown directly in the workbench and
 * used as a provider guide without turning the source into a visible hole.
 */
export function moveLocalEditPixels(
  source: Uint8ClampedArray,
  selectionMask: Uint8ClampedArray,
  width: number,
  height: number,
  dx: number,
  dy: number,
) {
  if (
    width < 1 ||
    height < 1 ||
    source.length !== width * height * 4 ||
    selectionMask.length !== source.length
  ) {
    throw new Error("Local-edit move buffers must match the canvas dimensions");
  }

  const original = new Uint8ClampedArray(source);
  const repaired = repairLocalEditMoveSource(original, selectionMask, width, height);
  return preserveLocalEditAlphaFloor(
    pasteLocalEditPixels(repaired, original, selectionMask, width, height, dx, dy),
    original,
  );
}

/** A move can repair or add pixels, but it must never punch a new alpha hole. */
function preserveLocalEditAlphaFloor(output: Uint8ClampedArray, source: Uint8ClampedArray) {
  for (let index = 3; index < output.length; index += 4) {
    output[index] = Math.max(output[index], source[index]);
  }
  return output;
}

/** Blend a selected source region over a target image without creating holes. */
function pasteLocalEditPixels(
  background: Uint8ClampedArray,
  selectedSource: Uint8ClampedArray,
  selectionMask: Uint8ClampedArray,
  width: number,
  height: number,
  dx: number,
  dy: number,
) {
  const output = new Uint8ClampedArray(background);
  const offsetX = Math.round(dx);
  const offsetY = Math.round(dy);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = (y * width + x) * 4;
      const weight = 1 - selectionMask[sourceIndex + 3] / 255;
      if (weight <= 0) continue;
      const targetX = x + offsetX;
      const targetY = y + offsetY;
      if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) continue;
      const targetIndex = (targetY * width + targetX) * 4;
      const sourceAlpha = (selectedSource[sourceIndex + 3] / 255) * weight;
      if (sourceAlpha <= 0) continue;
      const targetAlpha = output[targetIndex + 3] / 255;
      const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
      if (outputAlpha <= 0) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        output[targetIndex + channel] = Math.round(
          (selectedSource[sourceIndex + channel] * sourceAlpha
            + output[targetIndex + channel] * targetAlpha * (1 - sourceAlpha)) / outputAlpha,
        );
      }
      output[targetIndex + 3] = Math.round(outputAlpha * 255);
    }
  }
  return output;
}

/** Rebuild a move preview from the original pixels with an opaque source repair. */
export function composeLocalEditMovePreview(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  annotations: LocalEditAnnotation[] = [],
  smartMasks?: ReadonlyMap<string, Uint8ClampedArray>,
) {
  return composeLocalEditMoveReference(source, width, height, annotations, smartMasks);
}

function moveGuideFeatherRadius(width: number, height: number) {
  return Math.max(2, Math.min(12, Math.round(Math.max(width, height) * 0.004)));
}

/**
 * Build the move reference sent to an image provider. It removes every source
 * selection from the guide, reconstructs an opaque background placeholder,
 * then pastes the original object at the requested destination. The submitted
 * mask still asks the provider to repair both areas at full quality.
 */
export function composeLocalEditMoveReference(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  annotations: LocalEditAnnotation[] = [],
  smartMasks?: ReadonlyMap<string, Uint8ClampedArray>,
) {
  if (width < 1 || height < 1 || source.length !== width * height * 4) {
    throw new Error("Local-edit move reference must match the canvas dimensions");
  }

  const moves: Array<{ selection: Uint8ClampedArray; dx: number; dy: number }> = [];
  const sourceRepairMask = createProtectedMask(width, height);
  for (const annotation of normalizeLocalEditAnnotations(annotations)) {
    const sourceGeometries = annotation.move?.from || [];
    const sourceGeometry = sourceGeometries[0];
    if (!sourceGeometry) continue;
    const sourceBounds = localEditGeometryBounds(sourceGeometry);
    const targetBounds = localEditGeometryBounds(annotation.geometry);
    let pasteSelection: Uint8ClampedArray | undefined;
    sourceGeometries.forEach((geometry, index) => {
      const selection = createProtectedMask(width, height);
      applyLocalEditGeometryMask(
        selection,
        width,
        height,
        geometry,
        "edit",
        smartMasks?.get(`${annotation.id}:from:${index}`),
      );
      const softenedSelection = featherLocalEditMask(
        selection,
        width,
        height,
        moveGuideFeatherRadius(width, height),
      );
      for (let pixel = 3; pixel < sourceRepairMask.length; pixel += 4) {
        sourceRepairMask[pixel] = Math.min(sourceRepairMask[pixel], softenedSelection[pixel]);
      }
      if (!pasteSelection) pasteSelection = softenedSelection;
    });
    if (!pasteSelection) continue;
    moves.push({
      // A repeated drag records every source position for repair, but the
      // original object is pasted only once at its final destination.
      selection: pasteSelection,
      dx: ((targetBounds.x + targetBounds.width / 2) - (sourceBounds.x + sourceBounds.width / 2)) * width,
      dy: ((targetBounds.y + targetBounds.height / 2) - (sourceBounds.y + sourceBounds.height / 2)) * height,
    });
  }
  let output = repairLocalEditMoveSource(source, sourceRepairMask, width, height);
  for (const move of moves) {
    output = pasteLocalEditPixels(output, source, move.selection, width, height, move.dx, move.dy);
  }
  return preserveLocalEditAlphaFloor(output, source);
}

/** Clamp the slider value while always reserving a small fusion zone. */
export function localEditFusionFeather(radius: number) {
  const numeric = Number(radius);
  const requested = Number.isFinite(numeric) ? numeric : 0;
  return Math.max(LOCAL_EDIT_MIN_FUSION_FEATHER, Math.min(48, Math.round(requested)));
}

/** Expand editable pixels before feathering so providers can blend both sides of an edge. */
export function expandLocalEditMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
) {
  if (width <= 0 || height <= 0 || pixels.length !== width * height * 4 || radius <= 0) {
    return new Uint8ClampedArray(pixels);
  }
  const safeRadius = Math.max(1, Math.round(radius));
  const pixelCount = width * height;
  const horizontal = new Uint8Array(pixelCount);
  const prefix = new Int32Array(Math.max(width, height) + 1);

  for (let y = 0; y < height; y += 1) {
    prefix[0] = 0;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      prefix[x + 1] = prefix[x] + (pixels[(row + x) * 4 + 3] < 128 ? 1 : 0);
    }
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - safeRadius);
      const right = Math.min(width - 1, x + safeRadius);
      horizontal[row + x] = prefix[right + 1] - prefix[left] > 0 ? 1 : 0;
    }
  }

  const output = new Uint8ClampedArray(pixels);
  for (let x = 0; x < width; x += 1) {
    prefix[0] = 0;
    for (let y = 0; y < height; y += 1) {
      prefix[y + 1] = prefix[y] + horizontal[y * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      const top = Math.max(0, y - safeRadius);
      const bottom = Math.min(height - 1, y + safeRadius);
      if (prefix[bottom + 1] - prefix[top] <= 0) continue;
      const index = (y * width + x) * 4;
      output[index] = 255;
      output[index + 1] = 255;
      output[index + 2] = 255;
      output[index + 3] = 0;
    }
  }
  return output;
}

/** Prepare a provider mask with a minimum feather and a small editable context ring. */
export function createSeamlessLocalEditMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  feather: number,
) {
  const fusionFeather = localEditFusionFeather(feather);
  const expansion = Math.max(2, Math.min(8, Math.round(fusionFeather / 2)));
  return featherLocalEditMask(
    expandLocalEditMask(pixels, width, height, expansion),
    width,
    height,
    fusionFeather,
  );
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
