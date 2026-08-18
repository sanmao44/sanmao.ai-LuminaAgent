import type { ReferenceImageRecord } from './types';

const STORAGE_REFERENCE_PREFIX = '/api/storage/file?';

export function normalizeReferenceRecords(input: unknown, options: { max?: number; keepDataUrls?: boolean } = {}): ReferenceImageRecord[] {
  const max = Math.max(1, Math.min(16, options.max || 16));
  if (!Array.isArray(input)) return [];
  return input
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'))
    .map<ReferenceImageRecord | null>((value) => {
      const rawUrl = typeof value.url === 'string' ? value.url.trim() : '';
      const url = !options.keepDataUrls && rawUrl.startsWith('data:image/') ? '' : rawUrl;
      const name = typeof value.name === 'string' ? value.name.trim().slice(0, 160) : '';
      const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim().slice(0, 120) : undefined;
      if (!rawUrl && !name) return null;
      const record: ReferenceImageRecord = { name: name || '参考图', url };
      if (id) record.id = id;
      return record;
    })
    .filter((value): value is ReferenceImageRecord => value !== null)
    .slice(0, max);
}

export function isPersistedReferenceUrl(url: string) {
  return url.startsWith(STORAGE_REFERENCE_PREFIX) || /^https?:\/\//i.test(url);
}

export function referenceRecordsForLog(input: unknown): ReferenceImageRecord[] {
  return normalizeReferenceRecords(input, { keepDataUrls: false }).map((reference) => ({
    ...reference,
    // Never put a large data URL into the JSONL log. The name still lets the
    // log explain what was submitted if local storage was temporarily unavailable.
    url: isPersistedReferenceUrl(reference.url) ? reference.url : '',
  }));
}
