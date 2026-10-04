# Migration Status

Last reviewed: 2026-10-04

| Area | Status | Authoritative owner | Legacy remaining and deletion condition |
| --- | --- | --- | --- |
| Storage | cutover completed | Repository ports and SQLite adapter | JSON, IndexedDB, localStorage and filesystem adapters remain for compatibility or migration; delete after callers reach zero |
| Backup / Restore | cutover completed | Backup application service and canonical `client/client.json` | Buffer/local snapshot compatibility remains until callers migrate |
| Database | cutover completed | SQLite after guarded activation and restart | Legacy JSON is migration/rollback input; remove after compatibility and reverse migration callers reach zero |
| Agent | migration in progress | HTTP transport plus Agent Application and runtime ports | Context, policy and capability compatibility adapters remain; remove after tested port cutover |
| Provider | migration in progress | Provider coordinator and model runtime | SDK/media adapters remain; remove after provider ports cover production paths |
| Tool / MCP | migration in progress | Tool Runtime and capability ports | `adapter.ts` remains bounded compatibility dispatch; remove each binding after port cutover |
| Task / Worker | migration in progress | Worker task entry/control/lifecycle | Family-specific polling, retry creation and persistence adapters remain |
| Canvas | cutover completed | CanvasCore | UI projection and persistence adapters remain |
| Physical boundary | migration in progress | Modular Next Monolith with in-process worker dispatch | No standalone Web/API/Worker deployables are claimed |
| Observability | migration in progress | RuntimeObserver plus redacted JSONL sink and query endpoint | Broader media/task coverage and long-term export remain |
| Eval | migration in progress | Behavior suite and architecture evals | Expand with each ownership cutover |

## Data safety

SQLite activation requires write drain, migration, validation and application restart. Repository instances reject silent store changes. Ordinary rollback is rejected after any post-cutover authoritative write. Restore stages and validates before commit.

## Final Architecture Lock

Not started. This checkpoint is the final pre-lock construction phase.
