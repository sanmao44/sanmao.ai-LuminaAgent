export function formatCanvasVideoDuration(durationMs: unknown) {
  const milliseconds = Number(durationMs);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "";

  const totalSeconds = milliseconds / 1000;
  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  return `${totalSeconds.toFixed(1)}s`;
}

export function formatCanvasAudioDuration(durationMs?: number) {
  if (!Number.isFinite(durationMs) || !durationMs || durationMs <= 0) return "\u65f6\u957f\u8bfb\u53d6\u4e2d";
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes + ":" + String(seconds).padStart(2, "0");
}
