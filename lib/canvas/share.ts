import { buildShareImageLayout, buildSharePromptPlan } from "@/lib/share-image-layout";

export type CanvasShareReference = {
  id: string;
  name: string;
  url: string;
  kind?: "image" | "video";
};

export type CanvasShareItem = {
  id: string;
  url: string;
  name?: string;
  prompt?: string;
  modelName?: string;
  createdAt?: number | string | Date;
  references?: CanvasShareReference[];
};

type CanvasImage = HTMLImageElement;

const SHARE_FONT = '"Segoe UI", "Microsoft YaHei", sans-serif';

function truncateShareText(value: unknown, max = 28) {
  const text = String(value || "").trim();
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function loadShareImage(url: string): Promise<CanvasImage> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (/^https?:\/\//i.test(url)) image.crossOrigin = "anonymous";
    image.onload = () =>
      image.naturalWidth > 0 && image.naturalHeight > 0
        ? resolve(image)
        : reject(new Error("图片尺寸无效"));
    image.onerror = () => reject(new Error("分享素材读取失败"));
    image.src = url;
  });
}

function containShareRect(
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.min(
    width / Math.max(1, sourceWidth),
    height / Math.max(1, sourceHeight),
  );
  const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
  return {
    x: Math.round(x + (width - drawWidth) / 2),
    y: Math.round(y + (height - drawHeight) / 2),
    width: drawWidth,
    height: drawHeight,
  };
}

function roundShareRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawSharePill(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke?: string,
) {
  roundShareRect(context, x, y, width, height, height / 2);
  context.fillStyle = fill;
  context.fill();
  if (!stroke) return;
  roundShareRect(context, x, y, width, height, height / 2);
  context.strokeStyle = stroke;
  context.lineWidth = 1;
  context.stroke();
}

function drawShareImageContain(
  context: CanvasRenderingContext2D,
  image: CanvasImage,
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 0,
) {
  const imageRect = containShareRect(
    image.naturalWidth,
    image.naturalHeight,
    x,
    y,
    width,
    height,
  );
  context.save();
  if (radius > 0) {
    roundShareRect(context, x, y, width, height, radius);
    context.clip();
  }
  context.drawImage(image, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
  context.restore();
  return imageRect;
}

function shareDate(value: CanvasShareItem["createdAt"]) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/**
 * Generates the same branded result card used by the main workspace share flow.
 * Canvas references are intentionally supplied by the caller because they come
 * from canvas edges instead of the gallery record shape.
 */
export async function downloadCanvasShareImage(item: CanvasShareItem) {
  const references = (item.references || []).filter(
    (reference) => reference.url && reference.kind !== "video",
  );
  const images = await Promise.all([
    loadShareImage(item.url),
    ...references.map((reference) => loadShareImage(reference.url)),
    loadShareImage("/brand-mark.png"),
    loadShareImage("/share-qr.png"),
  ]);
  const resultImage = images[0];
  const referenceImages = images.slice(1, references.length + 1);
  const brandImage = images[references.length + 1];
  const qrImage = images[references.length + 2];
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器不支持分享版图片生成");
  const promptMeasure = (value: string, fontSize = 22) => {
    context.font = `500 ${fontSize}px ${SHARE_FONT}`;
    return context.measureText(value).width;
  };
  const promptPlan = buildSharePromptPlan(item.prompt || "", promptMeasure, 1232);
  const layout = buildShareImageLayout({
    resultWidth: resultImage.naturalWidth,
    resultHeight: resultImage.naturalHeight,
    promptPlan,
    referenceCount: references.length,
  });
  if (layout.overflow) {
    throw new Error("提示词过长，无法在单张分享 PNG 中完整排版；请在应用内复制提示词后分享。");
  }

  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;
  context.fillStyle = "#eef1f6";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const backgroundGlow = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  backgroundGlow.addColorStop(0, "rgba(117, 104, 245, .08)");
  backgroundGlow.addColorStop(0.42, "rgba(255, 255, 255, 0)");
  backgroundGlow.addColorStop(1, "rgba(53, 193, 151, .08)");
  context.fillStyle = backgroundGlow;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(117, 104, 245, .08)";
  context.beginPath();
  context.arc(canvas.width - 18, 30, 180, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(53, 193, 151, .06)";
  context.beginPath();
  context.arc(35, layout.footerY + 100, 180, 0, Math.PI * 2);
  context.fill();

  const logoSize = 60;
  context.shadowColor = "rgba(25,35,56,.16)";
  context.shadowBlur = 18;
  context.shadowOffsetY = 6;
  roundShareRect(context, layout.padding, 28, logoSize, logoSize, 16);
  context.fillStyle = "#08090d";
  context.fill();
  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  drawShareImageContain(context, brandImage, layout.padding, 28, logoSize, logoSize, 16);
  context.fillStyle = "#182238";
  context.font = `800 30px ${SHARE_FONT}`;
  context.fillText("SANMAO.AI", layout.padding + 80, 54);
  context.fillStyle = "#68758a";
  context.font = `500 15px ${SHARE_FONT}`;
  context.fillText("AI 创作工作台  ·  IMAGE SHARE", layout.padding + 82, 80);
  const headerPillWidth = 270;
  const headerPillX = canvas.width - layout.padding - headerPillWidth;
  drawSharePill(context, headerPillX, 34, headerPillWidth, 42, "rgba(255,255,255,.78)", "#d9deea");
  context.fillStyle = "#7568f5";
  context.font = `800 11px ${SHARE_FONT}`;
  context.fillText("IMAGE / RESULT", headerPillX + 18, 52);
  const createdAt = shareDate(item.createdAt);
  context.fillStyle = "#7d8798";
  context.font = `500 11px ${SHARE_FONT}`;
  context.textAlign = "right";
  context.fillText(createdAt.toLocaleDateString("zh-CN"), headerPillX + headerPillWidth - 18, 52);
  context.textAlign = "left";
  context.fillStyle = "#9aa3b1";
  context.font = `500 11px ${SHARE_FONT}`;
  context.fillText("GENERATIVE IMAGE  ·  SANMAO.AI", headerPillX + 18, 67);

  context.fillStyle = "#ffffff";
  context.shadowColor = "rgba(25,35,56,.12)";
  context.shadowBlur = 24;
  context.shadowOffsetY = 8;
  roundShareRect(context, layout.resultFrame.x, layout.resultFrame.y, layout.resultFrame.width, layout.resultFrame.height, 20);
  context.fill();
  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.fillStyle = "#192338";
  context.font = `800 12px ${SHARE_FONT}`;
  context.fillText("GENERATED IMAGE", layout.resultFrame.x + 28, layout.resultFrame.y + 18);
  context.fillStyle = "#9aa3b1";
  context.font = `500 12px ${SHARE_FONT}`;
  context.textAlign = "right";
  context.fillText(
    `${truncateShareText(item.modelName || "图片模型", 42)}  ·  ${createdAt.toLocaleString("zh-CN", { hour12: false })}`,
    layout.resultFrame.x + layout.resultFrame.width - 28,
    layout.resultFrame.y + 18,
  );
  context.textAlign = "left";
  drawShareImageContain(context, resultImage, layout.resultContent.x, layout.resultContent.y, layout.resultContent.width, layout.resultContent.height, 12);
  context.strokeStyle = "#e4e7ef";
  context.lineWidth = 1;
  roundShareRect(context, layout.resultContent.x, layout.resultContent.y, layout.resultContent.width, layout.resultContent.height, 12);
  context.stroke();

  context.fillStyle = "#ffffff";
  context.shadowColor = "rgba(25,35,56,.08)";
  context.shadowBlur = 18;
  context.shadowOffsetY = 5;
  roundShareRect(context, layout.promptFrame.x, layout.promptFrame.y, layout.promptFrame.width, layout.promptFrame.height, 18);
  context.fill();
  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.fillStyle = "#7568f5";
  roundShareRect(context, layout.promptFrame.x + 28, layout.promptFrame.y + 24, 6, 30, 3);
  context.fill();
  context.fillStyle = "#192338";
  context.font = `700 22px ${SHARE_FONT}`;
  context.fillText("提示词", layout.promptFrame.x + 50, layout.promptFrame.y + 48);
  context.fillStyle = "#8792a3";
  context.font = `500 13px ${SHARE_FONT}`;
  context.fillText("用户提交内容", layout.promptFrame.x + 50, layout.promptFrame.y + 70);
  const promptStartY = layout.promptFrame.y + 98;
  const promptStartX = layout.promptFrame.x + 28;
  promptPlan.columns.forEach((column, columnIndex) => {
    const x = promptStartX + columnIndex * (promptPlan.columnWidth + promptPlan.columnGap);
    let y = promptStartY;
    context.fillStyle = "#526075";
    context.font = `500 ${promptPlan.fontSize}px ${SHARE_FONT}`;
    column.forEach((line) => {
      if (!line) {
        y += promptPlan.lineHeight + promptPlan.paragraphGap;
        return;
      }
      context.fillText(line, x, y + promptPlan.fontSize);
      y += promptPlan.lineHeight;
    });
  });

  context.fillStyle = "#192338";
  context.font = `700 23px ${SHARE_FONT}`;
  context.fillText(`参考图（按提交顺序 · ${references.length} 张）`, layout.padding, layout.referenceHeadingY + 24);
  references.forEach((reference, index) => {
    const column = index % layout.referenceColumns;
    const row = Math.floor(index / layout.referenceColumns);
    const x = layout.padding + column * (layout.referenceTileWidth + layout.referenceTileGap);
    const y = layout.referenceTilesY + row * (layout.referenceTileHeight + layout.referenceTileGap);
    context.fillStyle = "#ffffff";
    context.shadowColor = "rgba(25,35,56,.08)";
    context.shadowBlur = 14;
    context.shadowOffsetY = 4;
    roundShareRect(context, x, y, layout.referenceTileWidth, layout.referenceTileHeight, 14);
    context.fill();
    context.shadowColor = "transparent";
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    const referenceImage = referenceImages[index];
    drawShareImageContain(context, referenceImage, x + 12, y + 12, layout.referenceTileWidth - 24, 132, 10);
    context.strokeStyle = "#e6e9f0";
    context.lineWidth = 1;
    roundShareRect(context, x + 12, y + 12, layout.referenceTileWidth - 24, 132, 10);
    context.stroke();
    context.fillStyle = "#526075";
    context.font = `700 16px ${SHARE_FONT}`;
    context.fillText(`图 ${index + 1}`, x + 12, y + 163);
    context.fillStyle = "#7b8798";
    context.font = `500 14px ${SHARE_FONT}`;
    context.fillText(truncateShareText(reference.name, 18), x + 58, y + 163);
  });

  const footerX = layout.padding;
  const footerY = layout.footerY;
  const footerWidth = layout.contentWidth;
  context.fillStyle = "#ffffff";
  context.shadowColor = "rgba(25,35,56,.10)";
  context.shadowBlur = 22;
  context.shadowOffsetY = 7;
  roundShareRect(context, footerX, footerY, footerWidth, layout.footerHeight, 22);
  context.fill();
  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  const footerAccent = context.createLinearGradient(footerX, footerY, footerX + footerWidth, footerY);
  footerAccent.addColorStop(0, "#7568f5");
  footerAccent.addColorStop(1, "#35c197");
  context.fillStyle = footerAccent;
  roundShareRect(context, footerX, footerY, footerWidth, 6, 3);
  context.fill();
  const footerLogoSize = 76;
  context.fillStyle = "#08090d";
  roundShareRect(context, footerX + 30, footerY + 40, footerLogoSize, footerLogoSize, 18);
  context.fill();
  drawShareImageContain(context, brandImage, footerX + 30, footerY + 40, footerLogoSize, footerLogoSize, 18);
  context.fillStyle = "#182238";
  context.font = `800 25px ${SHARE_FONT}`;
  context.fillText("让灵感落地，把想法变成作品", footerX + 132, footerY + 72);
  context.fillStyle = "#7568f5";
  context.font = `800 15px ${SHARE_FONT}`;
  context.fillText("SANMAO.AI  ·  AI 创作工作台", footerX + 132, footerY + 101);
  context.fillStyle = "#68758a";
  context.font = `500 14px ${SHARE_FONT}`;
  context.fillText("从提示词到成片，让每一次创作都有迹可循。", footerX + 132, footerY + 130);
  context.fillStyle = "#9aa3b1";
  context.font = `500 12px ${SHARE_FONT}`;
  context.fillText("内容由 SANMAO.AI 生成，仅供参考", footerX + 30, footerY + layout.footerHeight - 24);

  const qrPanelWidth = layout.footerQrSize + 28;
  const qrPanelHeight = layout.footerHeight - 28;
  const qrPanelX = footerX + footerWidth - qrPanelWidth - 24;
  const qrPanelY = footerY + 14;
  roundShareRect(context, qrPanelX, qrPanelY, qrPanelWidth, qrPanelHeight, 18);
  context.fillStyle = "#f7f8fb";
  context.fill();
  context.strokeStyle = "#e2e6ef";
  context.lineWidth = 1;
  roundShareRect(context, qrPanelX, qrPanelY, qrPanelWidth, qrPanelHeight, 18);
  context.stroke();
  context.fillStyle = "#182238";
  context.font = `800 13px ${SHARE_FONT}`;
  context.textAlign = "center";
  context.fillText("扫码访问 SANMAO.AI", qrPanelX + qrPanelWidth / 2, qrPanelY + 20);
  drawShareImageContain(context, qrImage, qrPanelX + 14, qrPanelY + 27, layout.footerQrSize, qrPanelHeight - 36, 8);
  context.textAlign = "left";

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("分享版图片导出失败"))),
      "image/png",
    ),
  );
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `SANMAO-${item.id}-分享版.png`;
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}
