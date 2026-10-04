# Migration Status

鐘舵€佽瘝鍙娇鐢細`vertical slice completed`銆乣migration in progress`銆乣cutover completed`銆乣legacy removed`銆?

## Current gates

| Area | Status | Authoritative owner | Remaining legacy and deletion condition |
| --- | --- | --- | --- |
| Storage | cutover completed | Repository ports and SQLite adapter own server business data after marker activation | JSON, IndexedDB, localStorage and filesystem remain adapter or migration inputs; remove after compatibility and rollback callers reach zero |
| Backup / Restore | cutover completed | `lib/backup-application-service.ts`; `client/client.json` contains the single canonical workspace representation | Buffer compatibility APIs and local snapshot callers remain until migrated |
| Database | cutover completed | SQLite is authoritative after explicit guarded cutover and application restart | Legacy JSON remains migration, compatibility and rollback input; remove only after compatibility and reverse-migration callers reach zero; ordinary rollback is rejected after any post-cutover write |
| Agent | migration in progress | `app/api/agent/route.ts` owns auth/transport only; `apps/api/agent-application.ts` is the application entry, with `packages/agent-core`, `apps/api/agent-entry.ts` and `agent-stream.ts` owning extracted runtime seams | Application entry still coordinates context planning, capability routing and artifact/skill compatibility adapters; delete each adapter after tested port cutover |
| Tool / MCP | migration in progress | `packages/tool-runtime` owns policy, resolution, dispatch, loop, MCP/Tabbit and Web/File/Canvas/Image capability seams | `adapter.ts` remains a bounded compatibility dispatcher for artifact/skill and shared state; delete after those callers move behind tested ports |
| Provider | migration in progress | `packages/model-runtime/provider-coordinator.ts` owns candidate ordering, bounded failover and attempt deadlines with injected health port; `apps/api/agent-stream.ts` owns Agent SSE adaptation | Provider HTTP/SDK transport, health persistence and video/media branches remain adapters; API application still coordinates concrete provider calls and image delivery |
| Task | migration in progress | Repository adapters plus `packages/task-runtime` contracts and `apps/worker/task-entry.ts` plus `task-control.ts`/`task-lifecycle.ts` own execution and control boundaries | Provider polling internals, progress persistence and family-specific wire states remain in video/upscale service adapters; remove those adapters after runtime contracts cover them |
| Canvas Document / History / Selection | cutover completed | CanvasCore | UI projection and persistence adapters remain |
| Physical Web/API/Worker split | migration in progress | `app/api/agent/route.ts` is a transport adapter for `apps/api/agent-application.ts`; `apps/api/agent-entry.ts`, `apps/api/agent-stream.ts` and `apps/worker/task-entry.ts` are real seams; Next remains the host | No standalone deployable apps yet; UI and remaining routes stay in the existing application because execution still shares this process |
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

Part A Data Cutover Closure is implemented and its targeted migration, rollback, backup and transaction tests pass. Part B remains `migration in progress`: API and Worker entry seams now exist for the migrated slices, including a provider-neutral Agent stream adapter; Clone background execution no longer starts from the HTTP route, provider attempt lifecycle and media candidate fallback are shared, and obsolete compatibility bridges were removed. Runtime lifecycle events now reach a redacted, bounded JSONL operational sink and read-only admin endpoint. There are no standalone deployable Web/API/Worker applications yet; the API application entry still owns substantial capability and execution orchestration, the Tool adapter remains a migration adapter, Provider and Task ownership are partial, and Legacy purge is only started for bridges with zero callers.

Last reviewed: 2026-10-03.
