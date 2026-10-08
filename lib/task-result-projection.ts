export type ProjectedResultStatus = 'pending' | 'success' | 'error';

/** A retained provider artifact is authoritative over a stale failure marker. */
export function retainedResultUrls(values: readonly unknown[] | undefined) {
  return (values || [])
    .map((value) => String(value || '').trim())
    .filter((value, index, urls) => Boolean(value) && urls.indexOf(value) === index);
}

export function projectResultStatus(status: ProjectedResultStatus, outputUrls: readonly unknown[] | undefined): ProjectedResultStatus {
  return retainedResultUrls(outputUrls).length ? 'success' : status;
}
