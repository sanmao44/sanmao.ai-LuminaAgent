import { isTrustedAppRequest } from "@/lib/auth";
import { readAgentProgress } from "@/lib/agent/progress";

export const runtime = "nodejs";

/**
 * 长任务进度轮询：只回一条快照，不碰业务状态。
 * 查不到（没开始、已过期、id 不合法）就如实回 null，前端自己决定要不要继续问。
 */
export async function GET(request: Request) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: "需要管理员登录。" }, { status: 401 });
  const runId = new URL(request.url).searchParams.get("runId");
  return Response.json({ progress: await readAgentProgress(runId) }, { headers: { "Cache-Control": "no-store" } });
}
