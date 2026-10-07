import type { CanvasAlignment, CanvasArrangeMode, CanvasDistribution } from "./model";

export const CANVAS_ARRANGE_MODE_OPTIONS: Array<{
  value: CanvasArrangeMode;
  label: string;
  description: string;
  icon: string;
}> = [
  {
    value: "horizontal",
    label: "横向排列",
    description: "按当前顺序排成一行",
    icon: "↔",
  },
  {
    value: "vertical",
    label: "纵向排列",
    description: "按当前顺序排成一列",
    icon: "↕",
  },
  {
    value: "grid",
    label: "宫格排列",
    description: "自动分成接近方阵的多行",
    icon: "▦",
  },
];

export function canvasArrangeModeLabel(mode: CanvasArrangeMode) {
  return CANVAS_ARRANGE_MODE_OPTIONS.find((option) => option.value === mode)?.label || "宫格排列";
}
export const CANVAS_ALIGNMENT_OPTIONS: Array<{
  value: CanvasAlignment;
  label: string;
  title: string;
  icon: CanvasAlignment;
}> = [
  { value: "left", label: "左对齐", title: "将选中节点左边缘对齐", icon: "left" },
  { value: "center-x", label: "水平居中", title: "将选中节点水平居中", icon: "center-x" },
  { value: "right", label: "右对齐", title: "将选中节点右边缘对齐", icon: "right" },
  { value: "top", label: "顶部对齐", title: "将选中节点顶部对齐", icon: "top" },
  { value: "center-y", label: "垂直居中", title: "将选中节点垂直居中", icon: "center-y" },
  { value: "bottom", label: "底部对齐", title: "将选中节点底部对齐", icon: "bottom" },
];
export const CANVAS_DISTRIBUTION_OPTIONS: Array<{
  value: CanvasDistribution;
  label: string;
  title: string;
  icon: CanvasDistribution;
}> = [
  {
    value: "horizontal",
    label: "水平均匀分布",
    title: "将选中节点按边缘等间隙水平分布",
    icon: "horizontal",
  },
  {
    value: "vertical",
    label: "垂直均匀分布",
    title: "将选中节点按边缘等间隙垂直分布",
    icon: "vertical",
  },
];
