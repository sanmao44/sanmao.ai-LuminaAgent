export function canvasAngleCardStateLabel(
  status: string,
  pending: boolean,
  hasReference: boolean,
) {
  if (status === "queued") return "排队中";
  if (pending) return "生成中";
  if (status === "failed") return "失败";
  return hasReference ? "已连接" : "待输入";
}
