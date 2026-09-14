export type ImagePresetMode = "reference_generate" | "image_edit" | "temporal_inference";

export type ImagePreset = {
  id: string;
  label: string;
  description: string;
  icon: string;
  mode: ImagePresetMode;
  prompt: string;
  requiresImage: true;
  aspectRatio?: string;
  builtin?: boolean;
};

export type CustomImagePreset = Pick<ImagePreset, "id" | "label" | "description" | "icon" | "prompt"> & {
  builtin?: false;
};

export const IMAGE_PRESET_ICONS = ["◎", "♙", "↔", "⌂", "▣", "▦", "◌", "☼", "◉", "+3", "-5", "✦", "✎", "✧", "◆"] as const;

export const IMAGE_PRESETS_STORAGE_KEY = "sanmao-image-presets-v1";

const preserve = "必须保持参考图中的主体身份、核心结构、材质、颜色、构图和视觉风格一致；除非任务明确要求，不得添加水印、Logo、乱码或无关元素。";

export const BUILTIN_IMAGE_PRESETS: readonly ImagePreset[] = [
  {
    id: "character_face_three_views",
    label: "角色脸部三视图",
    description: "正面、四分之三侧面与纯侧面",
    icon: "◎",
    mode: "reference_generate",
    requiresImage: true,
    prompt: `任务：根据输入参考图中的同一角色，生成专业角色脸部三视图设定图。

${preserve}
在同一张设定图中清晰展示正面、3/4 侧面和纯侧面三个头部视角。三个视角必须属于完全同一个角色，不得换脸、改变年龄、发型、妆容或五官比例。统一镜头高度、头部尺寸、光照方向、色彩和画风，重点强化眼睛、眉毛、鼻子、嘴唇、耳朵、发际线、发丝、皮肤纹理及面部轮廓。采用专业 character design sheet / model sheet 排版，背景简洁中性。禁止新增人物、夸张表情和无意义装饰。`,
    builtin: true,
  },
  {
    id: "character_design_sheet",
    label: "角色设定图",
    description: "主视觉与服装、配饰拆解",
    icon: "♙",
    mode: "reference_generate",
    requiresImage: true,
    prompt: `任务：根据输入参考角色制作一张完整、专业的 Character Design Sheet。

${preserve}
画面以角色全身主视觉为核心，并围绕主视觉展示头部特写、服装结构、鞋子、重要配饰、随身物品、材质细节、发型细节以及颜色与材质关系。所有拆解内容必须属于同一个角色，不得改变人物五官、身材比例、服装结构、服装颜色、发型、配饰或年龄。采用游戏、动画或影视项目的专业设定稿排版，层级清楚、主视觉突出、背景干净。`,
    builtin: true,
  },
  {
    id: "character_three_views",
    label: "角色三视图",
    description: "正面、侧面、背面与脸部特写",
    icon: "↔",
    mode: "reference_generate",
    requiresImage: true,
    prompt: `任务：根据参考图生成同一角色的标准角色三视图 Model Sheet。

${preserve}
必须包含正面全身、纯侧面全身、背面全身和脸部细节特写。三个全身视图中的身高、头身比例、肩宽、腰线、四肢长度、服装结构、发型长度、鞋子和配饰位置必须严格对应。角色采用自然站立或标准设计稿站姿，尽量减少透视畸变，使用接近正交视图的表现方式。正面、侧面和背面必须是真实不同方向的观察结果，而不是简单镜像。统一比例、光照、画风和背景，禁止擅自重新设计。`,
    builtin: true,
  },
  {
    id: "environment_design_sheet",
    label: "场景设定图",
    description: "场景主视觉与空间拆解",
    icon: "⌂",
    mode: "reference_generate",
    requiresImage: true,
    prompt: `任务：根据参考图中的环境制作专业 Environment Design Sheet。

${preserve}
保持建筑语言、空间结构、时代背景、地理环境、材质、主要颜色、光照气氛和核心场景元素一致。画面包含一个主要场景视觉，并展示整体空间、建筑结构、关键区域、门窗、地面、墙面、家具或大型道具、环境道具、材质细节、灯光来源、色彩关系和氛围细节。所有局部必须来自同一个场景设计体系，不得随机改造成另一个时代、地点或建筑风格。采用影视或游戏 Environment Concept Art / Production Design Sheet 风格，背景简洁、信息组织清晰。`,
    builtin: true,
  },
  {
    id: "product_design_sheet",
    label: "产品设定图",
    description: "产品主视觉与结构细节",
    icon: "▣",
    mode: "reference_generate",
    requiresImage: true,
    prompt: `任务：根据参考图片中的产品生成专业 Product Design Sheet。

${preserve}
严格保持产品的整体轮廓、比例、结构、材质、颜色、按键、接口、装饰、Logo 所在区域和机械结构关系。以产品主视觉为核心，展示正面、侧面、背面、顶部、底部、3/4 透视、接口、按键、结构连接处、材质细节、表面工艺和重要功能区域。所有视角必须属于完全相同的一件产品。禁止随机增加结构、减少组件、改变按键位置、改变产品比例或生成多个不同型号。使用专业工业设计 / product concept sheet 排版，背景简洁中性。`,
    builtin: true,
  },
  {
    id: "multi_camera_9_grid",
    label: "多机位九宫格",
    description: "同一场景的 3×3 多视角",
    icon: "▦",
    mode: "reference_generate",
    requiresImage: true,
    prompt: `任务：以参考图片中的同一人物、主体和场景为基础，生成一个 3×3 九宫格多机位镜头设计图。

${preserve}
九个画面描述同一个时间、同一个场景、同一人物或主体。合理组合大全景、全景、中景、近景、特写、高机位、低机位、侧面、3/4、背面或越肩、环境关系镜头，选择九个价值高且差异明显的机位。变化主要来自摄影机位置、焦段感、景别、观察角度和构图；人物身份、服装、场景、时间、天气、主光源、美术风格和颜色体系必须一致。生成整齐等尺寸的 3×3 九宫格，禁止重复机位和主体漂移。`,
    builtin: true,
  },
  {
    id: "portrait_realism_enhance",
    label: "人像质感调节",
    description: "降低 AI 感，恢复自然皮肤与光影",
    icon: "◌",
    mode: "image_edit",
    requiresImage: true,
    prompt: `任务：对当前人像进行精细质感优化，降低明显的 AI 生成感，使人物更自然、真实、有摄影质感。

这是质感编辑，不是重新生成人物。${preserve} 必须保留人物身份、脸型、五官、发型、年龄、表情、姿态、身体比例、服装、配饰、原始构图和背景主体。恢复自然细微皮肤纹理与合理毛孔，避免蜡像皮肤、过度磨皮、塑料质感、CGI 感、过度锐化和边缘伪影；改善眼睛反光、睫毛、眉毛、发丝、嘴唇质地以及鼻翼、眼窝和脸颊的自然明暗；优化主光、辅光、环境光、接触阴影和轮廓光，使结果接近高质量真人摄影或高端电影剧照。禁止换脸、美容整形、改变五官、添加人物、改变衣服或背景。`,
    builtin: true,
  },
  {
    id: "cinematic_lighting_correction",
    label: "电影级光影校正",
    description: "调整曝光、层次与电影影调",
    icon: "☼",
    mode: "image_edit",
    requiresImage: true,
    prompt: `任务：在不改变原始画面内容和构图的前提下，对图片进行电影级光影校正和影调优化。

${preserve} 不得改变人物、物体、场景、摄影机位置、人物动作、服装、建筑和背景内容。只优化光线、曝光、层次和色彩关系：建立自然主光，优化辅光比例，增加合理环境光与空间纵深，改善主体与背景分离度、轮廓光和接触阴影，保留高光细节，避免死黑和高光过曝，统一色温、肤色与画面色彩层次。根据原图已有光源推断真实光线方向，不允许添加冲突光源，最终接近专业电影摄影和 DI 调色效果。`,
    builtin: true,
  },
  {
    id: "panorama_720",
    label: "720 全景",
    description: "重建可用于查看器的 2:1 沉浸全景",
    icon: "◉",
    mode: "reference_generate",
    requiresImage: true,
    aspectRatio: "2:1",
    prompt: `任务：根据参考图片扩展并重建完整的沉浸式全景场景。

以参考图可见区域为场景设计基准，合理推断镜头周围未显示的空间。生成完整的 360° × 180° equirectangular panorama，输出比例必须为 2:1。水平 360 度完整覆盖，顶部天空或天花板、底部地面合理延伸，左右边缘无缝连接，保持统一透视、建筑比例、光线方向、天气、时间和场景美术风格。不可简单镜像或复制两侧内容，应合理补全摄影机背后的环境。避免重复人物、建筑、家具、左右接缝、断裂地平线、错误透视和天空拼接痕迹，最终可用于标准 360 全景查看器或环境预览。`,
    builtin: true,
  },
  {
    id: "frame_plus_3_seconds",
    label: "画面推演 · 3 秒后",
    description: "推演连续镜头的后续状态",
    icon: "+3",
    mode: "temporal_inference",
    requiresImage: true,
    prompt: `任务：将当前图片视为连续镜头中的一个瞬间，推演大约 3 秒之后最合理的画面状态。

${preserve} 输出仍是一张代表 T+3 秒的静态图片。根据人物动作、身体重心、视线、物体运动趋势、环境信息和剧情线索，遵循人体运动、惯性、重力和空间连续性推进动作、手势、步伐、视线、衣物与头发运动、车辆或道具位置、烟雾水火等动态元素。没有明确摄影机运动时保持相同机位和焦段，有线索时只做适度连续位移。禁止换人、换衣服、换场景、换时间、增加无依据的重要人物、改变建筑结构或角色身份。`,
    builtin: true,
  },
  {
    id: "frame_minus_5_seconds",
    label: "画面推演 · 5 秒前",
    description: "还原连续镜头的前置状态",
    icon: "-5",
    mode: "temporal_inference",
    requiresImage: true,
    prompt: `任务：将当前图片视为连续镜头中的一个瞬间，反向推演大约 5 秒之前最合理的画面状态。

${preserve} 输出一张代表 T-5 秒状态的静态图片。根据当前人物姿势、动作趋势、物体状态、环境变化和视觉线索，遵循人体运动规律、惯性、重力、物体运动、空间连续性和人物行为逻辑，合理还原动作发生前的状态；例如正在坐下可回到站立或下蹲过程，正在奔跑可回到运动路径更靠后的位置，正在落下的物体应位于更高位置。没有明显摄影机运动时保持相同机位和焦段，禁止凭空创造重大剧情事件、换角色、换衣服、换场景、改变建筑、人物身份或整体美术风格。`,
    builtin: true,
  },
];

export function allImagePresets(custom: CustomImagePreset[] = []) {
  return [
    ...BUILTIN_IMAGE_PRESETS,
    ...custom.map((preset) => ({
      ...preset,
      mode: "reference_generate" as const,
      requiresImage: true as const,
    })),
  ];
}

export function normalizeCustomImagePresets(value: unknown): CustomImagePreset[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item): CustomImagePreset[] => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" && /^custom_[a-z0-9_-]{4,80}$/.test(raw.id) ? raw.id : "";
    const label = typeof raw.label === "string" ? raw.label.trim().slice(0, 40) : "";
    const prompt = typeof raw.prompt === "string" ? raw.prompt.trim().slice(0, 12000) : "";
    const icon = typeof raw.icon === "string" && IMAGE_PRESET_ICONS.includes(raw.icon.trim() as typeof IMAGE_PRESET_ICONS[number])
      ? raw.icon.trim()
      : "✦";
    if (!id || seen.has(id) || !label || !prompt) return [];
    seen.add(id);
    return [{ id, label, description: "自定义图片预设", icon: icon || "✦", prompt, builtin: false }];
  }).slice(0, 50);
}

export function readCustomImagePresets() {
  if (typeof window === "undefined") return [];
  try {
    return normalizeCustomImagePresets(JSON.parse(window.localStorage.getItem(IMAGE_PRESETS_STORAGE_KEY) || "null"));
  } catch {
    return [];
  }
}

export function writeCustomImagePresets(value: CustomImagePreset[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IMAGE_PRESETS_STORAGE_KEY, JSON.stringify(normalizeCustomImagePresets(value)));
    window.dispatchEvent(new Event("sanmao-image-presets-change"));
    window.dispatchEvent(new Event("sanmao-workspace-change"));
  } catch {
    /* Local preferences are optional and must never block generation. */
  }
}
