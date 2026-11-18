export type ModelPreviewDownloadProgress = {
  loadedBytes: number;
  totalBytes: number | null;
  percentage: number | null;
};

export function modelPreviewDownloadProgress(loaded: number, total: number): ModelPreviewDownloadProgress {
  const loadedBytes = Number.isFinite(loaded) ? Math.max(0, Math.floor(loaded)) : 0;
  const totalBytes = Number.isFinite(total) && total > 0 ? Math.floor(total) : null;
  return {
    loadedBytes,
    totalBytes,
    percentage: totalBytes === null ? null : Math.min(100, Math.round((loadedBytes / totalBytes) * 100)),
  };
}

export function modelPreviewBytesLabel(bytes: number) {
  const safeBytes = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  return `${(safeBytes / (1024 * 1024)).toFixed(1)} MiB`;
}
