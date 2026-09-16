import { isTrustedAppRequest } from "@/lib/auth";
import { beginRuntimeRequest, RuntimeDrainingError } from "@/lib/runtime-operation";
import { encodeDepthVideoFrameSequence } from "@/lib/video-depth-service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: "需要管理员登录。" }, { status: 401 });
  let releaseRuntimeRequest = async () => {};
  try {
    releaseRuntimeRequest = await beginRuntimeRequest("video-depth-encode");
    const form = await request.formData();
    const archive = form.get("archive");
    if (!(archive instanceof File)) return Response.json({ error: "缺少深度帧序列。" }, { status: 400 });
    const output = await encodeDepthVideoFrameSequence(archive, Number(form.get("frameRate")), Number(form.get("frameCount")));
    return new Response(output, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(output.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message, retryable: true }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : "深度视频 MP4 编码失败。" }, { status: 400 });
  } finally {
    await releaseRuntimeRequest();
  }
}
