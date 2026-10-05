import type { GenerationLog } from "@/lib/generation-log";

export type GenerationLogListResult = { logs: GenerationLog[] };
export type GenerationLogCleanupResult = { removedLogs?: number; deletedImages?: number; dryRun?: boolean };

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || "\u751f\u6210\u65e5\u5fd7\u8bf7\u6c42\u5931\u8d25");
  return data as T;
}

export async function listGenerationLogs(limit = 200): Promise<GenerationLog[]> {
  const response = await fetch(`/api/generation-logs?limit=${encodeURIComponent(String(limit))}`, { cache: "no-store" });
  const data = await readJson<GenerationLogListResult>(response);
  return Array.isArray(data.logs) ? data.logs : [];
}

export async function cleanupGenerationLogs(days?: number, deleteImages = false): Promise<GenerationLogCleanupResult> {
  const response = await fetch("/api/generation-logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days, deleteImages }),
  });
  return readJson<GenerationLogCleanupResult>(response);
}

export async function previewGenerationLogCleanup(days?: number, deleteImages = false): Promise<GenerationLogCleanupResult> {
  const response = await fetch("/api/generation-logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days, deleteImages, dryRun: true }),
  });
  return readJson<GenerationLogCleanupResult>(response);
}
