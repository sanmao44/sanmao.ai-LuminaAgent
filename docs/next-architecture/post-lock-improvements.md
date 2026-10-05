# Post-Lock Improvements

Last reviewed: 2026-10-05

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

### Frontend complexity refactor checkpoint (2026-10-05)

- Stage 1 is complete: the canvas asset collection picker, asset drawer,
  and shared audio preview now live in `components/canvas/` with the asset
  eligibility and writable-collection rules in `lib/canvas/asset-library.ts`.
- `CanvasWorkspace.tsx` retains CanvasCore state, document mutations, panel
  visibility, and asset action callbacks; it no longer owns the asset panel
  render trees or audio player implementation.
- Stage 1 targeted behavior tests, full test suite, typecheck, and production
  build pass.
- Stage 2 is complete: context menu rendering, keyboard focus behavior, quick
  toolbar placement, action groups, and menu layout calculations now live in
  `components/canvas/CanvasContextMenu.tsx`,
  `components/canvas/CanvasQuickToolbar.tsx`,
  `lib/canvas/menu-labels.ts`, and `lib/canvas/menu-layout.ts`.
- `CanvasWorkspace.tsx` retains action construction and CanvasCore mutations;
  the extracted modules receive explicit targets, action contracts, document
  snapshots, and stage refs. No second selection or document owner was added.
- Stage 2 behavior tests, full test suite, typecheck, and production build are
  required before advancing to viewport/selection work.
- Remaining stages are intentionally deferred until this stage is committed:
  viewport/selection, node presentation, generation boundaries, and page-level
  panels.

### Viewport/selection boundary checkpoint (2026-10-05)

- The next safe seam is the multi-selection toolbar and its alignment/
  distribution controls, but its callbacks are currently interleaved with the
  pointer interaction state machine and CanvasCore selection writes in
  `CanvasWorkspace.tsx`.
- A trial extraction was rolled back before commit. The workspace file uses a
  legacy encoding/line-ending combination; whole-file PowerShell rewrites
  produced invalid TypeScript, so further edits must use encoding-preserving
  patches only.
- Keep the current implementation until a behavior test covers the toolbar,
  marquee selection, and camera interactions together. Do not introduce a
  React viewport store or duplicate selection state.

### Stage 3 selection presentation checkpoint (2026-10-06)

- `CanvasSelectionToolbar.tsx` now owns the multi-selection action bar and the
  alignment/distribution presentation. It receives counts, option contracts,
  and callbacks; it does not read or write CanvasCore state.
- `CanvasWorkspace.tsx` retains selection derivation, CanvasCore mutations,
  history, downloads, grouping, focus, and Agent orchestration.
- Marquee selection, camera transforms, pointer interaction, and node/group
  gesture handling remain in Workspace because their shared interaction state
  is not yet a stable component boundary.
- Stage 3 targeted tests, full test suite, typecheck, and production build
  pass. The next safe seam is viewport coordinate/pointer behavior only after
  dedicated behavior coverage is added.

### Stage 4 node presentation checkpoint (2026-10-06)

- The node layer container now lives in `components/canvas/CanvasNodeLayer.tsx`.
  It receives the visible node list and a render callback, and owns only the
  layer container plus stable node keys.
- `CanvasWorkspace.tsx` still owns CanvasCore document/selection state, node
  mutation callbacks, gesture handling, and the existing `CanvasNodeCard`
  implementation. No node card logic or second state owner was introduced.
- The existing card remains in Workspace for this first stage 4 slice because
  its media playback, editor, reference picker, and generation callbacks are
  tightly coupled. The media playback/retry state is also coupled to the
  card's legacy encoded source and was not moved without a safe, encoding
  preserving edit boundary.
- `CanvasNodeCardContract.ts` now defines the card props once and exports the
  memo comparator. The comparator checks every Workspace callback and editor
  collection, while intentionally ignoring camera-only document replacement.
  Behavior tests cover callback freshness and camera-only stability.
- `useCanvasMediaPlayback.ts` now owns transient video playback, media retry,
  missing/temporary load state, and clip playback settings. It receives only a
  media URL and normalized clip projection; it does not persist CanvasCore
  state or call generation APIs. The card keeps the existing media DOM and
  delegates these events to the hook.
- `CanvasMediaNodeCard.tsx` now owns media node presentation for image, video,
  and audio assets, including playback controls, load error states, asset drag
  affordances, media badges, and natural-size callbacks. Its props carry the
  already-derived status and Workspace callbacks; it does not read CanvasCore,
  repositories, providers, or task services. `CanvasWorkspace.tsx` no longer
  contains the duplicate media markup or playback hook instance.
- `CanvasUpscaleNodeCard.tsx` now owns the upscale node's loading, result, and
  preview presentation. It receives the derived source-connected flag and
  Workspace's natural-size callback; the in-place generation mutation remains
  in Workspace and the card has no API or CanvasCore dependency.
- `CanvasAngleNodeCard.tsx` now owns the angle node's reference/loading/result
  presentation and forwards only the open/cancel actions. Its lifecycle label
  is a pure function in `angle-card-state.ts`, covered independently; angle
  generation, reference lookup, and CanvasCore mutations remain in Workspace.
- `CanvasGeneratorNodeCard.tsx` now owns batch generator presentation: shared
  help, progress, output thumbnails, variant status rows, retry controls, and
  model metadata. Workspace still derives variant state and owns retry,
  preview, document, and generation actions; no generator state store was
  introduced.
- The remaining card body, editor, reference picker, generator and workbench
  branches remain in Workspace until each has a behavior-covered presentation
  boundary.

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
