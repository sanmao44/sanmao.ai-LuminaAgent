# Migration Status

状态词只使用：`vertical slice completed`、`migration in progress`、`cutover completed`、`legacy removed`。

## Current gates

| Area | Status | Authoritative owner | Remaining legacy and deletion condition |
| --- | --- | --- | --- |
| Storage | cutover completed for server business data | Repository ports and SQLite adapter after marker activation | JSON, IndexedDB, localStorage and filesystem remain adapter or migration inputs; remove after compatibility and rollback callers reach zero |
| Backup / Restore | cutover completed | `lib/backup-application-service.ts`; `client/client.json` contains the single canonical workspace representation | Buffer compatibility APIs and local snapshot callers remain until migrated |
| Database | migration in progress | SQLite is authoritative only after explicit guarded cutover and application restart | Legacy JSON remains migration and rollback input; ordinary rollback is rejected after any post-cutover write |
| Agent | migration in progress | `packages/agent-core` plus `apps/api/agent-entry.ts` for the compact non-streaming path | Route still owns streaming, context, provider and capability orchestration |
| Tool / MCP | migration in progress | `packages/tool-runtime` for policy, resolution, dispatch, loop and MCP execution | Compatibility adapter and transport approval glue remain |
| Provider | migration in progress | `packages/model-runtime` contract/adapter for the compact text path | Routing, failover, streaming and media branches remain in legacy paths; provider lifecycle events are bounded at the API boundary |
| Task | migration in progress | Repository adapters plus `packages/task-runtime` contracts | Clone dispatch now crosses `apps/worker/task-entry.ts`; polling and family-specific wire states remain |
| Canvas Document / History / Selection | cutover completed | CanvasCore | UI projection and persistence adapters remain |
| Physical Web/API/Worker split | migration in progress | `apps/api/agent-entry.ts` and `apps/worker/task-entry.ts` are the first real seams; Next remains the host | No standalone deployable apps yet; UI and remaining routes stay in the existing application |
| Observability | migration in progress | `RuntimeObserver` contract and bounded observer | Agent, Tool, MCP, Database, Backup, Provider and video Task boundaries are instrumented; broader task/media coverage remains |
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

Part A Data Cutover Closure is implemented and its targeted migration, rollback, backup and transaction tests pass. Part B remains `migration in progress`: API and Worker entry seams now exist for the migrated slices, but there are no standalone deployable Web/API/Worker applications yet; the Agent route still owns substantial orchestration, the Tool adapter remains a migration adapter, Provider and Task ownership are partial, and Legacy purge has not started.

Last reviewed: 2026-10-03.
