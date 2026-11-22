/** Match an auto-fill grid's capacity while allowing one card in a narrow container. */
export function historyGridColumnCapacity(width: number, minimum: number, gap: number): number {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(minimum) || minimum <= 0) return 1;
  const spacing = Number.isFinite(gap) ? Math.max(0, gap) : 0;
  return Math.max(1, Math.floor((width + spacing) / (minimum + spacing)));
}

/** Keep automatic pages on complete grid rows without shrinking the page. */
export function completeHistoryPageSize(columnCount: number, minimumPageSize: number): number {
  const columns = Number.isFinite(columnCount) ? Math.max(1, Math.floor(columnCount)) : 1;
  const minimum = Number.isFinite(minimumPageSize) ? Math.max(1, Math.floor(minimumPageSize)) : 1;
  return Math.max(columns, Math.ceil(minimum / columns) * columns);
}

export function completeHistoryGridPageSizes(
  columns: { images?: number; videos?: number },
  minimumPageSize: number,
): { images?: number; videos?: number } {
  return {
    ...(columns.images === undefined ? {} : { images: completeHistoryPageSize(columns.images, minimumPageSize) }),
    ...(columns.videos === undefined ? {} : { videos: completeHistoryPageSize(columns.videos, minimumPageSize) }),
  };
}

export function completeHistoryColumnCount(maxColumnCount: number, pageSize: number): number {
  const maximum = Number.isFinite(maxColumnCount) ? Math.max(1, Math.floor(maxColumnCount)) : 1;
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 1;
  for (let columns = maximum; columns > 1; columns -= 1) {
    if (size % columns === 0) return columns;
  }
  return 1;
}
