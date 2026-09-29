# Task Runtime Assessment

## Scope

Phase 4 starts with a provider-neutral lifecycle vocabulary and one executable
read path. The runtime defines the shared states `pending`, `queued`, `running`,
`waiting`, `succeeded`, `failed`, and `cancelled`, plus active/cancel/retry
decisions and legal transitions.

## Real path

Video task list/detail refresh checks and the upscale task deletion guard now
use `TaskRuntime`. Legacy video statuses (`done`) and upscale statuses
(`processing`) are translated by small adapters; API response shapes and task
files remain unchanged.

Agent Progress now uses the same runtime policy to decide whether a snapshot
can still receive progress updates. Its legacy `done` field and snapshot
shape remain unchanged.

## Non-goals

This slice does not move provider polling, retry creation, progress storage,
generation logs, or UI labels. Those responsibilities remain in the existing
services until their behavior has a dedicated runtime contract.
