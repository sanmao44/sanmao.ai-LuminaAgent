import type { CanvasNode } from "@/lib/canvas/types";

export function nodeLabel(node: CanvasNode) {
  if (node.data.depthVideo) return "视频深度图";
  if (node.type === "video-editor") return "视频编辑节点";
  if (node.type === "angle") return "角度控制节点";
  if (node.type === "upscale") return "图片超分";
  if (node.type === "prompt") return "Agent 节点";
  if (node.type === "generator")
    return node.data.kind === "video" ? "视频变体生成器" : "图片变体生成器";
  return node.data.kind === "video" ? "视频卡片" : node.data.kind === "audio" ? "音频节点" : "图片卡片";
}