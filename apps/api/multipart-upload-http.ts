export class MultipartBodyTooLargeError extends Error {
  constructor() {
    super('Multipart upload exceeds the configured size limit.');
    this.name = 'MultipartBodyTooLargeError';
  }
}

export class MalformedMultipartRequestError extends Error {
  constructor() {
    super('Multipart upload could not be parsed.');
    this.name = 'MalformedMultipartRequestError';
  }
}

export async function readBoundedMultipartFormData(request: Request, maximumBytes: number): Promise<FormData> {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) throw new MultipartBodyTooLargeError();

  if (!request.body) throw new MalformedMultipartRequestError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new MultipartBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const headers = new Headers(request.headers);
  headers.delete('content-length');
  const bufferedRequest = new Request(request.url, {
    method: request.method,
    headers,
    body: Buffer.concat(chunks, byteLength),
  });
  try {
    return await bufferedRequest.formData();
  } catch {
    throw new MalformedMultipartRequestError();
  }
}
