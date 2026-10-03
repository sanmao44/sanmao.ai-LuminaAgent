# Migration Status

状态词只使用：`vertical slice completed`、`migration in progress`、`cutover completed`、`legacy removed`。

## Current gates

| Area | Status | Authoritative owner | Remaining legacy and deletion condition |
| --- | --- | --- | --- |
| Storage | cutover completed for server business data | Repository ports and SQLite adapter after marker activation | JSON, IndexedDB, localStorage and filesystem remain adapter or migration inputs; remove after compatibility and rollback callers reach zero |
| Backup / Restore | cutover completed | `lib/backup-application-service.ts`; `client/client.json` contains the single canonical workspace representation | Buffer compatibility APIs and local snapshot callers remain until migrated |
| Database | migration in progress | SQLite is authoritative only after explicit guarded cutover and application restart | Legacy JSON remains migration and rollback input; ordinary rollback is rejected after any post-cutover write |
| Agent | migration in progress | `packages/agent-core` request-context and compact AgentRun seams plus `apps/api/agent-entry.ts` / `agent-stream.ts`; `packages/model-runtime/provider-coordinator.ts` owns provider attempts | Route still owns capability/tool orchestration, semantic planning and execution lifecycle; request context preparation is now a tested application seam |
| Tool / MCP | migration in progress | `packages/tool-runtime` for policy, resolution, dispatch, loop, MCP and Tabbit execution seams | `adapter.ts` remains a compatibility coordinator; artifact/image/skill orchestration and transport approval glue remain |
| Provider | migration in progress | `packages/model-runtime/provider-coordinator.ts` owns candidate ordering, bounded failover and attempt deadlines with injected health port; `apps/api/agent-stream.ts` owns Agent SSE adaptation | Provider HTTP/SDK transport, health persistence and video/media transport branches remain adapters; route still supplies provider calls and image coordination |
| Task | migration in progress | Repository adapters plus `packages/task-runtime` contracts and `apps/worker/task-entry.ts` execution seam | Clone creation, confirmation and resume dispatch plus video/upscale submission and active-task reconciliation cross the Worker boundary; provider polling internals, progress persistence and family-specific wire states remain in service adapters |
| Canvas Document / History / Selection | cutover completed | CanvasCore | UI projection and persistence adapters remain |
| Physical Web/API/Worker split | migration in progress | `apps/api/agent-entry.ts`, `apps/api/agent-stream.ts` and `apps/worker/task-entry.ts` are real seams; Next remains the host | No standalone deployable apps yet; UI and remaining routes stay in the existing application because ownership is not complete enough to deploy independently |
| Observability | migration in progress | `RuntimeObserver` contract with bounded in-process diagnostics and redacted JSONL operational sink (`packages/observability`) | Agent, Tool, MCP, Database, Backup, Provider and video Task boundaries are instrumented; broader task/media coverage and long-term OpenTelemetry export remain |
| Eval | migration in progress | Existing behavior suite plus `tests/architecture-eval.test.mjs` and `tests/part-b-boundaries.test.mjs` | Fixed cross-runtime eval is intentionally small and will grow with each ownership cutover |

## Data cutover safety

- `npm run migrate:database -- --runtime-guard` drains writes, waits for active requests, stages and validates SQLite, activates the marker, and leaves a restart fence. The launcher must restart before writes reopen.
- Repository instances reject a store change detected after initialization. They never silently switch from JSON to SQLite.
- Rollback uses a strict window. It is allowed before a post-cutover write; after a write it fails closed and requires export plus reverse migration.
- SQLite task mutations use one `BEGIN IMMEDIATE` transaction for read, validation, all writes and deletes.

## Backup schema and memory behavior

- Archive format `version` is `2`; domain `schemaVersion` is currently `1`.
- `lib/backup-schema.ts` owns version detection, normalization, migration and current-schema validation. Legacy manifests without a version normalize to v1.
- New archives contain one canonical client representation: `client/client.json -> { workspace }`. The workspace owns gallery, chat sessions and preferences. Legacy top-level fields are import compatibility only.
- Production HTTP archive export, encryption, upload staging, decryption and extraction use disk/stream paths. Compatibility Buffer APIs remain for older local snapshot callers.
- Restore validates the archive, stages all roots, validates staged state, then commits through the rollback transaction. Failed restore rolls back the staged transaction.

## Part B boundary

Part A Data Cutover Closure is implemented and its targeted migration, rollback, backup and transaction tests pass. Part B remains `migration in progress`: API and Worker entry seams now exist for the migrated slices, including a provider-neutral Agent stream adapter; Clone background execution no longer starts from the HTTP route, provider attempt lifecycle and media candidate fallback are shared, and obsolete compatibility bridges were removed. Runtime lifecycle events now reach a redacted, bounded JSONL operational sink and read-only admin endpoint. There are no standalone deployable Web/API/Worker applications yet; the Agent route still owns substantial context, capability and execution orchestration, the Tool adapter remains a migration adapter, Provider and Task ownership are partial, and Legacy purge is only started for bridges with zero callers.

Last reviewed: 2026-10-03.
