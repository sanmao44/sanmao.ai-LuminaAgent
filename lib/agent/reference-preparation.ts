import {
  normalizeCreativeReference,
  type CreativeReference,
} from '../creative-references';

type RawReferenceFields = {
  id?: unknown;
  kind?: unknown;
  name?: unknown;
  dataUrl?: unknown;
  url?: unknown;
  text?: unknown;
  mimeType?: unknown;
};

export type PreparedAgentReference = Pick<CreativeReference, 'id' | 'kind' | 'name'> &
  Partial<Pick<CreativeReference, 'url' | 'text' | 'mimeType'>>;

function rawReferenceFields(value: unknown): RawReferenceFields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as RawReferenceFields
    : {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** Normalize and prepare the bounded reference list sent to the Agent. */
export async function prepareAgentReferences(
  references: readonly unknown[] | null | undefined,
  compressImage: (url: string) => Promise<string>,
): Promise<PreparedAgentReference[]> {
  return Promise.all((references || []).slice(0, 16).map(async (rawReference, index) => {
    const normalized = normalizeCreativeReference(rawReference, index);
    const raw = rawReferenceFields(rawReference);
    const url = normalized?.url || stringField(raw.dataUrl) || stringField(raw.url);
    const kind = normalized?.kind || stringField(raw.kind) || 'image';
    const preparedUrl = kind === 'image' && url ? await compressImage(url) : url;
    return {
      id: (normalized?.id || stringField(raw.id)) as string,
      kind: kind === 'video' || kind === 'text' ? kind : 'image',
      name: normalized?.name || stringField(raw.name) || '引用素材',
      ...(preparedUrl ? { url: preparedUrl } : {}),
      ...(normalized?.text || stringField(raw.text) ? { text: normalized?.text || stringField(raw.text) } : {}),
      ...(normalized?.mimeType || stringField(raw.mimeType) ? { mimeType: normalized?.mimeType || stringField(raw.mimeType) } : {}),
    };
  }));
}
