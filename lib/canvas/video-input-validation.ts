import type { VideoCreationSettings } from "@/lib/creation/settings";
import type { VideoModelLimits } from "@/lib/video-model-limits";
import type { CanvasVideoInputMode, CanvasVideoInputs } from "./references";

/**
 * Explain why the connected inputs cannot be submitted in the selected video
 * mode. The caller owns when to validate and how to surface this message.
 */
export function canvasVideoInputError(
  inputs: CanvasVideoInputs,
  inputMode: CanvasVideoInputMode,
  limits: VideoModelLimits,
  operation: VideoCreationSettings["operation"] = "generate",
) {
  const connectedImages = inputs.orderedImages;
  const connectedVideos = inputs.media.filter((node) => node.data.kind === "video");
  const connectedAudios = inputs.orderedAudios;
  if (inputMode === "text") {
    if (connectedImages.length || connectedVideos.length || connectedAudios.length) return "已连接参考素材，但当前为文生视频模式；请切换到适合素材的生成方式，或移除输入后再生成。";
    return undefined;
  }
  if (connectedAudios.length) {
    if (limits.maxAudios <= 0) return "当前视频模型不支持参考音频，请切换到支持参考音频的模型，或移除音频输入。";
    if (inputMode !== "reference") return "首帧/首尾帧模式不能使用参考音频；请切换到参考素材模式，或移除音频输入。";
    if (connectedAudios.length > limits.maxAudios) return `当前模型最多接收 ${limits.maxAudios} 段参考音频，请减少音频输入或切换模型。`;
    if (inputs.unused.some((node) => node.data.kind === "audio") || inputs.audios.length !== connectedAudios.length) {
      return "当前模型或输入设置无法使用全部参考音频，请切换到支持参考音频的模型，或移除未使用的音频输入。";
    }
  }
  if (inputMode === "first-frame") {
    if (!inputs.firstFrame) return "首帧模式请先连接一张首帧图片。";
    if (inputs.unused.some((node) => node.data.kind === "image")) return "首帧模式只支持一张图片；请切换到首尾帧或参考素材模式。";
  }
  if (inputMode === "frames") {
    if (!inputs.firstFrame || !inputs.lastFrame) return "首尾帧模式请先连接首帧和尾帧两张图片。";
    if (inputs.unused.some((node) => node.data.kind === "image")) return "首尾帧模式只支持首帧和尾帧两张图片；请移除多余图片或切换到参考素材模式。";
  }
  if (inputMode === "reference") {
    if (!inputs.referenceImages.length && !inputs.referenceVideo && !inputs.audios.length) return "参考素材模式请先连接模型支持的图片、视频或音频。";
    if (inputs.unused.some((node) => node.data.kind === "image")) return `当前模型最多接收 ${limits.maxReferenceImages} 张参考图，请减少图片输入。`;
  }
  if (connectedVideos.length && operation === "generate" && inputMode !== "reference") {
    return "生成视频的首帧/首尾帧模式不能同时使用参考视频；请切换到参考素材模式，或移除视频输入。";
  }
  if (!connectedVideos.length) return undefined;
  if (inputMode !== "reference" && operation !== "generate" && limits.maxReferenceVideos <= 0) {
    return "当前视频模型不支持参考视频，请切换到支持参考视频的模型，或移除视频输入。";
  }
  if (limits.maxReferenceVideos <= 0) {
    return "当前视频模型不支持参考视频，请切换到支持参考视频的模型，或移除视频输入。";
  }
  if (connectedVideos.length > limits.maxReferenceVideos) {
    return `当前模型最多接收 ${limits.maxReferenceVideos} 个参考视频，请减少视频输入或切换模型。`;
  }
  return undefined;
}
