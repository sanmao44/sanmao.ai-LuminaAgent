# Migration Status

Last reviewed: 2026-10-04

Architecture Migration: **complete**. Final Architecture Lock: **complete**.

## Status vocabulary

- **cutover completed** — the new owner is the only authoritative production
  path for that domain.
- **legacy removed** — the superseded legacy path was deleted; no compatibility
  copy of it remains.
- **compatibility only** — legacy code remains, but it carries no domain
  ownership. It is a migration or rollback input with a recorded deletion
  condition, and no new authority may be added to it.

An area is normally `cutover completed`; it may additionally carry
`compatibility only` leftovers. Removed paths are recorded as `legacy removed`
in the compatibility column.

## Domain status

| Area | State | Authoritative owner | Compatibility / legacy remaining and deletion condition |
| --- | --- | --- | --- |
| Storage | cutover completed, compatibility only | Repository ports and the SQLite adapter | Legacy JSON, IndexedDB, localStorage and filesystem adapters are read-only compatibility or migration input; delete after callers reach zero |
| Backup / Restore | cutover completed, compatibility only | Backup application service and canonical `client/client.json` | The legacy v1 importer remains for old archives only; delete after v1 files are out of circulation |
| Database | cutover completed, compatibility only | SQLite; `lib/database/sqlite.ts` is the only opener | Legacy JSON is read-only migration/rollback input; delete after compatibility and reverse-migration callers reach zero |
| Agent | cutover completed, compatibility only | Thin HTTP transport, Agent Application and injected composition/runtime ports | Bounded legacy helpers remain behind composition; delete after every injected port has a production caller and behavior coverage |
| Provider | cutover completed, compatibility only | Provider Coordinator and Model Runtime | SDK, HTTP and media adapters remain; delete after the corresponding ports replace their calls. Former `lib/provider-runtime/chat.ts`, the root `packages/model-runtime.ts` bridge and a zero-caller session wrapper are **legacy removed** |
| Tool / MCP | cutover completed, compatibility only | Tool Runtime and capability ports | `packages/tool-runtime/adapter.ts` is the single compatibility bridge; delete after direct capability registration covers all production callers |
| Task / Worker | cutover completed, compatibility only | Worker task entry, control and lifecycle | Video, Upscale and Clone family services remain Worker-only execution/provider/persistence adapters; delete after task ports replace them |
| Canvas | cutover completed, compatibility only | CanvasCore (Document, Selection, History) plus the Canvas browser persistence adapter | UI projection remains; Canvas documents, project indexes, deletion tombstones and creative-project snapshots are authoritative in the existing `sanmao-ai` IndexedDB `canvas-state` store. localStorage is a one-time migration/rollback input and may be removed only after the IndexedDB transaction commits and a read-back validation succeeds. The old generated-image reference fallback remains read-only and can be removed after active pre-fix documents are migrated or regenerated; delete the temporary Core action adapters after call sites use explicit Canvas commands |
| Observability | cutover completed | `RuntimeObserver` port plus the redacted JSONL sink | No legacy ownership; broader export is product hardening, not an ownership blocker |
| Architecture enforcement | locked | `tests/architecture-enforcement.test.mjs` | Machine-checks contract purity, core dependency direction, transport boundary, worker task boundary and the single SQLite opener |
| Physical boundary | settled | Modular Next Monolith with in-process worker dispatch | Separate Web/API/Worker deployables are intentionally deferred until deployment needs justify them |

Canvas browser storage migration keeps `sanmao.canvas.nova-backup` as the full
rollback snapshot. It may remove only the matching `nova.v1` source index and
documents after both the migration marker and backup validate and the source
values still match the snapshot. Preserve changed, incomplete, or unbacked
legacy values; retire the snapshot only with an explicit recovery path.

The Canvas IndexedDB migration is idempotent and guarded against a concurrent
first writer. Document, project identity, creative-project metadata, active
canvas and deletion tombstones are committed together; a transaction abort or
quota error leaves the last committed projection available. The in-memory
projection is only updated after `oncomplete`, and cross-tab refresh uses a
best-effort `BroadcastChannel`. The adapter's legacy localStorage fallback can
be deleted after all supported browser profiles have completed migration and a
verified Nova/workspace recovery path remains.

## Data safety

SQLite activation requires write drain, migration, validation and application
restart. Repository instances reject silent store changes. Ordinary rollback is
rejected after any post-cutover authoritative write. Restore stages and
validates before commit.

## Final Architecture Lock

Complete. See `ARCHITECTURE.md` for the final layers, ownership matrix, domain
call chains and machine-enforced rules. Non-blocking deferred work is recorded
in `docs/next-architecture/post-lock-improvements.md`.
