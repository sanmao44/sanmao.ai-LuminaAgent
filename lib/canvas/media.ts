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
