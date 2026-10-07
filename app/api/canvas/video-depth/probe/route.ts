import { isTrustedAppRequest } from "@/lib/auth";
import { beginRuntimeRequest, RuntimeDrainingError } from "@/lib/runtime-operation";
import { probeDepthVideoFrameRate } from "@/lib/video-depth-service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: "需要管理员登录。" }, { status: 401 });
  let releaseRuntimeRequest = async () => {};
  try {
    releaseRuntimeRequest = await beginRuntimeRequest("video-depth-probe");
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) return Response.json({ error: "缺少原视频文件。" }, { status: 400 });
    return Response.json({ frameRate: await probeDepthVideoFrameRate(file) });
  } catch (error) {
    if (error instanceof RuntimeDrainingError) return Response.json({ error: error.message, retryable: true }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : "读取原视频帧率失败。" }, { status: 400 });
  } finally {
    await releaseRuntimeRequest();
  }
}
