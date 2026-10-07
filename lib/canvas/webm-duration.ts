type EbmlVint = {
  length: number;
  value: number;
  unknown: boolean;
};

type EbmlElement = {
  offset: number;
  sizeOffset: number;
  sizeLength: number;
  dataOffset: number;
  dataEnd: number;
  size: number;
  unknownSize: boolean;
};

const SEGMENT_ID = [0x18, 0x53, 0x80, 0x67];
const INFO_ID = [0x15, 0x49, 0xa9, 0x66];
const DURATION_ID = [0x44, 0x89];

function readVint(bytes: Uint8Array, offset: number, keepMarker: boolean): EbmlVint | null {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  let marker = 0x80;
  let length = 1;
  while (!(first & marker) && length < 8) {
    marker >>= 1;
    length += 1;
  }
  if (!(first & marker) || offset + length > bytes.length) return null;
  let value = keepMarker ? first : first & (marker - 1);
  let unknown = !keepMarker && (first & (marker - 1)) === marker - 1;
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + bytes[offset + index];
    if (bytes[offset + index] !== 0xff) unknown = false;
  }
  return { length, value, unknown };
}

function readElement(bytes: Uint8Array, offset: number, limit = bytes.length): EbmlElement | null {
  const id = readVint(bytes, offset, true);
  if (!id) return null;
  const sizeOffset = offset + id.length;
  const size = readVint(bytes, sizeOffset, false);
  if (!size) return null;
  const dataOffset = sizeOffset + size.length;
  const dataEnd = size.unknown ? limit : dataOffset + size.value;
  if (dataOffset > limit || dataEnd > limit) return null;
  return {
    offset,
    sizeOffset,
    sizeLength: size.length,
    dataOffset,
    dataEnd,
    size: size.value,
    unknownSize: size.unknown,
  };
}

function matches(bytes: Uint8Array, offset: number, id: readonly number[]) {
  return id.every((value, index) => bytes[offset + index] === value);
}

function findBytes(bytes: Uint8Array, id: readonly number[], start: number, end: number) {
  const last = Math.min(bytes.length, end) - id.length;
  for (let offset = Math.max(0, start); offset <= last; offset += 1) {
    if (matches(bytes, offset, id)) return offset;
  }
  return -1;
}

function findChild(bytes: Uint8Array, parent: EbmlElement, id: readonly number[]) {
  let offset = parent.dataOffset;
  while (offset < parent.dataEnd) {
    const child = readElement(bytes, offset, parent.dataEnd);
    if (!child) return null;
    if (matches(bytes, child.offset, id)) return child;
    if (child.unknownSize || child.dataEnd <= offset) return null;
    offset = child.dataEnd;
  }
  return null;
}

function encodeVint(value: number, length: number) {
  const maximum = 2 ** (7 * length) - 1;
  if (!Number.isSafeInteger(value) || value < 0 || value >= maximum) return null;
  const encoded = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    encoded[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  encoded[0] |= 1 << (8 - length);
  return encoded;
}

function durationPayload(durationSeconds: number, byteLength: number) {
  if (byteLength !== 4 && byteLength !== 8) return null;
  const payload = new Uint8Array(byteLength);
  const view = new DataView(payload.buffer);
  const milliseconds = durationSeconds * 1000;
  if (byteLength === 4) view.setFloat32(0, milliseconds, false);
  else view.setFloat64(0, milliseconds, false);
  return payload;
}

function replaceRange(source: Uint8Array, offset: number, removeLength: number, inserted: Uint8Array) {
  const output = new Uint8Array(source.length - removeLength + inserted.length);
  output.set(source.subarray(0, offset));
  output.set(inserted, offset);
  output.set(source.subarray(offset + removeLength), offset + inserted.length);
  return output;
}

/** Add the known recording duration to streaming WebM output without re-encoding. */
export async function writeWebmDuration(blob: Blob, durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !blob.type.toLowerCase().includes("webm")) return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const segmentOffset = findBytes(bytes, SEGMENT_ID, 0, Math.min(bytes.length, 64 * 1024));
  if (segmentOffset < 0) return blob;
  const segment = readElement(bytes, segmentOffset);
  if (!segment) return blob;
  const info = findChild(bytes, segment, INFO_ID);
  if (!info || info.unknownSize) return blob;

  const existing = findChild(bytes, info, DURATION_ID);
  if (existing) {
    const payload = durationPayload(durationSeconds, existing.size);
    if (!payload) return blob;
    const output = bytes.slice();
    output.set(payload, existing.dataOffset);
    return new Blob([output], { type: blob.type || "video/webm" });
  }

  // Inserting into a finite indexed Segment would invalidate Seek/Cue offsets.
  // The affected MediaRecorder files use an unknown-size streaming Segment.
  if (!segment.unknownSize) return blob;
  const payload = durationPayload(durationSeconds, 8);
  const nextInfoSize = encodeVint(info.size + 3 + (payload?.length || 0), info.sizeLength);
  if (!payload || !nextInfoSize) return blob;
  const duration = new Uint8Array(3 + payload.length);
  duration.set(DURATION_ID, 0);
  duration[2] = 0x88;
  duration.set(payload, 3);
  const withDuration = replaceRange(bytes, info.dataEnd, 0, duration);
  withDuration.set(nextInfoSize, info.sizeOffset);
  return new Blob([withDuration], { type: blob.type || "video/webm" });
}
