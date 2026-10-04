# Post-Lock Improvements

Last reviewed: 2026-10-04

This file records work that is deliberately deferred **after** the Final
Architecture Lock. None of these items is an ownership blocker; none of them
requires a new architecture migration phase. Pick them up as normal product or
hardening work when the trigger applies.

## File size and component splits

- `app/page.tsx`, `components/SuperCanvas.tsx`, `components/CanvasAgentDock.tsx`,
  `components/McpManager.tsx`, `components/AngleConsole.tsx`,
  `components/VideoStudio.tsx`, `components/MaskEditor.tsx` and
  `apps/api/agent-application.ts` (about 2,100 lines) remain large.
- They are projection, presentation or application orchestration only; they do
  not own new domain state. Split them opportunistically when a real feature
  touches the file, not as a standalone refactor.
- Trigger: the next feature change that already needs to edit the file.

## Adapter subdivision

- `packages/tool-runtime/adapter.ts` is the single Tool Runtime compatibility
  bridge; remove it once capability registration is direct everywhere.
- `lib/providers.ts`, `lib/video-providers.ts`, `lib/upscale-providers.ts` and
  `packages/model-runtime/media.ts` still mix transport, capability fallback and
  persistence. Split each behind its Provider Runtime port when that port owns
  the same behavior with coverage.
- Worker family services (`lib/video-task-service.ts`,
  `lib/upscale-service.ts`, `lib/clone/**`) remain Worker-only execution
  adapters; replace them once the Worker task port owns polling, retry and
  persistence transitions.
- Trigger: the next Provider or Task feature that would otherwise widen a
  legacy adapter.

## Core cross-package dependency

- `packages/tool-runtime/image-capability.ts` imports
  `packages/model-runtime/media.ts`. Both are runtime/core, so this is not an
  infrastructure violation, but it is a cross-domain import that should become
  a Model invocation port on the Tool Runtime side.
- Trigger: the next change to media capability routing.

## Storage blob adapters

- Artifact, media and storage routes read and write files through `lib/**`
  adapters and, in a few bounded cases, `node:fs` directly. These are blob
  storage paths, not server business-data persistence, and server business data
  is already repository-owned.
- `lib/repositories/task-repository.ts` type-imports `node:sqlite` for its
  adapter signature; SQLite is still only opened by `lib/database/sqlite.ts`.
- Trigger: a storage feature that needs a second blob backend.

## Observability

- The redacted JSONL sink and query endpoint are the operational baseline.
  Broader export (for example OpenTelemetry) is product hardening.
- Trigger: an operational need for external traces, not architecture hygiene.

## Test coverage

- Critical ownership paths have behavior and contract coverage. Coverage for
  compatibility adapters should be added when those adapters are next touched,
  before they are removed.
- Historical source-coupled UI assertions are tracked in
  `docs/regression-backlog.md`. No new source-layout tests may be added; convert
  existing ones to behavior tests when their boundary is next modified.
- Trigger: touching the corresponding boundary or test.

## Registered product regressions

- Product regressions from the architecture migration are tracked in
  `docs/regression-backlog.md` and are restored in the Product Regression
  Recovery phase, not here.

## Non-authoritative compatibility cleanup

- Legacy JSON, IndexedDB, localStorage and filesystem readers, the legacy v1
  backup importer and the remaining migration adapters carry no domain
  ownership. Remove each one when its recorded deletion condition in
  `docs/next-architecture/migration-status.md` is met.
- Trigger: the corresponding caller count reaching zero with a verified
  rollback path, or the next change to that adapter.
