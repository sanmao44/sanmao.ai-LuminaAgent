# SANMAO.AI Migration Plan

Last reviewed: 2026-10-04

## Current phase

Final Pre-Lock construction is complete. Final Architecture Lock is intentionally not started in this phase; it may begin only after all verification gates pass.

## Completed gates

- Canvas Document, History and Selection authority cutover: cutover completed.
- Storage repository boundary: cutover completed for server business data.
- Backup / Restore hardening: cutover completed with staged transactional restore, canonical archive schema and version migration boundary.
- SQLite database cutover: cutover completed. SQLite is authoritative after explicit guarded activation and restart.
- HTTP Agent parsing and serialization boundary: cutover completed. Transport owns Request/Response concerns.
- Agent Application and composition boundary: cutover completed. Application owns planning, execution lifecycle and output; composition owns concrete infrastructure assembly.
- Provider policy boundary: cutover completed. Provider Coordinator owns ordering, routing, failover, deadlines and attempt lifecycle.
- Tool capability boundary: cutover completed. Tool Runtime owns execution; Skill, MCP, Artifact, Image, Browser and Filesystem behavior reaches infrastructure through capability ports.
- Task / Worker boundary: cutover completed. Worker entry/control/lifecycle are authoritative for Clone, Video and Upscale execution, polling, retry, cancel, progress and persistence transitions.

## Compatibility remaining

- The Agent application still calls a bounded set of legacy domain helpers through the composition root; remove each helper after its injected port has a production caller and behavior coverage.
- Provider SDK, HTTP and media transports remain adapters; remove each after the corresponding Provider Runtime port no longer needs the legacy implementation.
- `packages/tool-runtime/adapter.ts` remains the single compatibility bridge for existing Tool Runtime callers; remove it after direct capability registration is complete.
- Worker-only family services and Clone pipeline retain provider-specific polling and persistence mechanics; remove or replace each adapter only after the Worker task port owns the same behavior and rollback coverage is present.
- Legacy JSON and browser/local storage readers remain migration or rollback inputs only; remove them after zero production callers and a verified rollback path.
- No core ownership is left in a second production path. Final Architecture Lock itself remains a separate, not-yet-started action.

## Physical architecture

SANMAO.AI remains a Modular Next Monolith. Web, API and Worker are logical boundaries within the Next host and are not separate deployment units.

## Verification policy

Every migration slice requires targeted behavior tests, typecheck, `npm run check`, build and `git diff --check`. Source-layout-coupled tests must not be added; existing historical tests are converted as their locked boundary is migrated.
