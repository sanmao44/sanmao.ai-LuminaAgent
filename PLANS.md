# SANMAO.AI Migration Plan

Last reviewed: 2026-10-04

## Current phase

Final Pre-Lock Cutover is in progress. Do not start Final Architecture Lock until all verification gates pass.

## Completed gates

- Canvas Document, History and Selection authority cutover: cutover completed.
- Storage repository boundary: cutover completed for server business data.
- Backup / Restore hardening: cutover completed with staged transactional restore, canonical archive schema and version migration boundary.
- SQLite database cutover: cutover completed. SQLite is authoritative after explicit guarded activation and restart.
- HTTP Agent parsing and serialization boundary: cutover completed. Transport owns Request/Response concerns.

## Remaining migration

- Agent Application execution and composition are separated by `apps/api/agent-composition.ts`, while context, policy and capability compatibility adapters remain migration in progress.
- Provider coordinator is authoritative for candidate ordering, failover, deadlines and attempt lifecycle. Provider SDK/media adapters remain migration in progress.
- Tool Runtime owns dispatch and policy. `packages/tool-runtime/adapter.ts` remains a bounded compatibility adapter until remaining artifact/skill/image bindings move to ports.
- Worker task entry/control/lifecycle own migrated Clone, Video and Upscale seams. Family-specific provider polling and persistence remain migration in progress.
- Legacy purge proceeds only when the new owner is authoritative, production paths are switched, behavior coverage exists and rollback is handled.

## Physical architecture

SANMAO.AI remains a Modular Next Monolith. Web, API and Worker are logical boundaries within the Next host and are not separate deployment units.

## Verification policy

Every migration slice requires targeted behavior tests, typecheck, `npm run check`, build and `git diff --check`. Source-layout-coupled tests must not be added; existing historical tests are converted as their locked boundary is migrated.
