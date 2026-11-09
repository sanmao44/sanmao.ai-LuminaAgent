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
