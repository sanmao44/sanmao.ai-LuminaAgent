# SANMAO.AI Final Architecture

Last reviewed: 2026-10-04

Status: **Final Architecture Lock complete.** The architecture migration is
finished. This document describes the architecture that exists in production
code, not a migration plan.

## Deployment model

SANMAO.AI is a **Modular Next Monolith**: one Next host containing the web UI,
HTTP transport, application services and in-process worker dispatch. Web / API /
Worker are logical and physical code boundaries, but not separate deployables.
Splitting a Worker or API process is deferred until a real deployment need
justifies it; it is not an architectural blocker.

## Layers

```text
UI                      app/page.tsx, components/**
        |
        v
HTTP Transport          app/api/**/route.ts, apps/api/*-transport.ts, *-http-contract.ts
        |
        v
Application             apps/api/agent-application.ts, apps/worker/**
        |
        v
Runtime / Core / Ports  packages/contracts, packages/agent-core, packages/canvas-core,
        ^               packages/model-runtime, packages/tool-runtime, packages/task-runtime
        |
Infrastructure          lib/**, packages/observability (JSONL sink)
        |
        v
Persistence / Provider / MCP / Filesystem
```

Dependency direction is one-way: UI to Transport to Application to Runtime/Core
to Ports. Infrastructure adapters implement those ports and are assembled at
composition roots (`apps/api/agent-composition.ts`). Core/runtime must not
depend on React, Next route implementations, provider SDKs, database clients or
filesystem implementations.

## Ownership Matrix

| Domain | Authoritative owner | Public / application boundary | Infrastructure adapter | Compatibility remaining |
| --- | --- | --- | --- | --- |
| Agent | Agent Application (`apps/api/agent-application.ts`) owns planning, execution lifecycle and output | `apps/api/agent-entrypoint.ts`, `app/api/agent/route.ts` | `lib/agent/**` and provider/tool adapters injected through `agent-composition.ts` | Bounded legacy domain helpers called through the composition root; delete each after its injected port has a production caller and behavior coverage |
| Tool / MCP | Tool Runtime (`packages/tool-runtime/runtime.ts`) owns discover, validate, authorize, execute, observe | `ToolRuntime` plus capability ports in `packages/contracts/{tool,skill,mcp,artifact}.ts` | `lib/tools/**`, `lib/mcp/**`, `packages/tool-runtime/*-capability.ts` | `packages/tool-runtime/adapter.ts` is the single compatibility bridge; delete after direct capability registration covers all production callers |
| Provider | Provider Coordinator (`packages/model-runtime/provider-coordinator.ts`) owns candidate ordering, routing, failover, deadlines and attempt lifecycle | `ModelRuntime` port in `packages/contracts/model.ts` | `lib/providers.ts`, `packages/model-runtime/media.ts` | SDK / HTTP / media adapters remain; delete each after its port replaces the legacy call |
| Task / Worker | Worker entry, control and lifecycle (`apps/worker/task-entry.ts`, `task-control.ts`, `clone-task.ts`) own Clone, Video and Upscale execution | Worker boundary imported by task routes | `lib/video-task-service.ts`, `lib/upscale-service.ts`, `lib/clone/**` | Family services and the Clone pipeline remain Worker-only execution/provider/persistence adapters; delete after task ports own the same behavior with rollback coverage |
| Canvas | CanvasCore (`packages/canvas-core/runtime.ts`) owns Document, Selection and History | `document()`, `selection()`, `history()`, `apply()`, `replace()` | `components/SuperCanvas.tsx` is a `useSyncExternalStore` projection plus persistence adapters | UI projection, pointer/gesture, persistence and media calls stay in React; `setDoc`, `replaceDoc` and selection setters are temporary Core action adapters |
| Storage | Repository ports (`packages/contracts/storage.ts`) with server repositories (`lib/repositories/**`) | `lib/repositories/index.ts`, `lib/repositories/server.ts` | `lib/database/sqlite.ts` (SQLite); JSON, IndexedDB and localStorage adapters | Legacy JSON and browser storage are migration/rollback inputs only; delete after zero production callers and a verified rollback path |
| Backup | Backup application service (`lib/backup-application-service.ts`) and the canonical `client/client.json` snapshot | `app/api/backup/archive/route.ts` | `lib/backup-archive.ts`, `lib/backup-crypto.ts`, `lib/backup-restore-transaction.ts` | The legacy v1 importer (`app/api/backup/route.ts`) remains for old archives only; delete after v1 files are out of circulation |
| Observability | `RuntimeObserver` port (`packages/contracts/observability.ts`) | Composition roots inject observers | `packages/observability/runtime-sink.ts` (redacted JSONL) | Lightweight pre-lock baseline; broader export is product hardening, not an ownership blocker |

## Domain call chains

### Agent

`app/api/agent/route.ts` -> `apps/api/agent-transport.ts` (auth and wire parsing)
-> `agent-entrypoint.ts` -> `agent-application.ts` -> Agent Runtime, planning and
capability follow-ups -> application output contract -> JSON/SSE.

### Tool / MCP

Tool Runtime resolves a capability -> capability module -> capability port ->
`lib/tools/**` or `lib/mcp/**` adapter. MCP is an adapter, not an Agent Core type.

### Provider

Application -> composition-provided `ProviderRuntime` -> Provider Coordinator ->
`packages/model-runtime/invocation.ts` (deadline and failover) -> transport
adapter in `lib/providers.ts`. Media capability routing shares
`packages/model-runtime/media.ts`.

### Task / Worker

Task routes (`app/api/video/**`, `app/api/upscale/**`, `app/api/clone/**`) ->
`apps/worker/**` entry/control -> family services (execution adapters) -> Task
Repository. Routes never own task lifecycle transitions.

### Canvas

UI command or Agent Canvas Patch -> CanvasCore `apply`/`replace` -> immutable
document and history commit -> React projection re-renders.

### Storage

Business code -> Repository port -> server repository -> SQLite or a legacy
adapter. `lib/database/sqlite.ts` is the only module that opens SQLite.

### Backup

Archive route -> backup application service -> canonical client snapshot plus
versioned schema -> staged transactional restore.

### Observability

Run ID, model, tool call, latency, error, retry, task state and artifact result
flow through `RuntimeObserver` into the redacted local sink.

## Machine-enforced rules

`tests/architecture-enforcement.test.mjs` enforces six categories:

1. **Dependency** — contracts depend on nothing outside `packages/contracts`;
   core/runtime packages import only modules inside `packages/`.
2. **Runtime infrastructure** — core/runtime never reaches React, Next,
   application, UI or concrete infrastructure; the observability sink is the
   only module under `packages/` allowed to use filesystem APIs.
3. **Route** — HTTP routes never import React/Next/UI; the transport boundary
   never reaches runtime/core; routes never re-absorb tool loop, provider
   routing or task execution ownership; task routes cross the Worker boundary.
4. **Repository** — only `lib/database/**` opens SQLite; application and
   runtime/core never open persistence or browser storage directly; the routes
   that still touch the filesystem are an explicit recorded allowlist.
5. **Legacy** — removed ownership paths cannot be re-imported.
6. **Source-test** — `tests/architecture-source-test-baseline.json` freezes the
   existing historical source-layout tests, so no new ones can be added.

Changing a locked rule means changing the enforcement test first, then the
documentation.

## Compatibility boundary

Every remaining compatibility layer, its users and its deletion condition are
recorded in `docs/next-architecture/migration-status.md`. Work that is
deliberately deferred after the lock is recorded in
`docs/next-architecture/post-lock-improvements.md` and
`docs/regression-backlog.md`.

## Next phase

Product Regression Recovery, Feature Parity Audit and a Regression / Smoke
Baseline. Architecture work is no longer the active workstream.
