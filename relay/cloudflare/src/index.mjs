const MEDIA_PATH = "/api/relay/media";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 128 * 1024;
const MAX_IMAGE_HEADER_BYTES = 256 * 1024;
const MEDIA_TTL_MS = 30 * 60 * 1000;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_DIMENSION = 16_384;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

class UploadValidationError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "UploadValidationError";
    this.status = status;
  }
}

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function ascii(bytes, offset, length) {
  let value = "";
  for (let index = offset; index < offset + length; index += 1) value += String.fromCharCode(bytes[index] || 0);
  return value;
}

function dimensionsAllowed(width, height) {
  return Number.isInteger(width)
    && Number.isInteger(height)
    && width > 0
    && height > 0
    && width <= MAX_IMAGE_DIMENSION
    && height <= MAX_IMAGE_DIMENSION
    && width * height <= MAX_IMAGE_PIXELS;
}

function jpegDimensions(bytes) {
  let offset = 2;
  let segments = 0;
  while (offset + 4 <= bytes.length && segments < 256) {
    segments += 1;
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    const isStartOfFrame = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
    if (isStartOfFrame && segmentLength >= 7) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) };
    }
    offset += segmentLength;
  }
  return null;
}

function detectImageHeaderMime(bytes) {
  if (bytes.length >= 24
    && bytes[0] === 0x89
    && ascii(bytes, 1, 3) === "PNG"
    && ascii(bytes, 12, 4) === "IHDR") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (view.getUint32(8) === 13 && dimensionsAllowed(width, height)) return "image/png";
  }

  if (bytes.length >= 10 && ascii(bytes, 0, 3) === "GIF" && ["87a", "89a"].includes(ascii(bytes, 3, 3))) {
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    if (dimensionsAllowed(width, height)) return "image/gif";
  }

  if (bytes.length >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunk = ascii(bytes, 12, 4);
    let width = 0;
    let height = 0;
    if (chunk === "VP8X") {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      width = 1 + (bits & 0x3fff);
      height = 1 + ((bits >>> 14) & 0x3fff);
    }
    if (dimensionsAllowed(width, height)) return "image/webp";
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const dimensions = jpegDimensions(bytes);
    if (dimensions && dimensionsAllowed(dimensions.width, dimensions.height)) return "image/jpeg";
  }

  return "";
}

function completeImage(mime, tail, totalBytes, header) {
  if (mime === "image/png") {
    return tail.length === 12
      && tail[0] === 0 && tail[1] === 0 && tail[2] === 0 && tail[3] === 0
      && ascii(tail, 4, 4) === "IEND"
      && tail[8] === 0xae && tail[9] === 0x42 && tail[10] === 0x60 && tail[11] === 0x82;
  }
  if (mime === "image/gif") return tail.at(-1) === 0x3b;
  if (mime === "image/jpeg") return tail.length >= 2 && tail.at(-2) === 0xff && tail.at(-1) === 0xd9;
  if (mime === "image/webp") {
    if (header.length < 8) return false;
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    return view.getUint32(4, true) + 8 === totalBytes;
  }
  return false;
}

function detectImageMime(bytes) {
  const mime = detectImageHeaderMime(bytes);
  if (!mime) return "";
  return completeImage(mime, bytes.subarray(Math.max(0, bytes.length - 12)), bytes.length, bytes) ? mime : "";
}

function updateTail(tail, chunk) {
  if (chunk.length >= 12) return chunk.subarray(chunk.length - 12);
  const chunkLength = chunk.length;
  const tailLength = Math.min(tail.length, 12 - chunkLength);
  const next = new Uint8Array(tailLength + chunkLength);
  if (tailLength) next.set(tail.subarray(tail.length - tailLength));
  if (chunkLength) next.set(chunk, tailLength);
  return next;
}

async function prepareImageStream(request, contentType) {
  if (!request.body) throw new UploadValidationError("上传内容为空", 415);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_IMAGE_BYTES) throw new UploadValidationError("图片不能超过 4 MiB", 413);

  const reader = request.body.getReader();
  const initialChunks = [];
  const headerBuffer = new Uint8Array(MAX_IMAGE_HEADER_BYTES);
  let headerLength = 0;
  let totalBytes = 0;
  let tail = new Uint8Array();
  let detectedMime = "";

  try {
    while (!detectedMime && headerLength < MAX_IMAGE_HEADER_BYTES) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_IMAGE_BYTES) throw new UploadValidationError("图片不能超过 4 MiB", 413);
      initialChunks.push(chunk);
      tail = updateTail(tail, chunk);
      const inspectedLength = Math.min(chunk.byteLength, MAX_IMAGE_HEADER_BYTES - headerLength);
      if (inspectedLength) {
        headerBuffer.set(chunk.subarray(0, inspectedLength), headerLength);
        headerLength += inspectedLength;
      }
      detectedMime = detectImageHeaderMime(headerBuffer.subarray(0, headerLength));
      if (detectedMime && detectedMime !== contentType) {
        throw new UploadValidationError("图片内容与声明格式不一致", 415);
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof UploadValidationError) throw error;
    throw new UploadValidationError("上传内容读取失败", 400);
  }

  if (!detectedMime) {
    await reader.cancel().catch(() => {});
    throw new UploadValidationError("只支持有效的 JPG、PNG、WebP 或 GIF 图片", 415);
  }

  const header = headerBuffer.subarray(0, headerLength);
  let initialIndex = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (initialIndex < initialChunks.length) {
        controller.enqueue(initialChunks[initialIndex]);
        initialIndex += 1;
        return;
      }
      try {
        const result = await reader.read();
        if (result.done) {
          if (!completeImage(detectedMime, tail, totalBytes, header)) {
            controller.error(new UploadValidationError("图片文件不完整", 415));
            return;
          }
          controller.close();
          return;
        }
        totalBytes += result.value.byteLength;
        if (totalBytes > MAX_IMAGE_BYTES) {
          await reader.cancel();
          controller.error(new UploadValidationError("图片不能超过 4 MiB", 413));
          return;
        }
        tail = updateTail(tail, result.value);
        controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return { body: stream, mime: detectedMime, byteLength: () => totalBytes };
}

async function readBoundedBody(stream, maximumBytes) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks = [];
  let byteLength = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    byteLength += result.value.byteLength;
    if (byteLength > maximumBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(result.value);
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function sign(payload, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64Url(new Uint8Array(signature));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function signingSecret(env) {
  const secret = String(env.MEDIA_SIGNING_KEY || "");
  return new TextEncoder().encode(secret).byteLength >= 32 ? secret : "";
}

function mediaKey(id, expiresAt) {
  return "media/" + String(expiresAt).padStart(13, "0") + "/" + id;
}

async function handleUpload(request, env) {
  if (!env.MEDIA_BUCKET || typeof env.MEDIA_BUCKET.put !== "function" || !signingSecret(env)) {
    return json({ error: "媒体中转服务配置不完整" }, 503);
  }
  if (String(env.MEDIA_UPLOADS_ENABLED || "true").toLowerCase() === "false") {
    return json({ error: "媒体中转上传已暂停" }, 503);
  }
  if (!env.UPLOAD_LIMITER || typeof env.UPLOAD_LIMITER.limit !== "function") {
    return json({ error: "媒体中转限流未配置" }, 503);
  }

  const clientIp = String(request.headers.get("cf-connecting-ip") || "").trim();
  if (!clientIp) return json({ error: "无法识别上传来源" }, 400);
  let rate;
  try {
    rate = await env.UPLOAD_LIMITER.limit({ key: clientIp });
  } catch (error) {
    console.error("media upload limiter failed", error instanceof Error ? error.name : "UnknownError");
    return json({ error: "媒体中转暂时不可用" }, 503);
  }
  if (!rate.success) return json({ error: "上传过于频繁，请稍后重试" }, 429, { "Retry-After": "60" });

  const contentType = String(request.headers.get("content-type") || "");
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (ALLOWED_MIME_TYPES.has(mediaType)) {
    let upload;
    try {
      upload = await prepareImageStream(request, mediaType);
    } catch (error) {
      if (error instanceof UploadValidationError) return json({ error: error.message }, error.status);
      return json({ error: "上传内容读取失败" }, 400);
    }

    const id = crypto.randomUUID();
    const expiresAt = Date.now() + MEDIA_TTL_MS;
    const key = mediaKey(id, expiresAt);
    try {
      await env.MEDIA_BUCKET.put(key, upload.body, {
        httpMetadata: { contentType: upload.mime, cacheControl: "private, no-store" },
      });
    } catch (error) {
      if (error instanceof UploadValidationError) return json({ error: error.message }, error.status);
      console.error("media relay storage failed", error instanceof Error ? error.name : "UnknownError");
      return json({ error: "媒体中转暂时不可用" }, 503);
    }

    const payload = id + "." + expiresAt;
    const token = payload + "." + await sign(payload, signingSecret(env));
    const origin = new URL(request.url).origin;
    return json({
      ok: true,
      url: origin + MEDIA_PATH + "/" + encodeURIComponent(token),
      expiresAt: new Date(expiresAt).toISOString(),
      bytes: upload.byteLength(),
    });
  }

  if (!/^multipart\/form-data\s*;/iu.test(contentType)) {
    return json({ error: "上传格式无效" }, 415);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json({ error: "图片不能超过 4 MiB" }, 413);
  }

  let body;
  try {
    body = await readBoundedBody(request.body, MAX_REQUEST_BYTES);
  } catch {
    return json({ error: "上传内容读取失败" }, 400);
  }
  if (!body) return json({ error: "图片不能超过 4 MiB" }, 413);

  let form;
  try {
    const boundedRequest = new Request(request.url, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
    form = await boundedRequest.formData();
  } catch {
    return json({ error: "上传格式无效" }, 400);
  }

  const files = form.getAll("file");
  const file = files[0];
  if (files.length !== 1 || !file || typeof file.arrayBuffer !== "function" || String(form.get("kind") || "image") !== "image") {
    return json({ error: "当前中转服务只接收一张图片" }, 415);
  }
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES) return json({ error: "图片不能超过 4 MiB" }, 413);

  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return json({ error: "上传内容读取失败" }, 400);
  }
  const mime = detectImageMime(bytes);
  if (!mime) return json({ error: "只支持有效的 JPG、PNG、WebP 或 GIF 图片" }, 415);

  const id = crypto.randomUUID();
  const expiresAt = Date.now() + MEDIA_TTL_MS;
  const key = mediaKey(id, expiresAt);
  try {
    await env.MEDIA_BUCKET.put(key, bytes, {
      httpMetadata: { contentType: mime, cacheControl: "private, no-store" },
    });
  } catch (error) {
    console.error("media relay storage failed", error instanceof Error ? error.name : "UnknownError");
    return json({ error: "媒体中转暂时不可用" }, 503);
  }

  const payload = id + "." + expiresAt;
  const token = payload + "." + await sign(payload, signingSecret(env));
  const origin = new URL(request.url).origin;
  return json({
    ok: true,
    url: origin + MEDIA_PATH + "/" + encodeURIComponent(token),
    expiresAt: new Date(expiresAt).toISOString(),
    bytes: bytes.byteLength,
  });
}

async function handleRead(url, env) {
  if (!env.MEDIA_BUCKET || typeof env.MEDIA_BUCKET.get !== "function" || !signingSecret(env)) {
    return json({ error: "媒体中转服务配置不完整" }, 503);
  }
  let token;
  try {
    token = decodeURIComponent(url.pathname.slice(MEDIA_PATH.length + 1));
  } catch {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const parts = token.split(".");
  if (parts.length !== 3 || !UUID_PATTERN.test(parts[0]) || !/^\d{13}$/u.test(parts[1])) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const expiresAt = Number(parts[1]);
  const payload = parts[0] + "." + parts[1];
  const expected = await sign(payload, signingSecret(env));
  if (!constantTimeEqual(expected, parts[2]) || expiresAt <= Date.now()) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  let media;
  try {
    media = await env.MEDIA_BUCKET.get(mediaKey(parts[0], expiresAt));
  } catch (error) {
    console.error("media relay read failed", error instanceof Error ? error.name : "UnknownError");
    return json({ error: "媒体中转暂时不可用" }, 503);
  }
  if (!media) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const contentType = ALLOWED_MIME_TYPES.has(String(media.httpMetadata?.contentType || ""))
    ? media.httpMetadata.contentType
    : "application/octet-stream";
  return new Response(media.body, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function handleFetch(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/health") {
    const ready = Boolean(
      env.MEDIA_BUCKET
      && typeof env.MEDIA_BUCKET.put === "function"
      && typeof env.MEDIA_BUCKET.get === "function"
      && env.UPLOAD_LIMITER
      && String(env.MEDIA_UPLOADS_ENABLED || "true").toLowerCase() !== "false"
      && signingSecret(env),
    );
    return json({ service: "sanmao-ai-studio", ok: ready, relay: "r2" }, ready ? 200 : 503);
  }
  if (url.pathname === MEDIA_PATH && request.method === "POST") return handleUpload(request, env);
  if (url.pathname.startsWith(MEDIA_PATH + "/") && request.method === "GET") return handleRead(url, env);
  return json({ error: "Not found" }, 404);
}

export async function fetchHandler(request, env) {
  try {
    return await handleFetch(request, env);
  } catch (error) {
    console.error("media relay request failed", error instanceof Error ? error.name : "UnknownError");
    return json({ error: "媒体中转暂时不可用" }, 500);
  }
}

export default {
  fetch: fetchHandler,
};
