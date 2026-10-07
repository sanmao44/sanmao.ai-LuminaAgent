# SANMAO.AI Plan

Last reviewed: 2026-10-04

## Current phase

Architecture Migration: **complete**.

Final Architecture Lock: **complete**.

Architecture is no longer the active workstream. The next work is product
quality, not further architecture migration.

## Current main line

1. Product Regression Recovery
2. Feature Parity Audit
3. Regression / Smoke Baseline
4. Desktop Packaging
5. Normal Product Development

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
- Final Architecture Lock: complete. `tests/architecture-enforcement.test.mjs` machine-enforces the locked dependency direction and ownership boundaries.

## Rules for future work

- New features enter the owning layer described in `ARCHITECTURE.md`; they must
  not add domain ownership to legacy files.
- Remaining compatibility layers, their users and their deletion conditions are
  recorded in `docs/next-architecture/migration-status.md`.
- Deliberately deferred, non-blocking work is recorded in
  `docs/next-architecture/post-lock-improvements.md` and
  `docs/regression-backlog.md`.

## Physical architecture

SANMAO.AI remains a Modular Next Monolith. Web, API and Worker are logical
boundaries inside the Next host and are not separate deployment units.

## Verification policy

Every change requires targeted behavior tests, typecheck, `npm run check`,
build and `git diff --check`. Architecture rules are enforced by
`tests/architecture-enforcement.test.mjs`. Source-layout-coupled tests must not
be added; historical ones are tracked in the regression backlog.