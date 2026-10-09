export type DepthQuality = "low" | "medium" | "high";

export type DepthQualityProfile = {
  quality: DepthQuality;
  label: string;
  description: string;
  inferenceSide: number;
  exportSide: number;
  frameQuality: number;
};

export const DEFAULT_DEPTH_QUALITY: DepthQuality = "medium";

export const DEPTH_QUALITY_PROFILES: Readonly<Record<DepthQuality, DepthQualityProfile>> = {
  low: {
    quality: "low",
    label: "低档",
    description: "较低占用，适合集成显卡或内存较小的电脑",
    inferenceSide: 512,
    exportSide: 1280,
    frameQuality: 0.76,
  },
  medium: {
    quality: "medium",
    label: "中档",
    description: "平衡速度和深度细节，推荐大多数电脑",
    inferenceSide: 768,
    exportSide: 1600,
    frameQuality: 0.84,
  },
  high: {
    quality: "high",
    label: "高档",
    description: "更多深度细节，适合独立显卡或高性能电脑",
    inferenceSide: 1024,
    exportSide: 1920,
    frameQuality: 0.9,
  },
};

export const DEPTH_QUALITY_OPTIONS = (Object.values(DEPTH_QUALITY_PROFILES) as DepthQualityProfile[]).map((profile) => ({
  value: profile.quality,
  label: profile.label,
  description: profile.description,
}));

export function normalizeDepthQuality(value: unknown): DepthQuality {
  return value === "low" || value === "high" || value === "medium"
    ? value
    : DEFAULT_DEPTH_QUALITY;
}

export function depthQualityProfile(value: unknown): DepthQualityProfile {
  return DEPTH_QUALITY_PROFILES[normalizeDepthQuality(value)];
}
