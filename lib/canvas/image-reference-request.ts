import {
  appendTextReferenceContext,
  replaceNaturalReferenceLabels,
  resolveCreativeReferenceRoles,
  type CreativeReferenceRoleResolution,
} from "../creative-references";
import type { ImageCreationSettings } from "../creation/settings";
import { MAX_IMAGE_REFERENCES, type ImageRequestMode } from "@/packages/contracts/creative";
import type { ModelCapability } from "@/lib/types";
import type { CanvasReferenceDraft } from "./reuse";

export function canvasImageRequestCapabilities(
  imageOperation: ImageRequestMode,
  imageReferenceCount: number,
): ModelCapability[] {
  if (imageOperation === "edit") return ["edit"];
  return ["generate", ...(imageReferenceCount > 0 ? ["reference" as const] : [])];
}

export type CanvasImageReferenceRequest =
  | { ok: false; message: string }
  | {
      ok: true;
      imageOperation: ImageRequestMode;
      prompt: string;
      params: ImageCreationSettings;
      references: CanvasReferenceDraft[];
      imageReferences: { url: string; name: string }[];
      resolution: CreativeReferenceRoleResolution<CanvasReferenceDraft>;
    };

function parseAspectRatio(value: string) {
  const [width, height] = value.split(":").map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  return width / height;
}

function customAspect(value: string) {
  const [rawWidth, rawHeight] = value.split(":").map(Number);
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) return undefined;
  const ratio = rawWidth / rawHeight;
  let best: { width: number; height: number; error: number } | undefined;
  for (let height = 1; height <= 999; height += 1) {
    const width = Math.round(ratio * height);
    if (width < 1 || width > 999) continue;
    const error = Math.abs(width / height - ratio) / ratio;
    if (!best || error < best.error) best = { width, height, error };
  }
  if (best) return { width: best.width, height: best.height };
  return ratio >= 1 ? { width: 999, height: 1 } : { width: 1, height: 999 };
}

function configuredAspectRatio(params: ImageCreationSettings) {
  if (params.sizeMode === "custom") return params.width / params.height;
  if (params.aspect === "自动") return undefined;
  if (params.aspect === "自定义") return params.customAspectWidth / params.customAspectHeight;
  return parseAspectRatio(params.aspect);
}

function applyLayoutAspect(params: ImageCreationSettings, ratio: string) {
  const expected = parseAspectRatio(ratio);
  if (!expected) return { error: "画幅参考尺寸无效，请重新选择参考图。" } as const;
  const configured = configuredAspectRatio(params);
  if (configured && Math.abs(configured - expected) / Math.max(configured, expected) > 0.005) {
    return { error: "提示词中的画幅参考与当前输出比例或自定义尺寸冲突，请先统一画幅设置。" } as const;
  }
  if (configured) return { params } as const;
  const bounded = customAspect(ratio);
  if (!bounded) return { error: "画幅参考尺寸无效，请重新选择参考图。" } as const;
  if (Math.abs(bounded.width / bounded.height - expected) / expected > 0.005) {
    return { error: "画幅参考比例超出可设置范围，请手动设置输出比例。" } as const;
  }
  return {
    params: {
      ...params,
      aspect: "自定义",
      customAspectWidth: bounded.width,
      customAspectHeight: bounded.height,
    },
  } as const;
}

export function prepareCanvasImageReferenceRequest(input: {
  prompt: string;
  references: readonly CanvasReferenceDraft[];
  defaultReferences?: readonly CanvasReferenceDraft[];
  params: ImageCreationSettings;
  imageOperation: ImageRequestMode;
}): CanvasImageReferenceRequest {
  const naturalPrompt = replaceNaturalReferenceLabels(input.prompt, input.references);
  const resolution = resolveCreativeReferenceRoles(naturalPrompt.value, input.references);
  if (resolution.invalidNumbers.length) {
    return { ok: false, message: `引用编号无效：${resolution.invalidNumbers.map((number) => `@${number}`).join("、")}` };
  }
  if (resolution.layoutAspectRatioConflict) {
    return { ok: false, message: "画幅参考比例不一致，请只保留一个仅用于画幅的参考图。" };
  }
  if (resolution.layoutDimensionsMissingReferences.length) {
    return { ok: false, message: "无法读取仅用于画幅的参考图尺寸；为避免把它当成视觉参考，已阻止提交。请重新上传图片或手动设置输出比例。" };
  }
  const references = resolution.hasMentions
    ? resolution.references
    : [...(input.defaultReferences || resolution.references)];
  if (references.some((reference) => reference.pending || reference.error)) {
    return { ok: false, message: "请等待参考素材准备完成，或移除失败的参考素材。" };
  }
  if (references.some((reference) => reference.kind === "video" || reference.kind === "audio")) {
    return { ok: false, message: "图片生成只能使用图片或文本引用，请移除视频和音频素材。" };
  }
  if (references.some((reference) => reference.kind === "image" && !reference.url?.trim())) {
    return { ok: false, message: "有图片参考无法读取，请重新导入该图片后再提交。" };
  }
  const resolvedParams = resolution.layoutAspectRatio
    ? applyLayoutAspect(input.params, resolution.layoutAspectRatio)
    : { params: input.params } as const;
  if ("error" in resolvedParams && resolvedParams.error) return { ok: false, message: resolvedParams.error };
  const imageReferences = references
    .filter((reference) => reference.kind === "image" && Boolean(reference.url?.trim()))
    .map((reference) => ({ url: String(reference.url), name: reference.name || "参考图片" }));
  if (imageReferences.length > MAX_IMAGE_REFERENCES) {
    return { ok: false, message: `图片参考最多 ${MAX_IMAGE_REFERENCES} 张，请移除多余参考后再提交。` };
  }
  const imageOperation = input.imageOperation === "auto" && imageReferences.length === 0
    ? "generate"
    : input.imageOperation;
  return {
    ok: true,
    imageOperation,
    prompt: appendTextReferenceContext(resolution.prompt, references),
    params: resolvedParams.params,
    references: [...references],
    imageReferences,
    resolution,
  };
}

export function canvasImageRequestOperation(
  params: Pick<ImageCreationSettings, "mask">,
  options: { useCurrentImageAsReference?: boolean } = {},
): ImageRequestMode {
  return params.mask && options.useCurrentImageAsReference !== false ? "edit" : "auto";
}
