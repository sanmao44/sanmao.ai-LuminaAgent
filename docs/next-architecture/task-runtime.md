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

Agent Progress now uses the same runtime policy to decide whether a snapshot
can still receive progress updates. Its legacy `done` field and snapshot
shape remain unchanged.

Clone jobs now map their persisted stages through a Clone adapter: execution
stages map to `running`, `planned` maps to `waiting`, and `done` maps to
`succeeded`. Cancellation, stale-job detection, resume eligibility, and
idempotency-key reuse use this boundary while `.data/clone-jobs.json`, API
payloads, and the existing resume behavior remain unchanged. In particular,
failed jobs remain resumable and keep their idempotency key; completed and
cancelled jobs do neither.

## Non-goals

This slice does not move provider polling, retry creation, progress storage,
generation logs, or UI labels. Those responsibilities remain in the existing
services until their behavior has a dedicated runtime contract.

Clone model orchestration, provider polling, artifact persistence, and the
Clone-specific stage vocabulary remain in the legacy pipeline and adapters.
