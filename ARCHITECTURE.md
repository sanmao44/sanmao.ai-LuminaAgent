# SANMAO.AI Architecture Plan

Last reviewed: 2026-10-04

## Current deployment model

SANMAO.AI is a Modular Next Monolith. The Next host contains the web UI, HTTP transport, application services and in-process worker dispatch. Logical Web, API and Worker boundaries exist in code, but they are not separate deployables.

## Status

- Storage: cutover completed. Repository ports and SQLite are authoritative for server business data. Legacy JSON remains only for migration, compatibility and rollback.
- Backup / Restore: cutover completed. Restore is staged and transactional. New archives use one canonical client representation and versioned schema migration.
- Database: cutover completed. SQLite is authoritative after guarded activation and restart. Legacy database compatibility removal remains migration in progress.
- Agent: migration in progress. HTTP route is transport only. Application execution consumes the composition root and runtime ports; context, policy and capability adapters remain bounded migration work.
- Provider: migration in progress. Provider coordinator owns candidate ordering, failover, deadlines and attempt lifecycle. SDK and media transports remain adapters.
- Tool: migration in progress. Tool Runtime owns policy, resolution, dispatch and loop execution. The adapter is a bounded compatibility dispatcher for capabilities that have not fully moved to ports.
- Task: migration in progress. Worker task entry/control/lifecycle own migrated task lifecycle seams; family-specific polling and persistence adapters remain.
- Canvas Document / History / Selection: cutover completed. CanvasCore is authoritative.
- Observability: migration in progress. Structured redacted JSONL sink and read-only query endpoint are active.
- Final Architecture Lock: not started.

## Dependency direction

HTTP/UI adapters depend on application contracts. Application and runtime code depend on ports and contracts. Infrastructure implements those ports. Core/runtime must not depend on React, Next route implementations, provider SDKs, database clients or filesystem implementations.

## Physical boundary

The current physical boundary is one Next application with in-process worker dispatch. A separate API or Worker executable is not claimed until ownership and deployment requirements justify it.
