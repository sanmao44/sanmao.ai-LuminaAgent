/** Keep automatic pages on complete grid rows without shrinking the page. */
export function completeHistoryPageSize(columnCount: number, minimumPageSize: number): number {
  const columns = Number.isFinite(columnCount) ? Math.max(1, Math.floor(columnCount)) : 1;
  const minimum = Number.isFinite(minimumPageSize) ? Math.max(1, Math.floor(minimumPageSize)) : 1;
  return Math.max(columns, Math.ceil(minimum / columns) * columns);
}
