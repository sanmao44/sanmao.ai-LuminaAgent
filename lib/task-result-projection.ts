export type ResultProjectionStatus = "pending" | "success" | "error";

/** Keeps provider/local output URLs usable across every task projection. */
export function usableResultUrls(value: readonly unknown[] | null | undefined) {
  return (value || [])
    .map((item) => String(item || "").trim())
    .filter((item, index, items) => Boolean(item) && items.indexOf(item) === index);
}

export function hasUsableResult(value: readonly unknown[] | null | undefined) {
  return usableResultUrls(value).length > 0;
}

/** A retained provider result wins over a stale terminal error. */
export function projectResultStatus(
  status: ResultProjectionStatus,
  outputUrls: readonly unknown[] | null | undefined,
): ResultProjectionStatus {
  return hasUsableResult(outputUrls) ? "success" : status;
}
