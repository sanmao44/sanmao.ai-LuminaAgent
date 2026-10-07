import { IMAGE_QUALITY_OPTIONS } from "@/lib/creation/settings";

export const qualityOptions = IMAGE_QUALITY_OPTIONS.map((item) => ({ value: item.value, label: item.label, meta: item.description }));
export const upscaleScales = [1, 2, 3, 4] as const;
export const cloudUpscaleFormatOptions = [
  { value: "png", label: "PNG · 无损" },
  { value: "jpg", label: "JPG · 体积更小" },
  { value: "bmp", label: "BMP · 兼容性好" },
] as const;

export function isCloudUpscaleModel(model: { provider?: string } | null | undefined) {
  return model?.provider === "tencent-ci" || model?.provider === "aliyun-viapi";
}
