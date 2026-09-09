import type { VideoCreationSettings } from "./creation/settings";

export type CinematicDuration = "auto" | number;
export type CinematicDirectingMode = "auto" | "one_take" | "montage";
export type CinematicAspectRatio = "project" | "auto" | "21:9" | "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "3:2" | "2:3";
export type CinematicCreativity = "strict" | "balanced" | "bold";

export type CinematicOpeningSettings = {
  duration: CinematicDuration;
  wowLevel: 1 | 2 | 3 | 4 | 5;
  directingMode: CinematicDirectingMode;
  aspectRatio: CinematicAspectRatio;
  creativity: CinematicCreativity;
  userDirection: string;
};

export const DEFAULT_CINEMATIC_OPENING_SETTINGS: CinematicOpeningSettings = {
  duration: "auto",
  wowLevel: 4,
  directingMode: "auto",
  aspectRatio: "project",
  creativity: "balanced",
  userDirection: "",
};

export type CinematicDirectorShot = {
  start?: number;
  end?: number;
  shotType?: string;
  camera?: string;
  subjectAction?: string;
  lighting?: string;
  transition?: string;
};

export type CinematicDirectorPlan = {
  analysis?: {
    imageType?: string;
    mainSubject?: string;
    visualStyle?: string;
    preserve?: string[];
    [key: string]: unknown;
  };
  concept?: { title?: string; visualIdea?: string; [key: string]: unknown };
  directingMode?: "one_take" | "montage";
  duration?: number;
  shots?: CinematicDirectorShot[];
  surpriseMoment?: string;
  heroEnding?: string;
  videoPrompt?: string;
  negativePrompt?: string;
  [key: string]: unknown;
};

export function resolvedCinematicDuration(duration: CinematicDuration) {
  return duration === "auto" ? 8 : duration;
}

function safeText(value: unknown, fallback = "未提供") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

/**
 * System prompt for the image-aware director. The image itself is sent as a
 * multimodal reference by the Agent client; this module only owns directing
 * rules and the output contract, keeping prompt engineering out of React.
 */
export function buildCinematicDirectorInstructions() {
  return [
    "# CINEMATIC SHOCK OPENING DIRECTOR",
    "你是一名世界级电影预告片导演、广告导演、摄影指导、分镜师、VFX Supervisor 与 Motion Designer。",
    "你的任务不是简单让图片动起来，而是根据参考图本身的构图、主体、透视、材质、光线、纵深与视觉风格，设计一段高级、电影化、具有强开场 Hook 的视频。参考图是视觉事实来源。",
    "",
    "## 导演规则",
    "1. 先识别参考图类型、主体、视觉焦点、前中后景、构图、透视、主导线条、材质、光线、色彩、可动空间与最有辨识度的资产。明确必须保护的人脸、人物身份、服装、产品结构、Logo、文字、车辆、建筑和核心风格。",
    "2. 先提出一个唯一的 VISUAL IDEA，让所有镜头服务于一个视觉概念。禁止所有图片都使用同一种环绕、推镜和粒子套路。",
    "3. 主体单一、空间连续且有纵深时优先 ONE TAKE；信息丰富、细节多或海报型构图需要分别强调材质时使用 CINEMATIC MONTAGE。用户指定模式时服从用户。",
    "4. 0–1 秒必须制造好奇：优先极端局部、异常透视、低机位、反射、遮挡、掠过、倾斜或视觉误导，禁止平淡淡入和普通正面全景。",
    "5. 每个镜头最多突出 1–2 个核心摄影动作。运动要有克制、升级、爆发、收束的节奏变化；刁钻角度必须来自参考图的空间和材质逻辑，不能随机堆炫技。",
    "6. 至少设计一个来源于摄影语言的 SURPRISE MOMENT，并在最后 0.8–1.5 秒完成清晰的 HERO REVEAL / HERO LANDING。最后一帧要适合做海报或缩略图。",
    "7. 光效和特效必须服从原图材质与环境。除非画面本身支持，不要无理由加入大量火花、粒子、闪电、烟雾或爆炸。",
    "8. WOW_LEVEL 代表运镜与视觉设计的激进程度，不等于随机增加特效：奢侈品要精准克制，赛车/科幻/游戏可以更激进，插画/艺术/美妆要优雅空间化。",
    "9. 创意要保持主体一致性；禁止脸部漂移、肢体变形、产品融化、Logo/文字乱码、车辆或建筑结构改变、物体无故复制和场景无逻辑重构。画外空间只能按原图光线、色彩、材质和时代合理扩展。",
    "10. 如果已有导演创意列表，必须换一个不同的核心概念，而不是只换随机种子。",
    "",
    "## 输出要求",
    "只返回一个合法 JSON 对象，不要 Markdown、代码围栏、解释或前后缀。字段必须符合：",
    JSON.stringify({
      analysis: { imageType: "", mainSubject: "", visualStyle: "", preserve: ["必需保护的主体资产"] },
      concept: { title: "", visualIdea: "" },
      directingMode: "one_take",
      duration: 8,
      shots: [{ start: 0, end: 1, shotType: "", camera: "", subjectAction: "", lighting: "", transition: "" }],
      surpriseMoment: "",
      heroEnding: "",
      videoPrompt: "可直接发送给视频模型的完整镜头提示词",
      negativePrompt: "主体保护与禁止变形要求",
    }, null, 2),
    "videoPrompt 必须是完整、具体、可执行的视频生成提示词，包含时序、镜头、主体动作、光影、节奏、惊喜和结尾；不要把本指令原文复制进去。",
  ].join("\n");
}

export function buildCinematicDirectorRequest(input: {
  sourceName?: string;
  sourcePrompt?: string;
  settings: CinematicOpeningSettings;
  previousConcepts?: string[];
}) {
  const { settings } = input;
  return [
    "请根据随本消息提供的参考图，执行 CINEMATIC SHOCK OPENING DIRECTOR。",
    `参考图名称：${safeText(input.sourceName, "当前图片")}`,
    input.sourcePrompt?.trim() ? `图片已有描述（仅作上下文，不得覆盖参考图事实）：${input.sourcePrompt.trim()}` : "",
    `导演参数：${JSON.stringify({
      duration: settings.duration,
      wowLevel: settings.wowLevel,
      directingMode: settings.directingMode,
      aspectRatio: settings.aspectRatio,
      creativity: settings.creativity,
      userDirection: settings.userDirection.trim(),
    })}`,
    input.previousConcepts?.length
      ? `之前已使用过的导演创意（必须避开）：${input.previousConcepts.join("；")}`
      : "这是第一次生成，请选择最适合参考图的核心创意。",
    "请只返回约定的 JSON 结构，不要输出分析过程。",
  ].filter(Boolean).join("\n\n");
}

function firstJsonObject(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = (fenced || value).trim();
  try {
    return JSON.parse(source) as unknown;
  } catch {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(source.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

export function parseCinematicDirectorPlan(value: string): CinematicDirectorPlan {
  const parsed = firstJsonObject(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("导演方案格式无法解析，请重试。\n");
  const plan = parsed as CinematicDirectorPlan;
  if (!safeText(plan.videoPrompt, "").trim())
    throw new Error("导演没有返回可执行的视频提示词，请重试。\n");
  return {
    ...plan,
    videoPrompt: String(plan.videoPrompt).trim(),
    negativePrompt: String(plan.negativePrompt || "保持主体、人物、产品、Logo 和文字一致，不要变形").trim(),
    shots: Array.isArray(plan.shots) ? plan.shots.slice(0, 12) : [],
  };
}

/** Convert a structured director plan into the prompt accepted by the video API. */
export function compileCinematicVideoPrompt(
  plan: CinematicDirectorPlan,
  settings: CinematicOpeningSettings,
  videoParams: VideoCreationSettings,
) {
  const shots = (plan.shots || [])
    .map((shot, index) => {
      const timing = Number.isFinite(Number(shot.start)) && Number.isFinite(Number(shot.end))
        ? `${shot.start}–${shot.end}s`
        : `镜头 ${index + 1}`;
      return `${timing}：${[shot.shotType, shot.camera, shot.subjectAction, shot.lighting, shot.transition].filter(Boolean).join("；")}`;
    })
    .filter(Boolean);
  return [
    plan.videoPrompt,
    shots.length ? `导演分镜补充：${shots.join("\n")}` : "",
    `视觉创意：${safeText(plan.concept?.visualIdea)}`,
    `结构：${plan.directingMode === "montage" ? "电影蒙太奇" : "一镜到底"}；时长约 ${resolvedCinematicDuration(settings.duration)} 秒；炫酷程度 ${settings.wowLevel}/5。`,
    `惊喜时刻：${safeText(plan.surpriseMoment)}`,
    `Hero 结尾：${safeText(plan.heroEnding)}`,
    `主体保护：${(plan.analysis?.preserve || []).map(String).join("、") || "保持参考图主体、人物、产品、Logo、文字、比例和风格一致"}。`,
    `禁止：${safeText(plan.negativePrompt)}`,
    settings.userDirection.trim() ? `用户补充要求：${settings.userDirection.trim()}` : "",
    `视频参数：${videoParams.aspect}，${videoParams.resolution}。`,
  ].filter(Boolean).join("\n\n");
}
