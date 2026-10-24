import { isTrustedAppRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL_PREFIX = "onnx-community/depth-anything-v2-small/resolve/main/";
const MIRROR_ORIGIN = "https://hf-mirror.com/";
const UPSTREAM_ATTEMPTS = 4;

function retryDelay(attempt: number) {
  return Math.min(1500, 250 * 2 ** attempt);
}

async function fetchModelFile(url: URL, request: Request) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < UPSTREAM_ATTEMPTS; attempt += 1) {
    try {
      const headers = new Headers({ Accept: "*/*" });
      const range = request.headers.get("range");
      if (range) headers.set("Range", range);
      const upstream = await fetch(url, { cache: "no-store", redirect: "follow", headers });
      if (upstream.ok || upstream.status === 206 || upstream.status === 304) return upstream;
      lastError = new Error(`HTTP ${upstream.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < UPSTREAM_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("模型文件请求失败");
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!isTrustedAppRequest(request)) return new Response("Unauthorized", { status: 401 });
  const path = (await context.params).path.join("/");
  if (!path.startsWith(MODEL_PREFIX) || path.includes("..") || path.includes("\\")) {
    return new Response("Invalid model path", { status: 400 });
  }
  try {
    const upstream = await fetchModelFile(new URL(path, MIRROR_ORIGIN), request);
    if (!upstream.ok) {
      return Response.json({ error: `深度模型文件请求失败：HTTP ${upstream.status}` }, { status: upstream.status });
    }
    const headers = new Headers();
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition", "etag"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(upstream.body, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "深度模型文件请求失败" }, { status: 502 });
  }
}
