# SANMAO.AI Architecture Plan

Last reviewed: 2026-10-04

## Current deployment model

SANMAO.AI is a Modular Next Monolith. The Next host contains the web UI, HTTP transport, application services and in-process worker dispatch. Logical Web, API and Worker boundaries exist in code, but they are not separate deployables.

## Status

- Storage: cutover completed. Repository ports and SQLite are authoritative for server business data. Legacy JSON remains only for migration, compatibility and rollback.
- Backup / Restore: cutover completed. Restore is staged and transactional. New archives use one canonical client representation and versioned schema migration.
- Database: cutover completed. SQLite is authoritative after guarded activation and restart. Legacy JSON is read-only migration/rollback input; remove it after compatibility and reverse-migration callers reach zero.
- Agent: core cutover completed. The HTTP route is transport only; Agent Application owns planning, execution lifecycle and application output; `agent-composition.ts` owns concrete composition and injects runtime/capability ports. Remove compatibility aliases after all callers use the application and port boundaries.
- Provider: core cutover completed. Provider Coordinator is the only owner of candidate ordering, routing, failover, deadlines and attempt lifecycle. SDK, HTTP and media implementations remain infrastructure adapters and may be deleted after their port implementations replace the underlying legacy calls.
- Tool: core cutover completed. Tool Runtime is the only execution authority and the capability modules depend on ports. `adapter.ts` remains a bounded application-to-capability compatibility bridge until every production caller registers capabilities directly with Tool Runtime.
- Task: core cutover completed. Worker task entry/control/lifecycle are the only task lifecycle authority for Clone, Video and Upscale. Family services and Clone pipeline remain Worker-only execution/provider/persistence adapters; delete their compatibility entry points after those adapters are replaced by task ports.
- Canvas Document / History / Selection: cutover completed. CanvasCore is authoritative.
- Observability: operational pre-lock baseline. Agent, Tool/MCP, Provider, Task, database and backup events use redacted observers and a queryable local sink; secrets, full prompts, arguments and private file contents are excluded.
- Final Architecture Lock: not started.

## Dependency direction

HTTP/UI adapters depend on application contracts. Application and runtime code depend on ports and contracts. Infrastructure implements those ports. Core/runtime must not depend on React, Next route implementations, provider SDKs, database clients or filesystem implementations.

## Physical boundary

The current physical boundary is one Next application with in-process worker dispatch. A separate API or Worker executable is not claimed until ownership and deployment requirements justify it.
