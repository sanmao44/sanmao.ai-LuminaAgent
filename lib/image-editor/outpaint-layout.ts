export type OutpaintLayout = {
  sourceWidth: number;
  sourceHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  offsetX: number;
  offsetY: number;
};

export type OutpaintRule = {
  family: string;
  label: string;
  hint: string;
  maxEdge?: number;
  minPixels?: number;
  maxPixels?: number;
  maxRatio?: number;
  multiple?: number;
};

export type OutpaintValidation = { valid: boolean; messages: string[]; pixels: number; ratio: number };

export function centeredOutpaintLayout(sourceWidth: number, sourceHeight: number, canvasWidth: number, canvasHeight: number): OutpaintLayout {
  const width = Math.max(sourceWidth, Math.round(canvasWidth));
  const height = Math.max(sourceHeight, Math.round(canvasHeight));
  return { sourceWidth, sourceHeight, canvasWidth: width, canvasHeight: height, offsetX: Math.round((width - sourceWidth) / 2), offsetY: Math.round((height - sourceHeight) / 2) };
}

export function defaultOutpaintLayout(sourceWidth: number, sourceHeight: number): OutpaintLayout {
  const padX = Math.ceil(Math.max(96, sourceWidth * 0.18) / 16) * 16;
  const padY = Math.ceil(Math.max(96, sourceHeight * 0.18) / 16) * 16;
  return centeredOutpaintLayout(sourceWidth, sourceHeight, sourceWidth + padX * 2, sourceHeight + padY * 2);
}

export function outpaintRuleForModel(model: { rawId?: unknown; displayName?: unknown; providerName?: unknown } | null | undefined): OutpaintRule {
  const name = `${model?.rawId || ""} ${model?.displayName || ""} ${model?.providerName || ""}`.toLowerCase();
  if (/gpt[-_\s]*image[-_\s]*2/.test(name)) return { family: "gpt-image-2", label: "GPT Image 2", hint: "长边 ≤ 3840，长短边 ≤ 3:1，像素量 655,360～8,294,400；提交时会自动做尺寸对齐。", maxEdge: 3840, minPixels: 655360, maxPixels: 8294400, maxRatio: 3 };
  if (/gemini.*3\.1.*flash.*image/.test(name) || /gemini.*flash.*image/.test(name)) return { family: "gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image", hint: "支持 512 / 1K / 2K / 4K 档位；当前工作台按长边 3840、约 16MP、最长宽高比 8:1 做提示。", maxEdge: 3840, maxPixels: 16777216, maxRatio: 8 };
  return { family: "unknown", label: typeof model?.displayName === "string" ? model.displayName : "当前图片模型", hint: "未识别到公开尺寸限制；拖动时不额外拦截，若上游拒绝再按报错调整。" };
}

export function validateOutpaintLayout(layout: OutpaintLayout, rule: OutpaintRule): OutpaintValidation {
  const messages: string[] = [];
  const pixels = layout.canvasWidth * layout.canvasHeight;
  const longEdge = Math.max(layout.canvasWidth, layout.canvasHeight);
  const shortEdge = Math.max(1, Math.min(layout.canvasWidth, layout.canvasHeight));
  const ratio = longEdge / shortEdge;
  if (rule.maxEdge && longEdge > rule.maxEdge) messages.push(`${rule.label} 长边不能超过 ${rule.maxEdge}px`);
  if (rule.multiple && (layout.canvasWidth % rule.multiple !== 0 || layout.canvasHeight % rule.multiple !== 0)) messages.push(`${rule.label} 宽高需要是 ${rule.multiple}px 的倍数`);
  if (rule.maxRatio && ratio > rule.maxRatio) messages.push(`${rule.label} 长短边比例不能超过 ${rule.maxRatio}:1`);
  if (rule.maxPixels && pixels > rule.maxPixels) messages.push(`${rule.label} 画布像素量超过上限`);
  if (rule.minPixels && pixels < rule.minPixels) messages.push(`${rule.label} 画布像素量低于下限`);
  return { valid: messages.length === 0, messages, pixels, ratio };
}

export function fitOutpaintLayoutToRule(layout: OutpaintLayout, rule: OutpaintRule): OutpaintLayout {
  let width = layout.canvasWidth;
  let height = layout.canvasHeight;
  const multiple = rule.multiple || 1;
  const snapUp = (value: number) => Math.ceil(Math.max(1, value) / multiple) * multiple;
  const snapDown = (value: number) => Math.max(multiple, Math.floor(Math.max(1, value) / multiple) * multiple);
  width = Math.max(layout.sourceWidth, snapUp(width));
  height = Math.max(layout.sourceHeight, snapUp(height));
  if (rule.maxRatio && Math.max(width, height) / Math.max(1, Math.min(width, height)) > rule.maxRatio) {
    if (width > height) height = Math.max(height, snapUp(width / rule.maxRatio));
    else width = Math.max(width, snapUp(height / rule.maxRatio));
  }
  if (rule.maxEdge && Math.max(width, height) > rule.maxEdge) {
    const scale = rule.maxEdge / Math.max(width, height);
    width = Math.max(layout.sourceWidth, snapDown(width * scale));
    height = Math.max(layout.sourceHeight, snapDown(height * scale));
  }
  if (rule.maxPixels && width * height > rule.maxPixels) {
    const scale = Math.sqrt(rule.maxPixels / (width * height));
    width = Math.max(layout.sourceWidth, snapDown(width * scale));
    height = Math.max(layout.sourceHeight, snapDown(height * scale));
  }
  if (rule.minPixels && width * height < rule.minPixels) {
    const scale = Math.sqrt(rule.minPixels / Math.max(1, width * height));
    width = Math.max(layout.sourceWidth, snapUp(width * scale));
    height = Math.max(layout.sourceHeight, snapUp(height * scale));
  }
  return centeredOutpaintLayout(layout.sourceWidth, layout.sourceHeight, width, height);
}
