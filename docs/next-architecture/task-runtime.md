# Task Runtime Assessment

## Scope

Phase 4 starts with a provider-neutral lifecycle vocabulary and one executable
read path. The runtime defines the shared states `pending`, `queued`, `running`,
`waiting`, `succeeded`, `failed`, and `cancelled`, plus active/cancel/retry
decisions and legal transitions.

## Real path

Video task list/detail refresh checks and the video/upscale cancel and retry
decisions now use `TaskRuntime`. Legacy video statuses (`done`) and upscale
statuses (`processing`) are translated by small adapters; API response shapes
and task files remain unchanged. Completed-task retry remains an explicit
compatibility rule in each adapter because the legacy service accepted it.

Video generation, cloud-upscale submission, and active-task reconciliation now
cross `apps/worker/task-entry.ts`. The Worker boundary owns the execution
lifecycle event and delegates the current provider/storage implementation to
the existing services. HTTP routes retain authentication, input normalization,
and response adaptation; they no longer call those execution services directly.

Agent Progress now uses the same runtime policy to decide whether a snapshot
can still receive progress updates. Its legacy `done` field and snapshot
shape remain unchanged.

Clone jobs now map their persisted stages through a Clone adapter: execution
stages map to `running`, `planned` maps to `waiting`, and `done` maps to
`succeeded`. The Worker task control owns cancellation and removal, while the
Worker reaper owns stale-job reconciliation; API routes only authenticate, read
current records and adapt responses. Resume eligibility and idempotency-key
reuse use the same boundary while `.data/clone-jobs.json`, API payloads, and
the existing resume behavior remain unchanged. In particular,
failed jobs remain resumable and keep their idempotency key; completed and
cancelled jobs do neither.

## Non-goals

This slice does not move provider polling internals, retry creation, progress
storage, generation logs, or UI labels. Video/upscale terminal removal and
local-save operations now cross Worker task controls; polling, retry creation,
progress persistence and provider-specific wire states remain in the existing
services behind the Worker execution boundary until their behavior has a
dedicated runtime contract. The Worker boundary is therefore a real ownership
seam, while the service implementations remain migration adapters; API routes
no longer mutate Clone lifecycle state directly.

Clone model orchestration, provider polling, artifact persistence, and the
Clone-specific stage vocabulary remain in the legacy pipeline and adapters.
