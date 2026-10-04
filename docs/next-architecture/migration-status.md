# Migration Status

Last reviewed: 2026-10-04

| Area | Status | Authoritative owner | Legacy remaining and deletion condition |
| --- | --- | --- | --- |
| Storage | cutover completed | Repository ports and SQLite adapter | JSON, IndexedDB, localStorage and filesystem adapters remain for compatibility or migration; delete after callers reach zero |
| Backup / Restore | cutover completed | Backup application service and canonical `client/client.json` | Buffer/local snapshot compatibility remains until callers migrate |
| Database | cutover completed | SQLite after guarded activation and restart | Legacy JSON is read-only migration/rollback input; remove after compatibility and reverse-migration callers reach zero |
| Agent | cutover completed | Thin HTTP transport, Agent Application and injected composition/runtime ports | Bounded legacy helpers remain behind composition; remove after all callers use the application/port boundary |
| Provider | cutover completed | Provider Coordinator and Model Runtime | SDK, HTTP and media adapters remain; remove after the corresponding provider ports replace their calls |
| Tool / MCP | cutover completed | Tool Runtime and capability ports | `adapter.ts` is the single compatibility bridge; remove after direct capability registration covers all production callers |
| Task / Worker | cutover completed | Worker task entry/control/lifecycle | Video, Upscale and Clone family services remain Worker-only execution/provider/persistence adapters; remove after task ports replace them |
| Canvas | cutover completed | CanvasCore | UI projection and persistence adapters remain |
| Physical boundary | settled | Modular Next Monolith with in-process worker dispatch | Separate Web/API/Worker deployables are intentionally deferred until deployment needs justify them |
| Observability | operational | RuntimeObserver plus redacted JSONL sink and query endpoint | Lightweight pre-lock baseline is sufficient; broader export remains product hardening, not an ownership blocker |
| Eval | operational baseline | Behavior suite and architecture evals | Add coverage with future product changes; current critical ownership paths are covered |

## Data safety

SQLite activation requires write drain, migration, validation and application restart. Repository instances reject silent store changes. Ordinary rollback is rejected after any post-cutover authoritative write. Restore stages and validates before commit.

## Final Architecture Lock

Not started. This checkpoint is the final pre-lock construction phase.
