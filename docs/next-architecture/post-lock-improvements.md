# Post-Lock Improvements

Last reviewed: 2026-10-06

This file records work that is deliberately deferred **after** the Final
Architecture Lock. None of these items is an ownership blocker; none of them
requires a new architecture migration phase. Pick them up as normal product or
hardening work when the trigger applies.

### Stage 2 canvas Agent action contract checkpoint (2026-10-07)

- `lib/canvas/menu-actions.ts` now owns the pure contract for appending the
  existing Agent action to node/group quick actions and prepending it to node
  context-menu groups.
- `CanvasWorkspace.tsx` keeps the Agent callback, context-menu close behavior,
  action construction, selection, and CanvasCore mutations; it no longer
  duplicates the shared Agent action shape in three assembly sites.
- `CanvasContextMenu.tsx` re-exports the shared menu contract for existing UI
  consumers. No new store, API, type source, or compatibility layer was added.
- Behavior coverage verifies original action order/reference preservation,
  Agent action placement, title, and callback forwarding. Targeted tests,
  typecheck, full `npm test` (1839 passed, 2 skipped), `npm run build`, and
  `git diff --check` passed.
- Remaining risk: node/group action builders and gesture state are still
  interleaved with Workspace selection/document mutations; extracting them
  requires a larger behavior-covered slice and remains deferred.

### Stage 2 canvas group menu projection checkpoint (2026-10-07)

- `projectCanvasGroupContextMenuGroups` in `lib/canvas/menu-actions.ts` now
  owns the pure projection from the existing group quick-action contract to
  context-menu groups, including action order and close-wrapper placement.
- `CanvasWorkspace.tsx` retains context-group presence, menu state cleanup,
  copy selection, arrange command, and all underlying CanvasCore mutations.
- The projection reuses the existing action and menu contracts; no duplicate
  group state, action implementation, or compatibility layer was introduced.
- Focused menu behavior tests and typecheck pass. Full repository validation is
  required before the stage commit.
- Remaining risk: node context-menu action construction still branches on
  media/prompt/generator behavior in Workspace and is deferred until those
  callbacks have a dedicated behavior boundary.

### Stage 2 canvas action icon presentation checkpoint (2026-10-07)

- `components/canvas/CanvasActionIcon.tsx` now owns the existing icon-name to
  SVG/AgentOrb presentation mapping used by context menus and quick toolbars.
- `CanvasContextMenu.tsx` and `CanvasQuickToolbar.tsx` retain only their menu
  and toolbar composition; icon rendering is passed through the explicit
  presentation component.
- All icon names, SVG geometry, Agent orb rendering, and unknown-name fallback
  behavior remain unchanged. No action contract, business callback, state, or
  API behavior changed.
- Focused menu tests and typecheck pass; full repository validation remains
  required before committing this slice.



### Stage 6 canvas deck contract checkpoint (2026-10-07)

- `CanvasDeckProps` now uses the existing `SmartVariantSourceUnit` contract and exposes `onClearSelection` separately from generation mode changes.
- No behavior, persisted data, API, or CanvasCore ownership changed; this only removes a local sentinel mode and an unknown-array prop.
- Focused smart-variant/reference/help tests, `npm run typecheck`, full `npm run check` (1855 passed, 2 skipped, production build success), and `git diff --check` passed.

### Stage 6 canvas generation deck checkpoint (2026-10-07)

- `components/canvas/CanvasDeck.tsx` now owns the existing canvas generation deck presentation: mode switch, selection context, references, prompt editor, run action, variant requirements editor, and creation parameter editor.
- `CanvasWorkspace.tsx` keeps CanvasCore, document/selection/history, file handling, generation API orchestration, prompt/reference mutations, parameter mutations, and smart-variant lifecycle; the deck receives explicit UI state and callbacks only.
- The existing deck root and `deckRef` are preserved through `forwardRef`, so deck measurement, collapsed state, minimap positioning, keyboard shortcuts, drag/drop, paste, and generation actions keep their previous paths.
- Updated the existing variant-help behavior test to include the extracted deck in its behavior-surface source set; no new source-coupled test was introduced.
- Focused canvas tests, `npm run typecheck`, full `npm run check` (1855 passed, 2 skipped, production build success), and `git diff --check` passed.
- Remaining risk: deck internals still combine presentation rows in one component; further splitting should wait for a narrower behavior boundary and should not move smart-variant lifecycle or CanvasCore mutations into child components.

### Stage 5 canvas smart-variant source projection checkpoint (2026-10-07)

- `lib/canvas/smart-variant.ts` now owns the pure projection from a selected
  generator and its directly connected prompt nodes to the existing smart
  variant source contract.
- `CanvasWorkspace.tsx` retains smart-variant request, cancellation, snapshot,
  editor, and document-update orchestration; it only calls the projection for
  current UI inputs.
- Existing edge-kind filtering, source order, prompt fallback fields, and
  empty-source behavior are unchanged. No new type, store, API, or task
  runtime was introduced.
- Focused source-projection behavior tests and typecheck pass. Full repository
  validation passed with 1842 tests passed, 2 skipped, and production build
  success. `git diff --check` passed.

### Stage 5 canvas smart-variant planning boundary checkpoint (2026-10-07)

- `lib/canvas/smart-variant.ts` now owns the pure smart-variant planning prompt,
  JSON extraction, one-to-one source mapping validation, and the bounded wait
  constant.
- `CanvasWorkspace.tsx` retains request, cancellation, snapshot, editor, and
  CanvasCore/document update orchestration; it no longer owns planning data
  types or pure prompt/parse logic.
- Existing source IDs, prompt text, error messages, request timeout, and
  generated variant shape remain unchanged. No new API, store, task runtime,
  compatibility layer, or duplicate contract was introduced.
- Focused smart-variant behavior tests and typecheck passed. Full repository
  validation passed with 1842 tests passed, 2 skipped, and production build
  success. `git diff --check` passed.

### Stage 5 canvas variant batch state projection checkpoint (2026-10-07)

- `lib/canvas/variant-batch.ts` now owns the pure one-index variant state patch
  and aggregate batch-status projection used by generation orchestration.
- `CanvasWorkspace.tsx` retains request sequencing, provider calls, polling,
  result node creation, grouping, notifications, and CanvasCore/document writes;
  it delegates only the immutable state transformation.
- Requirements remain sourced from the existing generator node state, and the
  returned state/status shape is unchanged. No new store, task state machine,
  API, provider path, compatibility layer, or duplicate type was introduced.
- Focused behavior coverage passed with 86 tests, typecheck passed, and full
  repository validation passed with 1844 tests passed, 2 skipped, and
  production build success. `git diff --check` passed.

### Stage 5 canvas variant batch preparation checkpoint (2026-10-07)

- `prepareCanvasVariantBatch` in `lib/canvas/variant-batch.ts` now owns the
  pure selection of all/failed/pending variant indices and the initial state
  reset rules for retry, resume, and fresh batches.
- `CanvasWorkspace.tsx` retains generator lookup, busy guards, notifications,
  batch IDs, provider calls, polling, result placement, grouping, and document
  mutations; it only consumes the prepared request indices and states.
- Existing retry deduplication, pending filtering, result/task retention, and
  fresh-batch reset behavior are unchanged. No new store, task state machine,
  API, provider path, compatibility layer, or duplicate type was introduced.
- Focused behavior coverage passed with 86 tests, typecheck passed, and full
  repository validation passed with 1846 tests passed, 2 skipped, and
  production build success. `git diff --check` passed.

### Stage 5 canvas video task status projection checkpoint (2026-10-07)

- `canvasVideoTaskProgress` in `lib/canvas/variant-batch.ts` now owns the pure
  normalization of a video task result into terminal state, canvas variant
  status, progress, and the first result URL.
- Shared video polling and variant-batch polling retain node/document writes,
  status labels, duration timestamps, retry timers, logs, and CanvasCore
  coordination; they consume the same projection instead of duplicating task
  status branching.
- Provider responses, task URLs, persisted node fields, polling cadence, and
  user-visible behavior remain unchanged. No new task runtime, store, API,
  compatibility layer, or duplicate type was introduced.
- Focused behavior coverage passed with 87 tests, typecheck passed, and full
  repository validation passed with 1847 tests passed, 2 skipped, and
  production build success. `git diff --check` passed.

### Stage 5 canvas variant video node projection checkpoint (2026-10-07)

- `canvasVariantVideoNodeData` in `lib/canvas/variant-batch.ts` now owns the
  pure metadata projection for a submitted variant video task.
- `CanvasWorkspace.tsx` retains node creation, placement, edge creation,
  variant state updates, polling, grouping, and CanvasCore/document writes; it
  passes the existing generation inputs into the projection.
- Existing task IDs, model fallback, progress, status labels, generation
  provenance, reference order, and duration semantics remain unchanged. No new
  task runtime, store, API, compatibility layer, or duplicate type was added.
- Focused behavior coverage passed with 10 tests, typecheck passed, and full
  repository validation passed with 1849 tests passed, 2 skipped, and
  production build success. `git diff --check` passed.

### Stage 6 canvas asset projection boundary checkpoint (2026-10-07)

- `lib/canvas/asset-library.ts` now owns the pure projection from a Canvas media
  or upscale node to the existing `AssetRecord` contract.
- `CanvasWorkspace.tsx` keeps the document projection, asset registration,
  collection mutation, and CanvasCore callbacks, but no longer duplicates the
  node-to-asset field mapping in its drawer and viewer paths.
- No new type, repository, store, API, URL, or persisted data shape was added.
- Behavior coverage verifies generated metadata, project identity, timestamp
  fallback, and rejection of non-media nodes. Focused asset tests passed;
  `npm run check` passed with 1834 tests passed, 2 skipped, and production
  build success. `git diff --check` passed.

### Stage 6 canvas asset collection service checkpoint (2026-10-07)

- `lib/canvas/asset-library-service.ts` now owns the existing-asset lookup,
  collection ID merge, smart-collection rejection, metadata update, and first
  registration flow used by Canvas collection actions.
- `CanvasWorkspace.tsx` keeps only node lookup, asset projection, notification,
  refresh state, and the CanvasCore-facing callbacks. It no longer calls the
  unified asset listing or metadata update APIs for collection writes.
- The service reuses the existing `AssetRecord`, `listUnifiedAssets`,
  `registerCanvasAsset`, and `updateUnifiedAssetMetadata` boundaries; no second
  repository, asset type, or source of truth was introduced.
- Focused asset behavior tests passed; `npm run check` passed with 1835 tests
  passed, 2 skipped, and production build success. `git diff --check` passed.

### Stage 6 canvas asset filtering projection checkpoint (2026-10-07)

- `filterCanvasAssets` in `lib/canvas/asset-library.ts` now owns the pure
  collection, kind, source, favorite, text, tag, recent-window, and sorting
  projection used by the asset drawer.
- `CanvasAssetDrawer.tsx` retains filter state and rendering only; it no longer
  embeds the filtering and ordering implementation in the component body.
- The projection keeps the existing smart collection semantics and uses an
  injectable clock value for deterministic behavior coverage. No asset API,
  record shape, URL, persistence path, or interaction changed.
- Focused asset behavior tests passed; `npm run check` passed with 1836 tests
  passed, 2 skipped, and production build success. `git diff --check` passed.

### Stage 6 canvas asset drawer service boundary checkpoint (2026-10-07)

- `lib/canvas/asset-library-service.ts` now exposes the asset drawer's existing
  collection loading/saving, unified asset loading, metadata update, favorite,
  hide, and tag/collection update operations through one Canvas asset boundary.
- `CanvasAssetDrawer.tsx` retains loading state, optimistic UI state, prompt/
  confirm interactions, notifications, and rendering, but no longer imports
  the unified asset side-effect functions directly.
- The service delegates to the existing `lib/assets` and repository boundary;
  it adds no repository, API, record type, compatibility layer, or second
  source of truth.
- Focused asset behavior tests passed; `npm run check` passed with 1837 tests
  passed, 2 skipped, and production build success. `git diff --check` passed.

### Stage 4 generator node CSS boundary checkpoint (2026-10-06)

- `app/canvas-generator-node.css` now owns the generator node card's scoped
  presentation: accent frame, header, summary, prompt, output gallery, variant
  execution queue, metadata and responsive card polish.
- `app/canvas.css` keeps shared generator primitives, contextual help shared by
  cards and editors, and node-editor/deck variant rules. The stylesheet is
  loaded immediately after `canvas.css` so the existing cascade is preserved.
- The existing variant-help behavior test reads both style files together and
  continues to assert one combined presentation contract.
- Remaining risk: generator execution state and variant editing still cross
  the existing Workspace/Core callbacks; splitting that React ownership needs a
  separate behavior-covered slice.

### Stage 4 variant list CSS boundary checkpoint (2026-10-06)

- `app/canvas-variant-editor.css` now owns the isolated variant requirement
  list editor: rows, inline mention editing surface, add/remove actions and
  footer note.
- `app/canvas.css` keeps the shared variant editor shell plus node editor and
  image-dock positioning rules, because those selectors serve multiple editor
  surfaces.
- The variant-help behavior test now combines the shared, generator-card and
  variant-list styles before asserting the existing visual contract.

### Stage 4 smart variant dialog CSS boundary checkpoint (2026-10-06)

- `app/canvas-smart-variant.css` now owns the smart variant action buttons,
  modal backdrop, planning dialog, source summary, draft grid, loading/error
  states and responsive layout.
- The dialog remains mounted and coordinated by `CanvasWorkspace.tsx`; this
  slice moves presentation only and keeps the existing planning/apply flow,
  pointer isolation and portal behavior unchanged.
- Shared variant editor and generator help styles remain in their domain files
  because they are used by multiple canvas surfaces.

### Stage 4 video editor CSS boundary checkpoint (2026-10-06)

- `app/canvas-video-editor.css` now owns the complete video editor node and
  workbench selector family: node card, preview, inspector, timeline, direct
  manipulation controls, export actions, and responsive overrides.
- `app/canvas.css` keeps only shared canvas/workbench primitives and unrelated
  node styles. `app/layout.tsx` loads the new file immediately after the
  existing video clip domain stylesheet so the cascade remains stable.
- `tests/video-editor-node.test.mjs` reads the shared and video editor styles
  together, preserving the existing behavior and layout assertions without
  creating a second style contract.
- Validation: `npm run typecheck` passed; `npm run check` passed with 1830
  tests passed and 2 skipped; production build passed; `git diff --check`
  passed.
- Remaining risk: the video editor workbench still owns its interaction state
  and export callbacks, so its React implementation remains intentionally
  coupled to the existing task and CanvasCore adapters. Splitting that logic
  needs a separate behavior-covered boundary.

### Stage 4 angle canvas CSS boundary checkpoint (2026-10-06)

- `app/canvas-angle.css` now owns the Canvas-specific angle node card and
  embedded workbench shell, including lifecycle colors, card actions, modal
  framing, and responsive shell overrides.
- The angle console's broader design system remains in `app/globals.css`; only
  selectors whose ownership is the Canvas node/workbench shell moved. The
  existing cascade order is preserved by loading the new file after the video
  editor stylesheet.
- `tests/canvas-node-editor.test.mjs` reads the shared Canvas styles together
  with the angle domain stylesheet, keeping the existing behavior assertions on
  one combined style surface.
- Validation: targeted angle and Canvas node tests (78) passed; `npm run
  typecheck` passed; `npm run check` passed with 1830 tests passed and 2
  skipped; production build passed; `git diff --check` passed.
- Remaining risk: the angle workbench implementation still coordinates its
  draft and CanvasCore callbacks through the existing workspace boundary. Its
  state and generation flow should remain intact until dedicated behavior
  coverage supports a deeper split.

### Stage 5 prompt optimization boundary checkpoint (2026-10-06)

- `lib/creation/agent.ts` is now the single implementation for prompt
  optimization and simple text polishing. It owns prompt task selection,
  reference preparation, Agent request streaming, and empty-result errors.
- `app/page.tsx` keeps only the two page interaction flows: input validation,
  undo snapshots, focus restoration, notifications, and state updates. Its
  duplicate request helper and prompt constant were removed; the existing
  request URL, task names, payload shape, and user-facing flow are unchanged.
- Behavior coverage in `tests/agent-prompt-optimization.test.mjs` executes the
  shared boundary with injected reference preparation and mocked Agent HTTP,
  covering polish/default tasks, payloads, blank input, and empty output.
- Remaining risk: the page still owns Agent lifecycle, image generation, and
  share/browser API orchestration. Those flows cross broader state and should
  remain separate slices with dedicated behavior coverage.

### Stage 5 gallery source label checkpoint (2026-10-06)

- `lib/generation-log-presentation.ts` now owns the pure gallery source label
  projection used by page history cards and the selected-image viewer.
- `app/page.tsx` keeps the gallery rendering and interaction callbacks, but no
  longer defines this repeated source mapping locally. The `ImageCard` contract
  and displayed labels are unchanged.
- Behavior coverage extends `tests/generation-log-presentation.test.mjs` for
  known and fallback sources. No URL, persisted field, or interaction changed.

### Stage 5 Agent attachment boundary checkpoint (2026-10-06)

- `lib/agent/attachment-client.ts` now owns the browser attachment conversion
  used by the page: image/video File reading and optimization, text file
  validation, Office/PDF extraction requests, and `ChatFile` to
  `CreativeReference` projection.
- `app/page.tsx` retains reference/file count limits, optimistic state updates,
  notifications, clipboard routing, and history actions. ID generation remains
  page-owned through an injected `uid` factory, so no second identity source
  was introduced.
- The existing attachment behavior suite now executes the client boundary with
  real File objects and mocked extraction HTTP, covering local text, binary
  extraction, media references, and angle input guards. No API URL, payload,
  persisted file shape, or user flow changed.
- Remaining risk: image compression still depends on browser Canvas APIs and
  is shared with Canvas; moving that infrastructure or page-level attachment
  state would require a separate browser behavior slice.

### Stage 5 gallery history projection checkpoint (2026-10-06)

- `lib/creation/gallery-items.ts` now owns the pure projection from generated
  image inputs and existing gallery metadata to `GalleryItem` records.
- `lib/creation/history.ts` reuses that projection for Canvas persistence, and
  `app/page.tsx` reuses it for page history recording while retaining image
  upload, Repository writes, React state updates, history notifications, and
  local directory persistence in the page owner.
- The projection preserves prompt fallback, per-image model overrides,
  references, compare-reference metadata, masks, annotations, upscale fields,
  angle metadata, and provenance edges. No URL, API payload, persisted field,
  or user interaction changed.
- Behavior coverage: `tests/gallery-items.test.mjs`; `npm run typecheck`,
  `npm test` (1809 passed, 2 skipped), production build, and `npm run check`
  passed.
- Remaining risk: the page still owns upload normalization and history side
  effects; moving those requires an explicit application boundary and should
  not be combined with this pure projection.

### Stage 6 image storage HTTP client checkpoint (2026-10-06)

- `lib/image-storage-client.ts` now owns the browser HTTP boundary for the
  existing `/api/storage/images` endpoint: request serialization, response
  parsing, and valid image-record filtering.
- `app/page.tsx` uses the client for reference persistence, history image
  archival, and history-to-reference caching. It retains the existing fallback
  behavior, user-facing errors, image conversion, and all React/Repository
  side effects.
- No URL, API payload, storage format, or user interaction changed. Canvas
  API adapters remain independent and continue to own their own runtime
  caching behavior.
- Behavior coverage: `tests/image-storage-client.test.mjs`; full validation is
  required before committing this checkpoint.

### Stage 6 image editor transparency checkpoint (2026-10-06)

- `lib/image-editor/transparent-background.ts` now owns the browser adapter that
  loads a generated image, removes near-white pixels through the existing Canvas
  API flow, and returns the same image record with a PNG data URL.
- `app/page.tsx` keeps the generation task orchestration, local-transparent
  fallback, history recording, notifications, and state updates. It no longer
  defines the pixel transformation implementation.
- Behavior coverage in `tests/transparent-background.test.mjs` uses fake Image
  and Canvas adapters to verify cross-origin loading, metadata preservation,
  near-white alpha conversion, and load failures. No API, persisted shape, or
  user interaction changed.
- Remaining risk: `renderLocalImage` and `renderOutpaintWhiteCanvas` still mix
  browser Canvas rendering with page editor state. They should remain separate
  slices until their browser behavior has dedicated coverage.

### Stage 6 local image renderer checkpoint (2026-10-06)

- `lib/image-editor/local-image-renderer.ts` now owns the browser Canvas adapter
  for local crop/canvas rendering: image loading, crop selection, rotation,
  horizontal flip, ratio sizing, and transparent/white/black/blur backgrounds.
- `app/page.tsx` retains local editor state, crop pointer interaction, apply
  callbacks, notifications, and generation/history orchestration. The page no
  longer owns the Canvas rendering implementation.
- Behavior coverage in `tests/local-image-renderer.test.mjs` uses fake Image and
  Canvas adapters to verify crop transforms, output dimensions, and canvas
  background composition. Existing URL, payload, and interaction contracts are
  unchanged.
- Remaining risk: `renderOutpaintWhiteCanvas` remains page-local because its
  layout state and apply flow have not yet received a dedicated browser
  behavior boundary.

### Stage 6 outpaint renderer checkpoint (2026-10-06)

- `lib/image-editor/outpaint-renderer.ts` now owns the browser Canvas adapter
  for white-background outpainting: source loading, canvas sizing, padding
  offsets, smoothing, and PNG export.
- `app/page.tsx` retains outpaint layout calculation, model-rule validation,
  pointer controls, apply callbacks, notifications, and task/history effects.
  No layout source of truth or new state store was introduced.
- Behavior coverage in `tests/outpaint-renderer.test.mjs` verifies white canvas
  composition, exact offsets and dimensions, smoothing configuration, and load
  failures with fake Image and Canvas adapters.
- The local image editor browser adapters are now outside the page. The editor
  UI, pointer state, and apply orchestration remain intentionally page-owned
  until a component boundary has behavior coverage.

### Canvas connection overlay checkpoint (2026-10-06)

- `components/canvas/CanvasConnectionOverlay.tsx` now owns the presentation and
  event forwarding for the connection target highlight, connection cancel or
  edge removal control, and the connected-node picker.
- `CanvasWorkspace.tsx` retains connection state, screen/world coordinate
  derivation, hover timers, CanvasCore mutations, notifications, and new-node
  creation. The overlay receives explicit geometry and callback contracts, so
  it does not become a second connection state owner.
- `app/canvas-connection.css` owns the connection overlay styles. The stage
  z-index contract remains in `app/canvas.css`, and the new stylesheet is
  loaded from `app/layout.tsx` after the base canvas styles.
- Existing connection picker ordering and edge removal behavior tests now read
  the extracted owner. No URL, API payload, document format, or interaction
  contract changed.
- Remaining risk: edge hover and pointer capture state is still interleaved
  with Workspace's broader gesture state machine; moving that state would need
  dedicated behavior coverage and is deferred.

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
  mutation callbacks, gesture handling, and the `CanvasNodeCard` shell. The
  shell coordinates shared ports, selection, editor/workbench mounting, and
  derived props; no second node state owner was introduced.
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
- `CanvasAgentNodeCard.tsx` now owns Agent node presentation, including the
  shared progress indicator, mention editor wiring, response actions, and
  status copy. Workspace still owns prompt/reference derivation and all Agent
  generation or CanvasCore mutations.
- `CanvasAudioNodePanel.tsx` now owns the independent audio node editor
  presentation, player, file input, and duration forwarding. Workspace keeps
  the replacement adapter and CanvasCore metadata mutation as callbacks.
- `CanvasMaskSummary.tsx` now owns the local edit mask summary presentation and
  status copy. The editor still owns mask creation/removal and the CanvasCore
  mutation callbacks remain in Workspace.
- The remaining card shell responsibilities, node editor popover, reference
  picker, and workbench mounting remain in Workspace. They share transient
  interaction state and CanvasCore callbacks, so they need dedicated behavior
  coverage before another extraction is safe.

### Stage 4 completion checkpoint (2026-10-06)

- Media, upscale, angle, generator, Agent, and audio node presentation slices
  are committed independently. `SuperCanvas.tsx` remains a stable re-export
  boundary; no route or mounting contract changed.
- `app/page.tsx` and CSS were audited but not mechanically split. Provider
  management, Agent lifecycle, image editing, browser share rendering, and
  global canvas styling still cross multiple existing contracts. Moving them
  without behavior coverage would risk URL, data, or visual regressions.

### Stage 4 reference mention checkpoint (2026-10-06)

- `CanvasReferenceMentionMenu.tsx` now owns the canvas-specific reference
  candidate menu presentation and forwards the selected candidate index to its
  caller.
- `mention-options.ts` owns the pure conversion from a `CanvasDocument` node
  to the existing `ReferenceMentionOption` contract, including generated media
  previews and stable fallback labels.
- `CanvasWorkspace.tsx` retains mention parsing, reference edge creation,
  selection, and document mutation. The extraction does not add a second
  reference source of truth or change the shared menu contract.
- Mention behavior tests, the full test suite, typecheck, production build,
  and `git diff --check` pass for this slice.

### Stage 4 image preset checkpoint (2026-10-06)

- `CanvasImagePresetControl.tsx` now owns the image preset drawer, custom
  preset form, focus and Escape handling, outside-pointer dismissal, and
  preset list presentation.
- `CanvasImagePresetBadge` owns the active preset summary shown in the node
  editor. Both components use the existing `ImagePreset` and
  `CustomImagePreset` contracts from `lib/creation/image-presets.ts`.
- `CanvasWorkspace.tsx` retains preset selection state, prompt normalization,
  generation option construction, notifications, and persistence callbacks.
  The control never writes localStorage or mutates CanvasCore directly.
- The existing canvas editor behavior test now covers the extracted control
  boundary while keeping Workspace generation and callback assertions.

### Stage 4 image preset domain checkpoint (2026-10-06)

- `lib/creation/image-presets.ts` now owns preset prompt composition and the
  visible prompt projection used by generation and editor drafts.
- `lib/canvas/image-presets.ts` owns the pure node capability predicate used
  to decide whether a node can expose image presets.
- `CanvasWorkspace.tsx` keeps the same call sites and generation orchestration,
  but no longer defines these pure domain transformations locally.
- The canvas editor behavior suite, full test suite, typecheck, production
  build, and staged diff check pass for this boundary.

### Stage 4 upscale settings checkpoint (2026-10-06)

- `CanvasUpscaleSettingsPanel.tsx` now owns upscale model selection, provider
  capability presentation, source/target dimension readout, cloud output
  controls, and source image dimension loading.
- The panel receives `CanvasUpscaleParams`, `CanvasRuntimeState`, an optional
  source URL, and one `onChange` callback. It has no CanvasCore, repository,
  filesystem, or provider SDK dependency.
- `CanvasWorkspace.tsx` retains the upscale task mutation and passes the
  existing `CANVAS_Z_INDEX` value through the explicit prop contract.
- Upscale editor behavior tests, the full test suite, typecheck, production
  build, and staged diff check pass for this boundary.

### Stage 4 reference list checkpoint (2026-10-06)

- `CanvasReferenceList.tsx` now owns reference thumbnail rendering, text/video
  previews, drag reorder affordances, remove controls, and list actions.
- The component derives its display projection from `CanvasDocument` and the
  existing `isCanvasMentionableNode`/`isCanvasReferenceableNode` model rules;
  it only emits preview, reorder, add, paste, remove, and clear callbacks.
- `CanvasWorkspace.tsx` retains all edge and document mutations. No reference
  store or duplicate source of truth was introduced.

### Stage 6 page panel checkpoint (2026-10-06)

- `ManualModelDialog.tsx` now owns the manual provider-model registration
  dialog: field rendering, model-kind selection, explanatory notice, close
  controls, and the busy submit presentation.
- The dialog receives the provider name, controlled form projection, busy flag,
  icon renderer, and explicit change/close/submit callbacks. It does not call
  provider APIs, repositories, or navigation itself.
- `app/page.tsx` retains the manual-model state, request to
  `/api/providers/:id/models`, returned-state application, model filtering,
  navigation, notifications, and the surrounding Provider management panel.
- Behavior coverage renders the extracted component through the repository's
  TypeScript test loader and verifies the controlled values, active kind,
  close-safe backdrop, and busy submit state. The full suite, typecheck, and
  production build pass for this slice.
- Provider editor fields, Jimeng login, and the Agent/image/video panels remain
  in `app/page.tsx`; they combine API orchestration and cross-panel state and
  need a dedicated behavior seam before extraction.

### Stage 6 local image layout checkpoint (2026-10-06)

- `lib/image-editor/local-image-layout.ts` now owns the pure ratio projection
  used by the page-local crop and canvas editor. It preserves the existing
  Chinese `原图` / `自由` labels while delegating crop geometry and canvas
  expansion to `lib/canvas/image-operations.ts`.
- `app/page.tsx` no longer defines duplicate `cropSourceRect` or
  `canvasRectForRatio` implementations. Browser image loading, Canvas 2D
  rendering, blob/data URL handling, and editor state remain in the page because
  those concerns are still coupled to the local editor interaction contract.
- `tests/local-image-layout.test.mjs` covers original/free behavior, crop
  bounds, and canvas ratio expansion. Targeted tests, the full suite,
  typecheck, production build, and diff check pass for this slice.

### Stage 6 provider presentation checkpoint (2026-10-06)

- `lib/provider-presentation.ts` now owns the Provider/Model presentation
  labels and manual-model capability predicate previously defined in
  `app/page.tsx`. It reuses `lib/types.ts` and `getProviderPreset` and has no
  API, storage, or UI dependencies.
- `app/page.tsx` retains Provider form state, API calls, model filtering, and
  the Provider panel composition; it now consumes explicit presentation
  functions. Gallery `sourceLabel` and reference ordering remain at their
  existing boundaries because they belong to separate image and reference
  contracts.
- `tests/provider-presentation.test.mjs` covers the labels, preset fallback,
  and manual-model capability. The targeted tests, full suite, typecheck,
  production build, and diff check pass for this slice.

### Stage 6 creative reference ordering checkpoint (2026-10-06)

- `reorderCreativeReferences` now lives with the existing creative reference
  normalization and mention contracts in `lib/creative-references.ts`.
- `app/page.tsx` no longer owns a duplicate array reordering helper; it keeps
  Agent and Generate reference state and passes the domain operation to the
  existing `CreativeReferenceStrip` callbacks. Canvas draft ordering remains in
  `lib/canvas/reuse.ts` and is intentionally unchanged.
- `tests/creative-reference-ordering.test.mjs` covers invalid moves, immutable valid
  moves, and order preservation. The full suite, typecheck, production build,
  and diff check pass for this slice.

### Stage 6 upscale dimension projection checkpoint (2026-10-06)

- `lib/canvas/upscale.ts` now owns `upscaleTargetDimensions`, the shared target
  size projection for Cloud and SeedVR upscale models.
- `app/page.tsx` and `CanvasUpscaleSettingsPanel.tsx` no longer duplicate the
  Cloud multiplication and SeedVR target-size branches. Page state, task
  submission, provider selection, and panel callbacks remain unchanged.
- `tests/upscale-dimensions.test.mjs` covers Cloud, SeedVR target, and auto
  projections. The full suite, typecheck, production build, and diff check pass
  for this slice.

### Stage 6 admin login checkpoint (2026-10-06)

- `AdminLogin.tsx` now owns the protected management login presentation for the
  Providers and Models sections: password field, explanatory copy, icon,
  disabled submit state, and busy label.
- The component receives controlled password/busy values plus explicit change
  and submit callbacks. Authentication requests, admin session refresh,
  notifications, and section access remain in `app/page.tsx`.
- Behavior tests render the component through the shared TypeScript loader;
  the full suite, typecheck, and production build pass for this slice.

### Stage 6 confirmation dialog checkpoint (2026-10-06)

- `ConfirmDialog.tsx` now owns the reusable confirmation surface, including
  danger/neutral icon treatment, title and copy, cancel behavior, and confirm
  button presentation.
- The component receives a single confirmation state projection, an icon
  renderer, and explicit close/confirm callbacks. Business actions are still
  created and executed by `app/page.tsx`, so the dialog is not an action or
  state owner.
- Behavior coverage verifies danger and neutral rendering through the shared
  TypeScript loader. Existing provider confirmation behavior remains at the
  page boundary.

### Stage 6 support modal checkpoint (2026-10-06)

- `SupportModal.tsx` now owns the community/support presentation: tab
  navigation, QQ group information and copy affordance, reward QR panel, and
  modal close behavior.
- The component receives the active tab, icon renderer, tab/close/copy
  callbacks, and does not access the clipboard, notifications, storage, or
  browser APIs directly.
- `app/page.tsx` retains the support visibility/tab state and clipboard
  adapters so existing notification text and user flow remain unchanged.
- Behavior coverage renders both tabs through the shared TypeScript loader;
  full test, typecheck, and production build verification is required before
  the next page panel slice.

### Stage 6 share preview checkpoint (2026-10-06)

- `SharePreviewModal.tsx` now owns the generated conversation PNG preview
  presentation: preview image, dimensions, close/continue-edit controls, and
  download action.
- The component receives the already-created preview projection, icon renderer,
  close callback, and download callback. It does not create the canvas image,
  manage Blob URLs, call browser download APIs, or issue notifications.
- `app/page.tsx` retains share layout generation, Blob URL cleanup, download
  anchor creation, and user feedback. Existing share image and conversation
  layout modules remain the only data transformation owners.
- Behavior coverage renders the modal through the shared TypeScript loader and
  the existing share layout/selection tests remain green.

### Stage 6 message reference preview checkpoint (2026-10-06)

- `MessageReferencePreviewModal.tsx` now owns the message reference preview
  presentation for image, video, and text references, including close actions
  and the existing full-size/no-crop footer hint.
- The component receives a normalized preview projection, the shared icon
  renderer, and an explicit close callback. It does not resolve reference URLs,
  own preview state, install keyboard listeners, or access browser APIs.
- `app/page.tsx` retains message preview state, Escape handling, body scroll
  locking, Portal mounting, and `creativeReferenceUrl` conversion. The existing
  composer reference preview remains in its owning composer component and is
  intentionally unchanged.
- `ChatFilePreviewDialog` is intentionally handled in the next checkpoint;
  this checkpoint only moves the pure conversion and eligibility helpers.
- Behavior coverage renders image, video, and text variants through the shared
  TypeScript loader; targeted architecture and share tests remain green.

### Stage 6 chat file preview domain helpers checkpoint (2026-10-06)

- `lib/chat-file-preview.ts` now owns preview eligibility, artifact kind labels,
  base64 text decoding, reduced-motion HTML bootstrap, file size formatting, and
  attachment type labels for chat files.
- `app/page.tsx` keeps file download, artifact preview requests, Blob URL
  lifecycle, iframe sandbox presentation, preview state, and callbacks. It uses
  the domain helpers as the only implementation for the pure conversions.
- The browser Blob lifecycle and sandbox behavior are handled by the following
  `ChatFilePreviewDialog` checkpoint; this helper module remains framework free.
- Existing file preview tests now exercise the helper behavior directly and
  retain behavior coverage for the page-owned dialog/download path.

### Stage 6 chat file preview dialog checkpoint (2026-10-06)

- `ChatFilePreviewDialog.tsx` now owns the HTML/artifact preview presentation,
  iframe sandbox attributes, close controls, and Blob URL creation/revocation.
- The component receives the prepared file projection, shared icon renderer,
  and close callback. It does not fetch artifacts, download files, resolve
  preview content, own Escape handling, or manage page scroll locking.
- `app/page.tsx` retains artifact fetch/normalization, preview state, Portal
  mounting, Escape handling, download behavior, and notifications.
- Behavior tests render the extracted dialog and retain page-owned download and
  close-path checks; no URL, API, or file format behavior changed.

### Stage 6 compare viewer checkpoint (2026-10-06)

- `CompareViewer.tsx` now owns historical image comparison presentation and
  transient viewer interaction: slider/side-by-side mode, zoom, pan, image
  measurement, divider keyboard controls, and close affordances.
- The component receives the current `GalleryItem`, an optional comparison
  source projection, the parent item, shared icon renderer, and close callback.
  It does not load history, mutate gallery state, persist files, or call APIs.
- `app/page.tsx` retains comparison-source derivation, viewed-item bookkeeping,
  compare state, body-scroll coordination, and Portal composition.
- Behavior tests cover current/parent rendering, reference labeling, mode and
  zoom controls. Provider, image-edit, and share workflows remain unchanged.

### Stage 6 assistant code block checkpoint (2026-10-06)

- `AssistantCodeBlock.tsx` now owns code block presentation: lightweight token
  highlighting, line numbers, language-aware download naming, copy/run actions,
  and expand/collapse state.
- The component receives code, language, the shared icon renderer, and an
  explicit notification callback. Clipboard, Blob, download, and preview-window
  effects remain local to the presentation boundary; no Agent or provider state
  is introduced.
- `app/page.tsx` retains Markdown fence parsing, direction insertion, message
  lifecycle, and notification ownership, passing `Icon` and `onNotify` into the
  component.
- Behavior tests render typed and executable code variants. Existing Agent
  routing and message behavior remain unchanged.

### Stage 6 assistant markdown checkpoint (2026-10-06)

- `AssistantMarkdown.tsx` now owns assistant response presentation: inline
  markdown, headings, lists, quotes, fenced code block composition, direction
  suggestion placement, and long-response collapse state.
- It receives message content, the shared icon renderer, notification callback,
  and an optional direction picker contract. It does not own Agent requests,
  message persistence, retry state, or image generation.
- `app/page.tsx` retains message selection, continuation callbacks, Agent busy
  state, and direction extraction; it passes those values through explicit
  props. The existing `lib/agent-web.ts` remains the direction extraction owner.
- Behavior tests cover markdown structure, code composition, and direction
  action rendering.

### Stage 6 agent image loading card checkpoint (2026-10-06)

- `AgentImageLoadingCard.tsx` now owns the image-generation waiting card
  presentation: primary stage copy, secondary activity details, live status
  semantics, scan effect, and skeleton layout.
- The component receives only the existing activity projection. It does not
  decide whether a message is in image flow, mutate Agent messages, poll work,
  or invoke generation APIs.
- `app/page.tsx` retains `showAgentImageLoadingCard`, imageFlow lifecycle flags,
  retry behavior, and the input status bar projection. The same activity object
  continues to feed the card, so no second task state owner was introduced.
- Existing progress and intent behavior tests plus direct card rendering cover
  the extracted boundary.

### Stage 6 assistant markdown ownership checkpoint (2026-10-06)

- Removed the stale inline `AgentDirectionPicker` and `AssistantMarkdown`
  implementations from `app/page.tsx`. The page now uses the committed
  `components/AssistantMarkdown.tsx` implementation as the only markdown and
  follow-up direction presentation path.
- `app/page.tsx` retains direction extraction, busy/selection guards, and the
  continuation callbacks. `AssistantMarkdown` receives the existing
  `directionPicker` projection and does not own Agent state or message
  mutations.
- Behavior coverage renders both image follow-up directions and the existing
  markdown/code path through the component boundary. No URL, API, or message
  format changed.

### Stage 6 creative reference strip checkpoint (2026-10-06)

- `CreativeReferenceStrip.tsx` now owns the shared creative reference
  presentation: file input, thumbnail rendering, drag reorder affordances,
  preview portal, Escape handling, and body scroll locking.
- `app/page.tsx` retains the single `CreativeReference` state, file loading and
  normalization, add/remove/reorder/clear mutations, local upscale toggle, and
  paste behavior. The component receives explicit callbacks and never calls an
  API, repository, or provider.
- Existing image, video, text, document labels and accepted file formats remain
  unchanged. Reference planning still uses `lib/creative-references.ts` as the
  only data conversion boundary.

### Stage 6 chat file list boundary checkpoint (2026-10-06)

- Removed the page-local `ChatFileList` forwarding wrapper. Both conversation
  messages and the composer now render the existing `AgentChatFileList`
  component directly with explicit presentation and page-owned operation
  callbacks.
- File preview eligibility, labels, and size formatting continue to come from
  `lib/chat-file-preview.ts`; download, preview, remove, and notification
  behavior remain in `app/page.tsx`.

### Stage 6 image card presentation checkpoint (2026-10-06)

- `components/ImageCard.tsx` now owns historical image card presentation,
  transient image loading/retry state, reference thumbnails, menu visibility,
  and action button rendering.
- `app/page.tsx` retains gallery/message item selection, comparison derivation,
  history mutations, download/edit/upscale/reuse/favorite/delete behavior, and
  the angle/outpaint workflows. All four existing render sites pass explicit
  callbacks and the shared `GalleryItem` projection.
- The card no longer dispatches `sanmao-angle` or `sanmao-outpaint` custom
  events; those actions use direct callbacks while preserving the same page
  workflows and URLs.
- Direct component behavior covers metadata, references, action presentation,
  and selection state. Complex editor and provider flows remain page-owned.

### Stage 6 outpaint layout domain checkpoint (2026-10-06)

- `lib/image-editor/outpaint-layout.ts` now owns the pure outpaint layout
  projection, default padding, provider model rules, validation messages, and
  bounds fitting.
- `app/page.tsx` keeps `OutpaintEditor` rendering, pointer/zoom state, local
  image operations, submission callbacks, and editor visibility. It imports
  the pure functions without creating a second editor state or API boundary.
- Behavior tests cover centering, model limits, validation, and fitting. The
  complex image editor UI remains intentionally in the page until its local
  editing behavior has a dedicated component boundary.

### Editor modal boundary audit (2026-10-06)

- `EditorModal` remains in `app/page.tsx` after a boundary audit. Its fields
  are controlled by the page editor state and combine edit/upscale model
  capabilities, mask handoff, provider navigation, and submit validation.
- The shared quality, upscale scale, cloud output format, and cloud-model
  predicates now live in `lib/image-editor/editor-options.ts`; the page and
  future editor component use the same option source.
- A direct component move was intentionally not committed because the current
  source is compiled JSX output with an implicit page `Icon`/`Dropdown` scope;
  moving it mechanically would create duplicate UI contracts or risk changing
  controlled field behavior. A behavior-covered TSX boundary is still needed.

### Editor form projection checkpoint (2026-10-06)

- `lib/image-editor/editor-form.ts` now owns the pure model-selection
  projection used by the edit/upscale modal. It keeps the selected upscale
  scale and output format valid while preserving the existing fallback order.
- `app/page.tsx` still owns editor state, controlled rendering, provider
  navigation, mask handoff, API calls, and task lifecycle. The modal UI and
  its callbacks were not moved in this slice because the source remains
  compiled JSX with implicit page-local presentation helpers.
- `tests/image-editor-form.test.mjs` covers edit selection, supported upscale
  values, and fallback behavior for limited or unavailable models.

### Editor request projection checkpoint (2026-10-06)

- `lib/image-editor/editor-request.ts` now owns the pure edit/upscale request
  projection: endpoint, reference metadata, dimensions, cloud output fields,
  and local upscale parameters.
- `app/page.tsx` still owns image dimension loading, fetch and response
  handling, upscale polling, task lifecycle, history persistence, and user
  notifications. No API route or payload shape changed.
- `tests/image-editor-request.test.mjs` covers edit payloads, cloud upscale
  output filtering, and local upscale target/algorithm fields.

### Editor task draft projection checkpoint (2026-10-06)

- `lib/image-editor/editor-task.ts` now owns the pure projection from the
  page editor state into the existing `generateTasks` pending-task shape,
  including retry fields, references, mask metadata, and feather bounds.
- `app/page.tsx` keeps task insertion, editor closing, notification, and the
  asynchronous processing lifecycle. The persisted task shape and recovery
  fields remain unchanged.
- `tests/image-editor-task.test.mjs` covers edit mask/move-guide drafts and
  upscale source/task fields.

### Editor result projection checkpoint (2026-10-06)

- `lib/image-editor/editor-result.ts` now owns the pure projection for model
  preference recording, history metadata, and completion summaries after an
  edit/upscale response.
- `app/page.tsx` keeps response validation, task polling, `recordModelCall`,
  `recordImages`, task status updates, and notifications. Storage and runtime
  ownership remain unchanged.
- `tests/image-editor-result.test.mjs` covers manual edit model parameters,
  mask/reference history metadata, and cloud upscale format/quality fields.

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

### Stage 4 node editor boundary checkpoint (2026-10-06)

- Moved the complete `CanvasNodeEditorPopover` implementation and its explicit props contract into `components/canvas/CanvasNodeEditorPopover.tsx`. The component owns editor-local prompt, preset, dock, resize, Escape and positioning state; Workspace continues to own CanvasCore mutations, generation, reference and persistence callbacks.
- Added `lib/canvas/node-editor.ts` for the shared variant requirement and in-place video reference projections used by both the editor and Workspace. No second store, repository, task state machine or provider boundary was introduced.
- Updated the existing node editor, prompt optimization, Agent dock, reference picker and variant-help behavior tests to include the extracted component source while preserving behavior assertions.
- `CanvasWorkspace.tsx` is reduced by 959 lines; remaining responsibilities include CanvasCore coordination, generation orchestration, node cards, workbench mounting and high-coupling pointer state. CSS remains in existing domain files to avoid visual regressions.
- Validation: targeted Canvas/editor tests 71 passed; full `npm test` 1777 passed; `npm run typecheck` passed; `npm run build` passed; `git diff --check` reports only the pre-existing user edit's trailing blank line in `AGENTS.md`.
- Remaining risk: editor internals still combine prompt optimization, browser event lifecycles and parameter/reference panels. Further subdivision should wait for a behavior-covered boundary rather than introduce wrappers or duplicate state.

### Stage 4 node card boundary checkpoint (2026-10-06)

- `CanvasNodeCard.tsx` now owns the node card presentation boundary: node-type
  rendering, connection ports, resize and pointer event forwarding, Agent
  prompt paste forwarding, and the memoized card comparator contract. It does
  not own CanvasCore mutations, generation/task orchestration, persistence, or
  provider access.
- `lib/canvas/node-card.ts` owns the card display projections for mask state,
  upscale source, status, progress, and generator variant requirements/states.
  Workspace and the card use these projections as the single implementation.
- `CanvasWorkspace.tsx` mounts the card layer and keeps document, selection,
  command, generation, reference, and persistence ownership. The extracted
  card removed roughly 540 lines from Workspace; current sizes are about
  16,285 lines for Workspace and 412 lines for the card (the repository uses
  generated/encoded UI text, so line counts are informational).
- Existing boundary tests now include the new card source and validate callback
  invalidation, camera-only document replacement, reference picking, double
  click routing, node editor behavior, and variant help. The removed
  `false && expanded` dead editor branch was not restored because it was never
  rendered and its behavior is covered by the live editor component.
- Validation: targeted Canvas/editor tests 76 passed; `npm run typecheck`,
  `npm test` (1775 passed, 2 skipped, 0 failed), `npm run build`, and
  `npm run check` all passed. `AGENTS.md` remains an unrelated user
  modification and is intentionally not part of the stage. `git diff --check`
  reports only that pre-existing EOF blank line and a line-ending warning for
  one modified test file.
- Remaining risk: Workspace still combines CanvasCore coordination, pointer
  state, edges/groups, menus, workbench mounting, and generation orchestration.
  Viewport, menu, and generation extraction should wait for a stable
  behavior-covered contract.

### Stage 5 reference input projection checkpoint (2026-10-06)

- `lib/canvas/reference-drafts.ts` now owns the pure conversion from a
  `CanvasNode` to the existing `CanvasReferenceDraft` contract and to the
  history reference record projection. It handles prompt, generator, media,
  upscale, and audio node semantics in one implementation.
- The converter receives the existing `isCanvasReferenceableNode` predicate as
  an explicit contract, so it does not recreate node eligibility or introduce
  another source of truth. It has no React, CanvasCore, API, repository, or
  provider dependency.
- `CanvasWorkspace.tsx` retains all reference selection, draft mutation,
  generation orchestration, and persistence callbacks; it only invokes the
  converter at those existing call sites. No URL, API payload, or history
  record shape changed.
- Behavior coverage now verifies prompt/generator/media/audio conversion,
  metadata preservation, duplicate filtering, and audio exclusion from history
  records.
- Remaining risk: generation submission and task lifecycle still span several
  callbacks in Workspace. Extracting those paths requires a request/response
  contract and task-state coverage before moving implementation.

### Stage 5 video input validation checkpoint (2026-10-06)

- `lib/canvas/video-input-validation.ts` now owns the pure validation rules for
  text, first-frame, first/last-frame, and reference video modes, including
  model image/video limits and operation-specific restrictions.
- The function consumes the existing `CanvasVideoInputs` projection and
  `VideoModelLimits`; it does not resolve inputs, mutate CanvasCore state, call
  providers, or choose how errors are displayed. Workspace keeps invocation,
  request construction, and task orchestration.
- Existing user-facing messages and validation order are unchanged. Behavior
  tests cover missing slots, text-mode conflicts, unsupported reference video,
  and the non-mutating contract.
- Remaining risk: generation submission still combines request normalization,
  API invocation, polling, and document updates. It needs a complete
  request/result contract before a safe extraction.

### Stage 5 generation parameter boundary checkpoint (2026-10-06)

- `lib/canvas/generation-params.ts` now owns the pure canvas boundary for
  reading shared generation defaults and copying/normalizing existing image,
  video, and Agent parameters. It delegates to the existing creation settings
  source of truth and the existing canvas deep-clone implementation.
- `CanvasWorkspace.tsx` no longer defines `defaultParams` or `copyParams`; all
  existing call sites use the extracted functions. API calls, provider
  selection, task orchestration, CanvasCore mutation, and persistence remain in
  Workspace.
- Behavior coverage verifies shared-default delegation, deep-copy isolation,
  normalization delegation, and fallback behavior for invalid input. No URL,
  API payload, persisted shape, or user interaction changed.
- Validation: targeted generation parameter tests and `npm run typecheck`
  passed. Full `npm test`, `npm run build`, and `npm run check` remain required
  before committing this checkpoint.
- Remaining risk: generation submission still combines request normalization,
  API invocation, polling, and document updates. `generationKey` remains in
  Workspace because it is coupled to deck source and UI lifecycle state.

### Stage 5 video capability projection checkpoint (2026-10-06)

- `lib/canvas/video-capabilities.ts` now owns the pure projection from the
  existing selected video model to the existing canvas input capability
  contract. It delegates model resolution to `resolveAvailableCreationModel`
  and preserves the prior fallback semantics when no model is available.
- `CanvasWorkspace.tsx` no longer defines this projection; all existing
  connection and submission call sites use the extracted function. Provider
  selection, video input mode decisions, task orchestration, and CanvasCore
  mutation remain in Workspace.
- Behavior coverage verifies full capabilities, missing optional capabilities,
  and unavailable-model fallback. No URL, API payload, persisted shape, or
  user interaction changed.
- Validation: targeted video capability tests and `npm run typecheck` passed.
  Full `npm test`, `npm run build`, and `npm run check` remain required before
  committing this checkpoint.
- Remaining risk: video mode synchronization still spans edge ordering,
  reference roles, and document updates; it remains in Workspace until a
  complete behavior-covered contract can move it safely.

### Stage 5 canvas mention resolution checkpoint (2026-10-06)

- `lib/canvas/mention-resolution.ts` now owns the pure conversion of numbered
  `@N` canvas mentions into referenced media and provider-facing semantic
  labels. It receives the existing referenceability predicate explicitly, so
  node eligibility remains owned by Canvas model code.
- `CanvasWorkspace.tsx` no longer defines `mentionedMedia` or
  `resolveMentionTokens`; generation and variant prompt call sites use the
  extracted functions. Input state, mention menus, context assembly, and task
  orchestration remain in Workspace.
- Behavior coverage verifies media selection order, invalid/non-media mentions,
  and image/video/text label replacement while preserving unknown tokens. No
  URL, API payload, persisted shape, or user interaction changed.
- Validation: targeted mention resolution tests and `npm run typecheck` passed.
  Full `npm test`, `npm run build`, and `npm run check` remain required before
  committing this checkpoint.
- Remaining risk: natural-language reference replacement and mention menu
  presentation still depend on broader creative-reference and UI contracts;
  they remain in their existing modules.

### Stage 5 canvas history mask projection checkpoint (2026-10-06)

- `lib/canvas/history-mask.ts` now owns the pure conversion from the existing
  image creation mask to the existing `GalleryLocalEditMask` history contract.
  It preserves URL requirements, feather clamping, and annotation omission
  rules.
- `CanvasWorkspace.tsx` no longer contains the conversion implementation; all
  four history recording call sites use the extracted function. History
  persistence, generation callbacks, and local-edit prompt compilation remain
  in their existing owners.
- Behavior coverage verifies feather clamping, invalid-value normalization,
  annotation handling, and missing URL behavior. No API payload, persisted
  shape, or user interaction changed.
- Validation: targeted history mask tests and `npm run typecheck` passed. Full
  `npm test`, `npm run build`, and `npm run check` remain required before
  committing this checkpoint.
- Remaining risk: local-edit prompt compilation still reads multiple node/draft
  mask projections and remains coupled to editor state; it is not moved in this
  slice.

### Stage 5 angle reference projection checkpoint (2026-10-06)

- `lib/canvas/angle-reference.ts` now owns the pure projection of a ready image
  CanvasNode into the existing `ClientReferenceImage` contract used by angle,
  panorama, and image workbench flows. It receives the existing ready-image
  predicate explicitly and preserves data URL handling and fallback naming.
- `CanvasWorkspace.tsx` no longer defines this conversion; all existing angle,
  panorama, and workbench call sites use the extracted function. Angle state,
  workbench lifecycle, generation requests, and document mutation remain in
  Workspace.
- Behavior coverage verifies data URLs, remote URLs, fallback names, and
  rejection of non-ready/non-image nodes. No URL, API payload, persisted shape,
  or user interaction changed.
- Validation: targeted angle reference tests and `npm run typecheck` passed.
  Full `npm test`, `npm run build`, and `npm run check` remain required before
  committing this checkpoint.
- Remaining risk: angle generation and panorama workbench orchestration still
  combine UI lifecycle with request submission; they are intentionally not
  moved by this projection-only slice.

### Stage 5 canvas variant status boundary checkpoint (2026-10-06)

- `lib/canvas/variant-status.ts` now owns the aggregate status rule for canvas
  variant batches. The existing recovery path in `lib/canvas/model.ts` and the
  live generation paths in `CanvasWorkspace.tsx` use the same implementation,
  removing a duplicate status owner.
- The rule preserves the existing precedence: running, failed, completed only
  for a non-empty all-completed batch, otherwise queued. No task lifecycle,
  provider behavior, document shape, or UI interaction changed.
- Behavior coverage verifies precedence, empty batches, pending states, and
  all-completed batches. No URL or API contract changed.
- Validation: targeted variant status tests and `npm run typecheck` passed. Full
  `npm test`, `npm run build`, and `npm run check` remain required before
  committing this checkpoint.
- Remaining risk: variant generation still owns request submission, result
  materialization, and node mutation in Workspace; only the aggregate status
  rule moved.

### Stage 6 conversation session normalization checkpoint (2026-10-06)

- `lib/conversation/session-normalization.ts` now owns the pure normalization
  of persisted Agent conversation records: assistant image source recovery,
  legacy single-version projection, version selection clamping, version
  application, pending-message interruption, and project fallback.
- `app/page.tsx` keeps conversation Repository access, React state updates,
  history migration writes, and Agent retry/session orchestration. It imports
  the shared normalization functions instead of defining a second copy.
- The module reuses `ChatHistoryMessage`, `ChatMessageVersion`, `ChatSession`,
  and `GalleryItem` from `lib/client-history`; transient persisted fields are
  represented only as a local compatibility intersection.
- Behavior coverage verifies image source recovery, legacy version projection,
  metadata inheritance, pending interruption, project fallback, and stored
  version selection. URL, API payloads, persisted shapes, and user interaction
  are unchanged.
- Validation: targeted conversation normalization tests and `npm run
  typecheck` passed. Full `npm test`, `npm run build`, `npm run check`, and
  `git diff --check` remain required before committing this checkpoint.
- Remaining risk: conversation loading and Agent retry/persistence side
  effects still span the page component and Repository boundary; this slice
  moves only pure normalization and does not change their ownership.

### Stage 6 canvas clipboard payload checkpoint (2026-10-06)

- `lib/canvas/clipboard-payload.ts` now owns the Canvas clipboard payload
  contract, payload validation, selected-node filtering, reference remapping,
  node duplication, and internal edge/group duplication.
- `CanvasWorkspace.tsx` keeps browser clipboard read/write, image and text
  file handling, screen/world placement, collision avoidance, CanvasCore
  commits, selection updates, and user notifications. It no longer defines a
  second clipboard payload or duplicate-node implementation.
- The new module reuses the existing `CanvasDocument`, `CanvasNode`,
  `CanvasEdge`, `CanvasGroup`, `clone`, and `uid` authorities. No new store,
  persisted shape, API contract, or compatibility path was added.
- Behavior coverage verifies payload filtering and deep-copy isolation,
  version validation, ID/reference remapping, and preservation of requested
  group/input connections. Existing canvas dock and system clipboard tests
  continue to pass.
- Validation: targeted Canvas tests and `npm run typecheck` passed. Full
  `npm test`, `npm run build`, `npm run check`, and `git diff --check` remain
  required before committing this checkpoint.
- Remaining risk: paste placement and browser clipboard permissions still
  depend on Workspace interaction state; they remain there because moving them
  would couple a pure payload contract to viewport and file-drop behavior.

### Stage 6 Agent reference preparation checkpoint (2026-10-06)

- `lib/agent/reference-preparation.ts` now owns the bounded conversion of
  existing CreativeReference inputs into Agent request references. It reuses
  `normalizeCreativeReference`, preserves order and the 16-item limit, and
  compresses image URLs through an injected function.
- `app/page.tsx` no longer defines this conversion. It still owns the
  compression adapter selection, request/retry orchestration, reference
  persistence, memory preparation, and React state updates.
- The output is a transport projection of the existing CreativeReference
  contract; no second reference authority, Provider SDK call, URL, or API
  payload shape was introduced.
- Behavior coverage verifies image compression, video/text pass-through,
  metadata preservation, legacy normalization, ordering, and the existing
  16-reference bound.
- Validation: targeted Agent reference tests, `npm run typecheck`, full
  `npm test` (1823 passed, 2 skipped), and `npm run build` passed. `git diff
  --check` remains required before commit.
- Remaining risk: image compression still requires the browser adapter and
  remains injected from the page; moving that adapter would cross into browser
  media infrastructure and needs a separate contract.

### Stage 6 Agent artifact history projection checkpoint (2026-10-06)

- `lib/agent/artifact-references.ts` now owns the pure projection of persisted
  assistant Artifact metadata into the bounded file references used by later
  Agent turns. Inline file content is excluded and at most eight Artifact
  references are forwarded, preserving the previous behavior.
- `app/page.tsx` no longer defines the projection. It still owns context
  selection, request assembly, retry behavior, and Agent lifecycle state.
- The projection reuses `AgentClientFile` and `ChatHistoryMessage` field
  contracts; Artifact storage, download URLs, authentication, and generation
  remain in their existing infrastructure and HTTP boundaries.
- Behavior coverage verifies Artifact metadata is preserved, inline content is
  excluded, and the page no longer owns a duplicate implementation.
- Validation: targeted Artifact tests and `npm run typecheck` passed. Full
  `npm test`, `npm run build`, `npm run check`, and `git diff --check` remain
  required before committing this checkpoint.
- Remaining risk: page-level context selection still combines Artifact files
  with conversation memory and retry history; only the pure file projection
  moved in this slice.

### Stage 6 gallery image sharing boundary checkpoint (2026-10-06)

- `lib/canvas/share.ts` is now the single owner of generated gallery image
  sharing: image loading, layout/rendering, PNG export, and download naming.
- `app/page.tsx` keeps gallery reference lookup, image-only filtering, the
  existing missing-reference error, and the click/notification orchestration;
  it no longer contains a second Canvas drawing implementation.
- `CanvasShareReference.id` remains optional so the shared renderer accepts
  both Canvas references and persisted gallery references. The existing
  `CanvasShareItem` name remains an alias for callers without introducing a
  second contract.
- Behavior coverage executes the shared renderer with browser fakes and
  verifies branding, QR image loading, reference filtering, Canvas export,
  and download anchor behavior. URL, API payloads, persisted shapes, and
  user interaction remain unchanged.
- Validation: targeted share tests and `npm run typecheck` passed. Full
  `npm run check`, production build, and `git diff --check` are required
  before committing this checkpoint.
- Remaining risk: conversation long-image sharing still remains in
  `app/page.tsx`; it has a different conversation layout contract and is not
  moved in this slice.

### Stage 6 conversation share renderer checkpoint (2026-10-06)

- `lib/share-conversation-renderer.ts` now owns the browser Canvas rendering
  of selected conversation messages, including image loading, markdown block
  drawing, branded assets, layout application, and PNG Blob creation.
- `app/page.tsx` keeps message selection, busy state, preview URL lifecycle,
  download naming, and notifications. It passes the existing selected message
  records into the renderer and no longer owns Canvas drawing details.
- The renderer input is a local projection of the existing conversation
  records and reuses `buildShareConversationLayout`; it does not add a second
  persisted message or sharing contract.
- Behavior coverage runs the renderer with browser Canvas/Image fakes and
  verifies generated image, branding/QR asset loads, dimensions, and PNG
  output. URL, API payloads, persisted shapes, and user interaction remain
  unchanged.
- Validation: targeted renderer test and `npm run typecheck` passed. Full
  `npm run check`, production build, and `git diff --check` remain required
  before committing this checkpoint.
- Remaining risk: the page still owns the preview modal composition and
  browser download action because those are UI lifecycle responsibilities;
  only the pure rendering boundary moved.

### Stage 6 chat file download adapter checkpoint (2026-10-06)

- `lib/agent/chat-file-download.ts` now owns authenticated artifact fetching,
  inline UTF-8/base64 Blob construction, and browser download URL cleanup for
  Agent chat files.
- `app/page.tsx` keeps only the user-facing callback and existing failure
  notification. It no longer owns file transport or Blob encoding details.
- The adapter reuses the existing `ChatFile` contract from `lib/client-history`;
  no new persisted shape, API route, storage owner, or compatibility layer was
  introduced.
- Behavior coverage verifies inline base64 downloads, remote artifact
  downloads, filenames/MIME handling, and the existing 404 error mapping.
- Validation: targeted download tests and `npm run typecheck` passed. Full
  `npm run check`, production build, and `git diff --check` remain required
  before committing this checkpoint.
- Remaining risk: the page still decides when a file action is available and
  which notification to show; those are presentation and interaction concerns.

### Stage 6 image download adapter checkpoint (2026-10-06)

- `lib/image-download.ts` now owns browser image downloads: response Blob
  conversion, MIME based extension correction, temporary URL cleanup, and
  data URL fallback behavior.
- `app/page.tsx` keeps the existing download callbacks and filenames while
  delegating the browser adapter; no URL, API payload, or user interaction
  changed.
- The adapter is a small UI infrastructure boundary and does not introduce a
  second image persistence or asset authority.
- Behavior coverage verifies fetched JPEG extension normalization, temporary
  URL revocation, and data URL fallback download attributes.
- Validation: targeted image download tests and `npm run typecheck` passed.
  Full `npm run check`, production build, and `git diff --check` remain
  required before committing this checkpoint.
- Remaining risk: download availability and notification wording stay in the
  page because they depend on the surrounding viewer interaction.

### Stage 6 canvas workspace header boundary audit (2026-10-06)

- The next safe extraction boundary is the top toolbar and project-version
  popover in `components/canvas/CanvasWorkspace.tsx`. Its proposed contract is
  presentation-only: project projections, panel/button state, save/sync
  indicators, and callbacks for Workspace-owned actions.
- This slice was intentionally not committed. The existing JSX contains
  mixed legacy Windows-encoded strings; automated extraction through the
  current shell converted user-facing literals and produced invalid TypeScript.
  The failed attempt was fully reverted and the last passing commit remains
  authoritative.
- Keep project persistence, CanvasCore commands, and router behavior in
  `CanvasWorkspace.tsx`; only local rename input state and toolbar rendering
  should move after a byte-preserving extraction path is established.
- Remaining risk: verify the extracted component with behavior coverage for
  project-menu propagation, rename Enter/Escape, topbar collapse persistence,
  and panel toggle callbacks before proceeding.

### Stage 6 canvas workspace header extraction checkpoint (2026-10-06)

- `components/canvas/CanvasWorkspaceHeader.tsx` now owns the canvas topbar
  and project/version popover presentation, including local rename input state,
  collapse control, panel buttons, save/sync badges, and keyboard/pointer
  forwarding.
- `CanvasWorkspace.tsx` remains the owner of CanvasCore state, project
  persistence, version mutations, router navigation, panel orchestration, and
  all business callbacks. No repository, provider, or filesystem dependency was
  added to the header component.
- Existing canvas behavior tests were updated to read the new UI owner while
  retaining Workspace assertions for business ownership. URL, API, persisted
  project/version shapes, CSS classes, button order, and interaction callbacks
  remain compatible.
- Validation: targeted canvas tests passed (67/67), `npm test` passed (1830
  passed, 2 skipped), `npm run typecheck` passed, `npm run build` passed, and
  `git diff --check` reports only the pre-existing user edit at the end of
  `AGENTS.md`.
- Remaining risk: `CanvasWorkspace.tsx` still owns viewport, node, generation,
  and workbench coordination. The next safe slice should be selected only after
  its props contract is isolated; broad CSS movement remains intentionally
  deferred.

### Stage 3 canvas viewport shell checkpoint (2026-10-06)

- `components/canvas/CanvasViewport.tsx` now owns the stable canvas stage DOM
  contract, including the forwarded stage ref, cursor metadata, pointer,
  drag/drop, context-menu, double-click, and wheel event surfaces.
- `CanvasWorld` in the same module owns the camera transform wrapper and zoom
  tier projection. It receives the existing `CanvasDocument.camera` projection
  and does not store or mutate viewport state.
- `CanvasWorkspace.tsx` still owns every event callback, interaction state,
  coordinate conversion, CanvasCore action, selection mutation, and node/group
  gesture. No React viewport store or duplicate camera authority was added.
- Existing cursor, file-drop, double-click, reference-picker, and node-gesture
  behavior tests pass after redirecting only the moved cursor metadata assertion
  to the new owner.
- Remaining risk: the pointer state machine is still interleaved with node and
  selection mutations. A later viewport interaction slice needs dedicated
  behavior coverage before moving those callbacks; CSS domain splitting remains
  deferred.

### Stage 3 canvas viewport overlay checkpoint (2026-10-06)

- `components/canvas/CanvasViewportOverlay.tsx` now owns the canvas grid,
  snap-guide projection, external-drop hint, reference-picker hint, and clone
  progress chip presentation.
- The component receives the existing camera, transient flags, snap guide list,
  and clone progress projection. Its only action callback opens the existing
  clone dialog; it does not poll tasks, mutate CanvasCore, or own drag/picker
  state.
- `CanvasWorkspace.tsx` now retains only the state derivation and callback
  wiring for these overlays. Existing file-drop, reference-picker, clone UI,
  double-click, and cursor behavior coverage was redirected to the new UI
  owner without changing URL, API, persistence, or visual class contracts.
- Targeted tests and typecheck pass. Full check remains required before the
  stage commit; viewport pointer-state extraction and CSS domain movement stay
  deferred because their behavior is still coupled to node gestures.

### Stage 2 blank-canvas create menu checkpoint (2026-10-06)

- `components/canvas/CanvasCreateContextMenu.tsx` now owns the blank-canvas
  create menu presentation, separators, labels, and keyboard-safe menu frame.
- Its contract accepts the existing screen/world menu position and delegates
  node creation and clone-dialog opening through callbacks. Workspace retains
  `addNode`, CanvasCore mutations, notifications, and menu state ownership.
- `CanvasNodeCreationKind` is the shared creation contract in
  `lib/canvas/types.ts`; no duplicate creation type or compatibility layer was
  introduced.
- The context-menu behavior suite and typecheck pass for this extraction.
  Full `npm test` passed with 1830 tests passing and 2 skipped; `npm run build`
  and the repository `npm run check` also passed. `git diff --check` is clean
  for this stage's files; the only excluded warning is the user's pre-existing
  uncommitted `AGENTS.md` edit. Node/group menus and the tools menu remain in
  Workspace because their action builders are still interleaved with selection
  and clipboard orchestration.

### Stage 2 canvas tools context menu checkpoint (2026-10-06)

- `components/canvas/CanvasToolsContextMenu.tsx` now owns the blank-canvas
  tools menu presentation: Agent entry, upload, create-node transition, paste,
  undo/redo, arrange, fit view, and empty-content cleanup.
- Its props contract carries only the existing screen/world position, history
  and empty-content projections, and callbacks. Workspace remains the owner of
  context-menu state, CanvasCore history mutations, file picker, paste handling,
  Agent dock opening, layout, viewport, and cleanup behavior.
- The previous inline JSX was removed from Workspace; no duplicate action
  implementation, store, repository, or compatibility layer was added.
- Targeted canvas, Agent dock, double-click, file-drop, and clone behavior tests
  pass (102/102). Full typecheck, `npm test` (1830 passed, 2 skipped),
  production build, and repository `npm run check` all pass. `git diff --check`
  is clean for this stage's files; the only excluded warning is the user's
  pre-existing uncommitted `AGENTS.md` edit.
- Node/group menus and CSS domain movement remain deferred because their action
  builders and gesture interactions are still coupled to selection/document
  mutations.
### Stage 2 canvas tools CSS boundary checkpoint (2026-10-06)

- `app/canvas-tools.css` now owns the blank-canvas tools context-menu presentation: compact sizing, action spacing, icons, danger/disabled states, shortcuts, separators, and the small-screen adjustment.
- `app/canvas.css` retains the shared context-menu frame and node/group menu styles; no shared selector or menu behavior was moved. `app/layout.tsx` loads the new stylesheet immediately after the base canvas stylesheet so the existing cascade remains unchanged for the moved selectors.
- `tests/canvas-context-menu.test.mjs` reads the tools stylesheet for tools-specific assertions while continuing to read `app/canvas.css` for shared menu behavior. No URL, API, data format, or interaction changed.
- Validation: targeted canvas context-menu and Agent dock tests passed (69/69), `npm run typecheck` passed, `npm test` passed (1830 passed, 2 skipped), and `npm run build` passed. `git diff --check` remains clean for this stage files; the only excluded warning is the user pre-existing uncommitted `AGENTS.md` edit.
- Remaining risk: the rest of `app/canvas.css` still contains multiple canvas domains. Continue with one selector family at a time only when its ownership and cascade order are explicit; do not move shared context-menu rules mechanically.
### Stage 3 canvas viewport overlay CSS boundary checkpoint (2026-10-06)

- `app/canvas-viewport-overlay.css` now owns the viewport overlay presentation used by `CanvasViewportOverlay`: grid paint, snap guide lines, external file-drop hint, reference-picker hint, and clone progress chip animation/state styling.
- `app/canvas.css` retains the stage/world layering contract, shared `canvas-hint` and `canvas-status-chip` base styles, and unrelated node/edge/workbench rules. No interaction state, CanvasCore ownership, URL, API, or persisted data changed.
- `app/layout.tsx` loads the overlay stylesheet after the base canvas stylesheet and tools stylesheet. Behavior tests now read overlay-specific selectors from the new file while shared assertions remain on `app/canvas.css`.
- Validation: targeted canvas/Agent/clone tests passed (116/116), `npm run typecheck` passed, `npm test` passed (1830 passed, 2 skipped), and `npm run build` passed. `git diff --check` is clean for this stage files; the only excluded warning is the user pre-existing uncommitted `AGENTS.md` edit.
- Remaining risk: `app/canvas.css` still contains shared stage, node, menu, and workbench domains. Further CSS movement should keep z-index contracts and shared base selectors in the base file unless a complete ownership boundary is proven.
### Stage 3 canvas selection CSS boundary checkpoint (2026-10-06)

- `app/canvas-selection.css` now owns the multi-select layout toolbar presentation: alignment/distribution groups, icon button states, tooltips, divider, overflow behavior, and mobile sizing.
- `app/canvas.css` retains the selection layer z-index contract and the shared primary selection toolbar rules. `CanvasSelectionToolbar.tsx` remains the presentation owner; CanvasCore selection, alignment, distribution, history, and callbacks remain in Workspace.
- `tests/canvas-node-editor.test.mjs` reads layout-specific assertions from the new stylesheet. No URL, API, data format, selection behavior, or pointer interaction changed.
- Validation: targeted selection/Agent/node editor tests passed (138/138), `npm run typecheck` passed, `npm test` passed (1830 passed, 2 skipped), `npm run build` passed, and `npm run check` passed. `git diff --check` is clean for this stage files; the only excluded warning is the user pre-existing uncommitted `AGENTS.md` edit.
- Remaining risk: primary selection toolbar buttons still share deck styles in `app/canvas.css`; keep that shared rule in place until a separate contract can prove it is safe to move.

### Stage 3 canvas marquee presentation checkpoint (2026-10-06)

- `components/canvas/CanvasMarquee.tsx` now owns the marquee frame, dimensions
  chip, and selected-count chip presentation. Its contract accepts only the
  existing marquee geometry and the current selected count.
- `CanvasWorkspace.tsx` still owns marquee pointer gestures, transient state,
  selection updates, and CanvasCore coordination. No second selection store or
  interaction state machine was introduced.
- `app/canvas-marquee.css` now owns the marquee frame, animated outline, chip,
  and reduced-motion rules. The stage z-index contract remains in
  `app/canvas.css` so the overlay keeps its existing stacking behavior.
- Targeted marquee/node gesture coverage, typecheck, full tests, production
  build, repository check, and `git diff --check` are required before this
  checkpoint is committed. Pointer gesture state extraction remains deferred
  because it is still coupled to selection and document mutations.

### Stage 4 canvas node layer adapter checkpoint (2026-10-06)

- `components/canvas/CanvasNodeLayer.tsx` now owns the per-node presentation
  mapping: selection/dragging projections, editor context projections, and the
  complete `MemoizedCanvasNodeCard` prop wiring. It receives the existing
  document snapshot and callback contract and renders the existing card as the
  sole node-card implementation.
- `CanvasWorkspace.tsx` now keeps node gesture callbacks, selection/document
  mutations, generation actions, and editor state ownership. It no longer
  constructs the node-card JSX inline and does not create a second node or
  selection store.
- Existing node editor, double-click, gesture, and reference-picker behavior
  coverage passed after the move. Full check passed with 1830 tests passing and
  2 skipped; production build and typecheck also passed. The card internals,
  editor popover, and pointer gesture state machine remain intentionally in
  their current modules because their behavior contracts are still coupled.

### Stage 6 canvas angle workbench boundary checkpoint (2026-10-06)

- `components/canvas/CanvasAngleWorkbench.tsx` now owns the embedded angle
  console shell, wheel/pointer event isolation, and the presentation contract
  for the canvas-owned angle panel. It delegates the existing `AngleConsole`
  behavior through typed callbacks and keeps result actions disabled exactly as
  before for the embedded surface.
- `CanvasWorkspace.tsx` retains angle node lookup, reference projection,
  transient versus persisted angle state, generation callbacks, draft updates,
  CanvasCore mutations, and user notifications. No angle runtime or duplicate
  state machine was introduced.
- Angle console, image-angle, node-editor, and double-click behavior coverage
  passed after the extraction. Full `npm run check` remains the final gate for
  this slice before commit; CSS and generation service boundaries are deferred.

### Stage 6 cinematic workbench shell checkpoint (2026-10-06)

- `components/canvas/CanvasCinematicWorkbench.tsx` now provides the
  canvas-specific entry contract for the one-click cinematic panel and keeps
  the existing `OneClickCinematicPanel` as the sole implementation of model,
  duration, and director controls.
- `CanvasWorkspace.tsx` still validates the selected image, owns the panel
  open state, and runs the existing cinematic generation callback. No video
  request, provider selection, or task lifecycle was duplicated.
- Cinematic director, node editor, double-click, full test, typecheck, build,
  and repository check coverage passed. The underlying cinematic panel remains
  intentionally intact because its controls and provider-specific validation
  are a cohesive domain boundary.

### Stage 6 cinematic workbench CSS boundary checkpoint (2026-10-06)

- `app/canvas-cinematic.css` now owns the complete `.canvas-one-click-*`
  selector family, including the responsive rules and select-menu overrides
  used by the cinematic settings surface.
- `app/canvas.css` retains shared canvas layers and the action-cue styles used
  by multiple compact toolbars. `app/layout.tsx` loads the cinematic sheet
  immediately after the base canvas sheet, preserving the existing cascade.
- The cinematic behavior test now reads its domain stylesheet directly. No URL,
  API, data format, interaction, or visual contract changed; no duplicate
  state, runtime, provider, or compatibility layer was introduced.
- Validation: the cinematic director behavior test passed (6/6),
  `npm run typecheck` passed, full `npm run check` passed (1830 tests passed,
  2 skipped, production build succeeded), and `git diff --check` is clean for
  this slice. The pre-existing uncommitted `AGENTS.md` edit remains excluded.

### Stage 6 video clip workbench CSS boundary checkpoint (2026-10-06)

- `app/canvas-video-clip.css` now owns the complete `.canvas-video-clip-*` selector family for the ordinary video-node trim workbench, including responsive and theme refinements.
- `app/canvas.css` retains the video-editor node/workbench domain and shared canvas z-index/token definitions. `app/layout.tsx` loads the clip stylesheet after the base canvas stylesheet so the previous cascade order is preserved.
- `CanvasVideoClipWorkbench.tsx` remains the sole owner of local playback, trim pointer capture, keyboard handling, and clip creation callbacks. No CanvasCore, API, storage, provider, or data contract changed.
- Validation: targeted video clip/editor/node tests passed (32/32), `npm run typecheck` passed, full `npm run check` passed (1830 tests passed, 2 skipped, production build succeeded), and `git diff --check` is clean for this slice. The pre-existing uncommitted `AGENTS.md` edit remains excluded.

### Stage 6 image editor workbench CSS boundary checkpoint (2026-10-06)

- `app/canvas-image-editor.css` now owns the image editor workbench presentation: operation tabs, preview/outpaint/crop/grid/transform overlays, controls, custom grid-line affordances, footer actions, responsive rules, and the fixed preview viewport refinements.
- `app/canvas.css` keeps adjacent audio panel, group, node-editor, cursor-layer, and shared canvas token rules. The image editor stylesheet is loaded after the clip stylesheet and before the remaining canvas domain sheets, preserving the prior cascade for its selectors.
- `CanvasImageEditorWorkbench.tsx` remains the sole owner of local edit state, pointer/keyboard interaction, API callbacks, and save semantics. `cursor.css` and `shadow-tuning.css` remain shared cross-domain overrides and were intentionally not duplicated or moved.
- Validation: targeted image-editor/cursor/node-editor/double-click tests passed (77/77), `npm run typecheck` passed, full `npm run check` passed (1830 tests passed, 2 skipped, production build succeeded), and `git diff --check` is clean for this slice. The pre-existing uncommitted `AGENTS.md` edit remains excluded.

### Stage 6 audio node panel CSS boundary checkpoint (2026-10-06)

- `app/canvas-audio-panel.css` now owns the `.canvas-audio-panel-*` presentation: intro/status, audio metadata, empty state, upload action, and responsive layout.
- `app/canvas.css` keeps the shared `.canvas-audio-player-*` controls, reference-audio preview, node footer status, and canvas group rules. The panel sheet is loaded after the image-editor sheet, preserving the existing cascade without copying the shared player contract.
- `CanvasAudioNodePanel.tsx` remains the sole owner of file selection, replacement callbacks, duration updates, and event isolation. No storage, API, provider, or media contract changed.
- Validation: targeted canvas node/editor/video/activity tests passed (74/74), `npm run typecheck` passed, full `npm run check` passed (1830 tests passed, 2 skipped, production build succeeded), and `git diff --check` is clean for this slice. The pre-existing uncommitted `AGENTS.md` edit remains excluded.

### Stage 6 canvas group compose CSS boundary checkpoint (2026-10-06)

- The complete historical `.canvas-compose-*` baseline block was moved from
  `app/canvas.css` into `app/canvas-compose.css`, where the compose dialog's
  existing selector family and later responsive refinements already live.
- The mobile arrange-mode rules remain in `app/canvas.css` because they belong to
  the topbar arrangement control rather than the compose dialog. No shared
  canvas z-index, stage, group, document, selection, or task behavior moved.
- `app/layout.tsx` already loads `canvas-compose.css` immediately after the base
  canvas sheet, so the previous cascade order and visual behavior are preserved.
- `tests/canvas-group-compose-dialog.test.mjs` now verifies the compose domain
  stylesheet directly; no source-of-truth, API, URL, data format, or interaction
  contract changed and no duplicate compatibility layer was added.
- Validation: targeted group compose/reference/shortcut tests passed (8/8),
  `npm run typecheck` passed, full `npm run check` passed (1830 tests passed,
  2 skipped; production build succeeded), and `git diff --check` is clean.
- Remaining risk: `app/canvas.css` still contains shared canvas layers, group
  arrangement rules, node/editor surfaces, and Agent dock layout. The Agent dock
  remains intentionally deferred because its rail, panel geometry, responsive
  deck adjustment, mention menus, model picker, and message rendering share
  cross-domain selectors.

### Stage 6 canvas arrangement menu CSS boundary checkpoint (2026-10-06)

- `app/canvas-arrangement.css` now owns topbar arrangement and group arrangement
  menu presentation, including their small-screen rules. Shared group cards,
  quick-toolbar container structure, and canvas layer tokens remain in the base
  canvas stylesheet.
- `app/layout.tsx` loads the arrangement sheet immediately after `canvas.css`,
  preserving its order before workbench-specific sheets. The existing
  `shadow-tuning.css` overrides remain later in the cascade.
- `tests/canvas-context-menu.test.mjs` checks the group menu's bounds in the new
  stylesheet and verifies both menus keep their responsive rules there. No
  action, selection, CanvasCore command, URL, API, or document behavior moved.
- Validation: targeted context-menu/group compose/group reference/group shortcut
  tests passed (16/16), `npm run typecheck` passed, full `npm run check` passed
  (1831 tests passed, 2 skipped; production build succeeded), and
  `git diff --check` is clean.
- Remaining debt: `app/canvas.css` still contains the shared canvas stage,
  groups, node/editor, Agent dock and other overlay rules. The Agent dock's
  cross-domain geometry and message/composer styles remain deferred.

### Stage 6 canvas processing indicator CSS boundary checkpoint (2026-10-06)

- `app/canvas-processing.css` now owns the processing indicator surface,
  status treatments, progress display, compact layout, and indicator motion
  preferences. `app/layout.tsx` loads it immediately after `canvas.css`.
- `app/canvas.css` retains node-shell status treatment, running/queued node
  pseudo-elements, aura and card backgrounds, pending media-state padding, and
  overview/pan reduced-motion rules. These selectors affect shared node
  structure or rely on their original cascade position, along with the queued
  node signal keyframe, so they were kept in the base sheet. The processing
  sheet only pauses and reduces motion on its own indicator descendants.
- `tests/canvas-processing-animation.test.mjs` now checks the indicator sheet
  separately from the shared node shell; no runtime or product behavior moved.
- Validation: targeted processing/node-editor behavior tests passed (66/66),
  `npm run typecheck` passed, full `npm run check` passed (1831 tests passed,
  2 skipped; production build succeeded), and final `git diff --check` passed.

### Stage 6 canvas activity drawer CSS boundary checkpoint (2026-10-06)

- `app/canvas-activity.css` now owns the activity summary and event rows,
  including status colors, truncation, and narrow-screen columns. It loads
  directly after the base canvas stylesheet.
- `app/canvas.css` retains the side-panel shell, shared empty state, task-log
  card styles, and shared scrolling rules. Activity data mapping, timestamps,
  status labels, and click behavior remain in `CanvasActivityDrawer.tsx`.
- The existing activity drawer behavior test now checks its domain stylesheet.
  No interaction, API, task mapping, or CanvasCore ownership changed.
- Validation: focused activity drawer/workspace activity tests passed (14/14),
  `npm run typecheck` passed, full `npm run check` passed (1832 tests passed,
  2 skipped; production build succeeded), and `git diff --check` passed.

### Stage 6 panorama workbench CSS boundary checkpoint (2026-10-06)

- `app/canvas-panorama.css` now owns the standalone spherical image viewer's
  dialog, sphere stage, controls, status overlays, and responsive layout. The
  sheet loads after `canvas.css`; the shared modal backdrop and z-index tokens
  stay in the base sheet.
- `PanoramaWorkbench.tsx` remains the sole owner of Three.js setup, pointer and
  keyboard input, image capture, and apply callbacks. No rendering or image
  behavior changed.
- Panorama behavior tests now read viewer-specific CSS from its domain sheet.
  Validation: focused panorama/activity tests passed (11/11), `npm run
  typecheck` passed, full `npm run check` passed (1832 tests passed, 2 skipped;
  production build succeeded), and `git diff --check` passed.

### Stage 6 text lightbox CSS boundary checkpoint (2026-10-06)

- `app/canvas-text-lightbox.css` now owns the text response lightbox shell,
  prompt, editor mode, body, footer, and responsive rules. The shared text
  selection toolbar remains in `app/canvas.css` because the Agent dock uses the
  same selector; cursor and shadow overrides remain in their existing shared
  sheets.
- `CanvasTextLightbox.tsx` remains the owner of text selection, clipboard,
  editing, save, and node action callbacks. No CanvasCore or Agent behavior
  moved.
- The lightbox behavior test now reads the moved presentation rules from the
  domain stylesheet. Validation: focused text/cursor tests passed (11/11),
  `npm run typecheck` passed, full `npm run check` passed (1832 tests passed,
  2 skipped; production build succeeded), and `git diff --check` passed.

### Stage 6 canvas task log CSS boundary checkpoint (2026-10-06)

- `app/canvas-task-log.css` now owns task log card layout, status and preview
  styling, metadata chips, lineage details, compact grid areas, and responsive
  rules. `app/layout.tsx` loads it after the base canvas sheet and before the
  shared shadow/theme overrides.
- `app/canvas.css` retains the shared task/activity scroll behavior and the
  task filter controls. `app/shadow-tuning.css` continues to own shared shadow
  and light-theme card treatments. `CanvasActivityDrawer.tsx` keeps activity
  projection, selection, media actions, and scroll restoration.
- Task log presentation assertions now read the domain sheet. No task data,
  interaction, CanvasCore ownership, API, or persistence behavior changed.
- Validation: focused activity drawer tests passed (7/7); `npm run check`
  passed (1832 tests passed, 2 skipped; production build succeeded); and
  `git diff --check` passed.

### Stage 6 asset collection picker CSS boundary checkpoint (2026-10-06)

- `app/canvas-asset-collection-picker.css` now owns the collection target dialog,
  collection selection body, and new-collection form controls. The shared modal
  backdrop and asset picker z-index remain in `app/canvas.css`.
- Asset drawer styling and the workspace deck/panel geometry remain in the base
  sheet because their selectors participate in shared responsive layout.
- The collection picker behavior suite now checks the dialog's domain sheet;
  no collection, drag/drop, API, or persistence behavior changed.
- Validation: collection picker behavior tests passed (6/6); `npm run check`
  passed (1832 tests passed, 2 skipped; production build succeeded); and
  `git diff --check` passed.

### Stage 6 asset preview CSS boundary checkpoint (2026-10-06)

- `app/canvas-asset-preview.css` now owns the asset preview modal, media stage,
  footer actions, and narrow-screen sizing. The shared backdrop and asset
  preview z-index remain in `app/canvas.css`.
- `CanvasAssetDrawer.tsx` remains the sole owner of preview selection, media
  rendering, download actions, and close behavior. No asset data or interaction
  contract changed.
- Validation: focused asset collection and preview tests passed (7/7); `npm run
  check` passed (1832 tests passed, 2 skipped; production build succeeded); and
  `git diff --check` passed.

### Stage 6 canvas asset library CSS boundary checkpoint (2026-10-06)

- `app/canvas-asset-library.css` now owns asset drawer internals: search and
  filters, collection dropzone, asset cards, media actions, loading/empty
  states, and drawer-local responsive refinements.
- `app/canvas.css` retains the drawer shell, z-index tokens, preview/picker
  backdrops, shared panel slot geometry, deck offsets, and minimap rules. Those
  selectors coordinate assets with other canvas panels and remain intentionally
  cross-domain.
- `CanvasAssetDrawer.tsx` and `CanvasAssetCollectionPicker.tsx` remain the sole
  owners of asset loading, collection mutations, drag/drop, preview actions,
  and Escape cleanup. No API, data, or interaction contract changed.
- Validation: focused asset collection and preview tests passed (7/7); `npm run
  check` passed (1833 tests passed, 2 skipped; production build succeeded); and
  `git diff --check` passed.

### Stage 6 media viewer CSS boundary checkpoint (2026-10-07)

- `app/canvas-media-viewer.css` now owns the media viewer backdrop, header controls, comparison stage, zoom controls, references, parameter metadata, prompt projection, and responsive viewer rules.
- `app/canvas.css` keeps shared lightbox primitives, canvas workbench layout, cursor behavior, and unrelated media/node styles. `app/layout.tsx` loads the domain sheet immediately after the shared canvas sheet.
- The media viewer behavior suite now reads the domain stylesheet directly; no viewer state, URL, API, data shape, or interaction changed.
- Remaining risk: the viewer still coordinates zoom, comparison, download, and prompt callbacks in `components/MediaViewer.tsx`; moving those behaviors needs a separate interaction-covered slice.
- Validation: the focused media viewer suite passed (4/4); the full test suite passed (1833 passed, 2 skipped); typecheck, production build, and `git diff --check` passed.

### Stage 6 canvas media node CSS boundary checkpoint (2026-10-07)

- `app/canvas-media-node.css` now owns media node cards, media loading and failure states, video playback overlays, and audio node presentation used by `CanvasMediaNodeCard.tsx`.
- `app/canvas.css` keeps the generic canvas node shell, intrinsic resolution badges shared by media and upscale cards, shadow tuning, and cross-node running state backgrounds. The new sheet is loaded after the shared canvas sheet.
- Video and node editor behavior tests now read media-card presentation rules from the domain sheet. No CanvasCore state, media URL, task status, API, or interaction callback changed.
- Remaining risk: video play state still uses the existing `useCanvasMediaPlayback` hook and the card still coordinates media load callbacks; extracting that runtime needs separate browser behavior coverage.
- Validation before full check: focused canvas node/editor and video suites passed (68/68), typecheck passed, and `git diff --check` passed.

### Stage 4 generator node primitives checkpoint (2026-10-07)

- Moved generator-card-only summary, prompt, retry-all and variant execution
  state selectors into `app/canvas-generator-node.css`.
- Removed the duplicated selector block from `app/canvas.css`; shared variant
  editor and cross-surface node rules remain in the shared stylesheet.
- Validation: `npm run check` passed (1833 tests passed, 2 skipped; typecheck,
  update manifest validation and production build passed); `git diff --check`
  passed.
- Remaining risk: generator execution and variant editing callbacks still
  cross CanvasWorkspace/Core boundaries; no React ownership move was attempted
  in this CSS-only slice.

### Stage 6 context menu CSS boundary checkpoint (2026-10-07)

- `app/canvas-context-menu.css` now owns the shared context-menu frame,
  creation/tool/node/group menu rows, quick-action menu, responsive bounds,
  reduced-motion behavior, and clone action icon styling.
- `app/canvas.css` retains only the canvas stage, topbar, node, group and
  shared overlay rules; no menu action, positioning helper, selection mutation,
  or CanvasCore command moved.
- `app/layout.tsx` loads the menu sheet immediately after `canvas.css`, and
  behavior tests combine both files to preserve the existing cascade contract.
- Validation: focused context-menu and node-editor suites passed (72/72);
  `npm run check` passed (1833 tests passed, 2 skipped; typecheck, update
  manifest validation and production build passed); `git diff --check` passed.
- Remaining risk: menu action builders and pointer isolation remain coordinated
  by `CanvasWorkspace.tsx`; extracting them requires behavior coverage for
  selection and command callbacks, so this slice intentionally moved CSS only.

### Stage 6 minimap boundary review (2026-10-07)

- Reviewed `CanvasMinimap.tsx` and all `.canvas-minimap*` selectors.
- Deferred CSS extraction: minimap presentation is interleaved with shared
  responsive deck offsets, global readability overrides, node semantic color
  variables, and reduced-motion contracts in `app/canvas.css`. Moving only a
  subset would leave same-selector cascade ownership split across files and
  could change viewport/deck positioning. No behavior-safe slice was identified
  without first adding a dedicated style contract and broader visual coverage.

### Stage 5 variant image result projection checkpoint (2026-10-06)

- `canvasVariantImageNodeData` in `lib/canvas/variant-batch.ts` now owns the pure projection of generated variant image provenance and duration metadata.
- `CanvasWorkspace.tsx` keeps result node creation, edge creation, batch status updates, and history recording; it no longer assembles the duplicated image metadata object inline.
- Behavior coverage verifies source provenance, reference provenance, and duration preservation without changing node shape or generation flow.
- Validation: focused variant batch tests passed (11/11); `npm run typecheck` passed; full `npm run check` passed (1850 tests passed, 2 skipped; production build succeeded); and `git diff --check` passed.
- Remaining risk: variant task submission and result orchestration remain coordinated by `CanvasWorkspace.tsx`; further extraction should continue through pure projections or explicit service boundaries without introducing a second task runtime.

### Stage 5 variant image request projection checkpoint (2026-10-06)

- `canvasVariantImageRequest` in `lib/canvas/variant-batch.ts` now owns the pure mapping from image variant settings to the existing `generateCanvasImage` request shape, including custom aspect, size, background, mask, move guide, and references.
- `CanvasWorkspace.tsx` keeps the request call, provider/API boundary, result node creation, edge creation, batch state, and history side effects; it no longer assembles those request fields inline.
- Behavior coverage verifies the mapped request shape and preserves the existing API payload contract.
- Validation: focused variant batch tests passed (9/9); `npm run check` passed (1851 tests passed, 2 skipped; production build succeeded); and `git diff --check` passed.
- Remaining risk: variant video request mapping and the surrounding task polling remain coupled to Workspace; extract them only with equivalent request and polling behavior coverage.

### Stage 5 variant video request projection checkpoint (2026-10-06)

- `canvasVariantVideoRequest` in `lib/canvas/variant-batch.ts` now owns the pure mapping of resolved variant video inputs and settings to the existing `generateCanvasVideo` request shape.
- `CanvasWorkspace.tsx` keeps video input validation, provider model resolution, API invocation, task polling, node/edge creation, batch state, and history side effects; it no longer assembles the request object inline.
- The legacy source-coupled Agnes parameter test was narrowed to the two paths that still own inline request construction. Variant payload behavior is covered by the new projection test, while `canvas-api.test.mjs` continues to verify final Agnes request serialization.
- Validation: focused canvas/API/variant tests passed (108/108); `npm run check` passed (1852 tests passed, 2 skipped; production build succeeded); and `git diff --check` passed.
- Remaining risk: task polling, variant state transitions, and video result creation remain in `CanvasWorkspace.tsx`; extracting them requires an explicit task lifecycle contract and broader behavior coverage.

### Stage 5 variant video polling projection checkpoint (2026-10-06)

- `canvasVariantVideoTaskData` in `lib/canvas/variant-batch.ts` now owns the pure projection from a polled task to media node status, progress, URL, status label, and generation duration.
- `CanvasWorkspace.tsx` keeps document traversal, task polling, variant aggregate state, and command/history side effects; `applyVideoTask` no longer duplicates node data projection.
- Behavior coverage verifies completed task URL/progress/status and duration projection.
- Validation: focused variant tests passed (11/11); `npm run check` passed (1853 tests passed, 2 skipped; production build succeeded); and `git diff --check` passed.
- Remaining risk: the polling loop and task lifecycle still live in Workspace; extracting them safely would require a shared runtime contract and coverage for timeout, retry, cancellation, and background reconciliation.

### Stage 6 canvas panel CSS boundary checkpoint (2026-10-06)

- `app/canvas-panels.css` now owns the canvas panel backdrop, side-panel shell,
  settings sections, shortcut list, and panel-specific responsive rules.
  `app/layout.tsx` loads it after the shared canvas stylesheet so the existing
  cascade and visual behavior are preserved.
- `app/canvas.css` retains shared canvas stage, shell, and task-log styles;
  panel behavior, panel actions, and CanvasCore ownership remain unchanged.
- `tests/canvas-agent-dock.test.mjs` composes the shared and panel domain
  styles when checking the right-hand dock contract. The variant batch behavior
  test now tolerates the canonical combined type import and CRLF line endings;
  no production behavior or data contract changed.
- Validation: focused canvas panel and variant behavior tests passed (72/72),
  `npm run typecheck` passed, full `npm run check` passed (1853 tests passed,
  2 skipped; production build succeeded), and `git diff --check` passed.

### Stage 6 canvas feedback CSS boundary checkpoint (2026-10-07)

- `app/canvas-feedback.css` now owns the transient reference-picker hint,
  clone status chip, and canvas notice toast, including their responsive
  placement. The stylesheet is loaded after `canvas.css` so the existing
  cascade remains stable.
- `app/canvas.css` retains canvas stacking tokens, selection/deck controls,
  and shared modal/workbench styles. Feedback state, clone polling, toast
  lifecycle, and pointer behavior remain in their existing components.
- `tests/canvas-reference-picker.test.mjs` reads the new feedback stylesheet
  for its presentation contract; clone, dock, and shadow behavior remain
  covered without changing user flows or data formats.
- Validation: focused feedback/dock/clone/shadow tests passed (97/97),
  `npm run typecheck` passed, full `npm run check` passed (1853 tests passed,
  2 skipped; production build succeeded), and `git diff --check` passed.

### Stage 5 canvas edge geometry projection checkpoint (2026-10-07)

- `lib/canvas/edge-geometry.ts` now owns the pure Bézier midpoint projection
  used by the connection-cancel affordance. It consumes existing
  `CanvasDocument`/`CanvasEdge` contracts and delegates endpoint and lane
  calculations to the canonical canvas model helpers.
- `CanvasWorkspace.tsx` keeps connection interaction state, pointer handling,
  cancel timing, and overlay rendering; it only imports the projection and no
  longer carries the geometry implementation inline.
- Behavior coverage verifies the routed midpoint through the existing canvas
  model test harness. No document mutation, URL, API, or visual interaction
  contract changed.
- Validation: focused canvas model/reference tests passed (85/85),
  `npm run typecheck` passed, full `npm run check` passed (1854 tests passed,
  2 skipped; production build succeeded), and `git diff --check` passed.

### Stage 5 canvas file input classification checkpoint (2026-10-07)

- `lib/canvas/file-input.ts` now owns external file-transfer detection and the
  text/audio file classification predicates used by canvas drop, reference,
  reuse, and audio flows.
- `CanvasWorkspace.tsx` retains file reading, object URL creation, upload,
  asset registration, and node/document mutations; it imports only the pure
  predicates and no new storage or compatibility path was added.
- `tests/canvas-file-drop.test.mjs` exercises the predicates directly and keeps
  the existing drop-handler behavior assertions for pointer routing and the
  asset fallback.
- Validation: focused file/reference tests passed (10/10), `npm run typecheck`
  passed, full `npm run check` passed (1855 tests passed, 2 skipped; production
  build succeeded), and `git diff --check` passed.

### Stage 6 smart variant dialog checkpoint (2026-10-07)

- `components/canvas/CanvasSmartVariantDialog.tsx` now owns the smart variant modal presentation: portal shell, pointer and keyboard event isolation, source display, editable draft fields, loading/error/busy states, and callback forwarding.
- `CanvasWorkspace.tsx` keeps smart variant request/cancel lifecycle, source session state, plan application, CanvasCore/document mutation, and generation orchestration. It no longer owns the modal JSX or draft field rendering.
- The dialog consumes explicit `SmartVariantSource` and `SmartVariantPlan` contracts and does not introduce a store, repository, API, task state machine, or compatibility layer.
- Behavior tests now exercise the extracted dialog while preserving the existing event-isolation and analysis lifecycle assertions.
- Validation: focused smart variant and clone UI tests passed (35/35); `npm run typecheck` passed; full `npm run check` passed (1855 tests passed, 2 skipped; production build succeeded); and `git diff --check` passed.
- Remaining risk: smart variant request and apply orchestration remain in `CanvasWorkspace.tsx`; extracting them safely requires a stable application boundary and broader lifecycle coverage.

### Stage 6 canvas context menu layer checkpoint (2026-10-07)

- `components/canvas/CanvasContextMenuLayer.tsx` now owns the conditional composition of node, group, create, and tools context-menu presentations.
- `CanvasWorkspace.tsx` retains context-menu state, menu group construction, CanvasCore actions, and all callbacks. It now passes an explicit presentation contract to the layer instead of embedding four render branches.
- The layer depends only on existing menu components and canvas contracts; it adds no state store, API boundary, repository, task runtime, or compatibility path.
- Context-menu behavior tests continue to cover node/group action construction, blank-canvas actions, event isolation, and responsive placement; the contract assertion now follows the extracted `nodeGroups` prop.
- Validation: focused context-menu, gesture, and editor-layout tests passed (33/33); `npm run typecheck` passed; full `npm run check` passed (1855 tests passed, 2 skipped; production build succeeded); and `git diff --check` passed.
- Remaining risk: menu action builders and context-menu state remain intentionally in `CanvasWorkspace.tsx`; moving them would couple the presentation layer to document mutation and requires a separate application contract.

### Stage 6 agent selection push presentation checkpoint (2026-10-07)

- `components/AgentSelectionPush.tsx` now owns the floating action bar shown after selecting assistant text, including placement classes, image/video handoff controls, disabled video state, and icon presentation.
- `app/page.tsx` retains selection capture, `selectionPush` state, prompt mutation, navigation, model availability checks, notifications, and duration propagation. It now supplies an explicit presentation contract and callbacks.
- No API, task runtime, conversation state, or duplicate routing logic was introduced. Existing CSS classes and callback behavior remain unchanged.
- Behavior coverage is colocated with the existing `agent-message-selection-bar` behavior test using transpile-and-execute; no new source-layout test was added.
- Validation: focused selection, composer, and one-take tests passed (12/12); `npm run typecheck` passed; full `npm run check` passed (1857 tests passed, 2 skipped; production build succeeded); and `git diff --check` passed.
- Remaining risk: the page still owns the full Agent message rendering and request lifecycle; extracting those safely requires larger interaction contracts and is outside this small slice.

### Stage 6 agent selection push CSS boundary checkpoint (2026-10-07)

- `app/agent-selection-push.css` now owns the selected-text handoff bar's feature styles: fixed placement, above/below transforms, image/video groups, responsive button layout, and reduced-motion behavior.
- `app/globals.css` no longer carries those feature-specific rules; shared message and global surface styles remain unchanged. `app/layout.tsx` loads the feature sheet after the shared Agent styles, preserving cascade order. Existing `shadow-tuning.css` continues to provide the later shadow override.
- The new stylesheet has no state, API, or data dependencies. URL, interaction, visual class names, and page callbacks are unchanged.
- Validation: focused selection and CSS contract tests passed (5/5); `npm run typecheck` passed; full `npm run check` passed (1858 tests passed, 2 skipped; production build succeeded); and `git diff --check` passed.
- Remaining risk: `app/globals.css` still contains large legacy page and editor domains. Moving those safely requires domain-specific style contracts and visual coverage, especially for the complex image editor and provider settings forms.

### Stage 6 provider list presentation checkpoint (2026-10-07)

- `components/ProviderList.tsx` now owns the generic provider-card list presentation: provider identity/status, model-library toggle, editing badge, and manual/edit/sync/delete action buttons.
- `app/page.tsx` keeps provider filtering, first-run gating, API calls, confirmation state, navigation, model synchronization, and the provider form modal. The list receives an explicit data and callback contract and does not access repositories, HTTP endpoints, or provider SDKs.
- Existing provider records, labels, classes, button states, URLs, API payloads, and user flow remain unchanged. No second provider type, store, repository, compatibility layer, or source of truth was added.
- Behavior coverage renders the extracted list and invokes each callback through the contract; the existing first-run provider tests remain at the page boundary.
- Validation: focused provider/Jimeng/theme tests passed (10/10), `npm run typecheck` passed, full `npm run check` passed (1859 tests passed, 2 skipped; production build succeeded), and `git diff --check` passed.
- Remaining risk: provider form, Jimeng login, and Upscale connection panels remain in `app/page.tsx`; moving them safely requires preserving their coupled API and pointer/modal lifecycle contracts.

### Stage 6 provider platform picker checkpoint (2026-10-07)

- `components/ProviderPlatformPicker.tsx` now owns the provider preset cards, selected state presentation, recommendation/address hints, and API Key links.
- `app/page.tsx` keeps provider preset application, draft state, and all connection/test behavior; the picker only emits the selected platform.
- Existing preset ordering, labels, links, classes, URL targets, and selection behavior remain unchanged. No provider state, API boundary, duplicate contract, or compatibility layer was added.
- Behavior coverage renders the picker and invokes its selection callback, while the existing first-run provider tests remain at the page boundary.
- Validation: focused provider behavior tests passed (36/36), `npm run typecheck` passed, full `npm run check` passed (1860 tests passed, 2 skipped; production build succeeded), and `git diff --check` passed.
- Remaining risk: the provider form fields and Jimeng configuration remain coupled to page-owned draft and API lifecycle and are intentionally not moved in this slice.

### Stage 6 provider list toolbar checkpoint (2026-10-07)

- `components/ProviderListToolbar.tsx` now owns the provider search input, clear action, search icon, and visible/total count presentation.
- `app/page.tsx` keeps the search value and `visibleProviders` filtering projection; the toolbar only emits text changes.
- Existing classes, labels, counts, clear behavior, and filtering semantics remain unchanged. No API, provider state, repository, or compatibility layer was introduced.
- Behavior coverage renders the toolbar and invokes both search and clear callbacks through its contract.
- Validation: focused provider tests passed (6/6), `npm run typecheck` passed, full `npm run check` passed (1861 tests passed, 2 skipped; production build succeeded), and `git diff --check` passed.
- Remaining risk: the provider form fields and Jimeng configuration remain coupled to page-owned draft and API lifecycle and are intentionally not moved in this slice.

### Stage 6 provider preset summary checkpoint (2026-10-07)

- `components/ProviderPresetSummary.tsx` now owns the selected preset's automatic-configuration note, descriptive notice, and API Key link presentation.
- `app/page.tsx` keeps preset selection and draft state; the summary receives the existing `ProviderPreset` and display icon only.
- Existing labels, CSS classes, URL target, notice tone, and selection behavior remain unchanged. No new state, API, contract source, or compatibility path was added.
- Behavior coverage renders the summary with a representative provider preset and verifies its notice and key link.
- Validation: focused provider tests passed (38/38), `npm run typecheck` passed, full `npm run check` passed (1862 tests passed, 2 skipped; production build succeeded), and `git diff --check` passed.
- Remaining risk: provider fields, Agnes-specific edit guidance, and Jimeng login remain attached to the page-owned draft and connection lifecycle.

### Stage 6 provider connection fields checkpoint (2026-10-07)

- `components/ProviderConnectionFields.tsx` now owns the active Provider connection field presentation: name, editable/fixed API address, API Key input, and Agnes connection guide composition.
- `app/page.tsx` keeps the Provider draft, test-result clearing, preset application, saved-provider lookup, and all API/Jimeng lifecycle behavior; the component only emits controlled field changes and the existing Agnes endpoint action.
- Existing labels, field names, placeholders, classes, Agnes guide inputs, and hidden video configuration remain unchanged. No Provider store, API client, duplicate type authority, or compatibility layer was introduced.
- Behavior coverage verifies controlled name/key changes, fixed-address presentation, and Agnes callback forwarding.
- Validation: focused provider tests passed (8/8), `npm run typecheck` passed, full `npm run check` passed (1863 tests passed, 2 skipped; production build succeeded), and `git diff --check` passed.
- Remaining risk: the hidden video configuration and Jimeng login block remain in the page because their future activation and task lifecycle are coupled to page-owned state.

### Stage 6 provider list CSS boundary checkpoint (2026-10-07)

- `app/provider-library.css` now owns the provider registry toolbar, search field,
  result count, empty state, and responsive rules. `app/globals.css` no longer
  carries those provider-list selectors.
- `app/layout.tsx` already loaded the feature sheet after `globals.css`, so the
  existing selector order and cascade remain unchanged. No class names, layout
  values, interaction behavior, or provider lifecycle code changed.
- Validation: focused provider, onboarding, and theme tests passed (12/12);
  `npm run typecheck` passed; full `npm run check` passed (1863 passed,
  2 skipped; production build succeeded); and `git diff --check` passed.
- Remaining risk: provider form, Jimeng login, and hidden video configuration
  remain coupled to page-owned draft and connection lifecycle.

### Stage 6 SuperCanvas shell CSS boundary checkpoint (2026-10-07)

- `app/super-canvas.css` now owns the SuperCanvas entry button, shell toolbar,
  placeholder, zoom controls, responsive rules, and reduced-motion rules that
  were previously embedded in `app/globals.css`.
- `app/layout.tsx` loads the feature sheet immediately after `globals.css`.
  Existing class names, cascade order relative to the later `shadow-tuning.css`,
  URL behavior, and CanvasWorkspace ownership are unchanged.
- No new state, store, API boundary, contract, or compatibility path was added.
- Validation: focused canvas appearance, workspace shell/topbar, and theme tests
  passed (6/6); `npm run typecheck` passed; full `npm run check` passed (1863
  passed, 2 skipped; production build succeeded); and `git diff --check` passed.
- Remaining risk: CanvasWorkspace still owns the live canvas document,
  selection, history, and interaction orchestration; this slice only moves the
  stable shell presentation styles.

### Stage 6 ModelPicker tooltip CSS boundary checkpoint (2026-10-07)

- `app/model-picker.css` now owns the ModelPicker trigger tooltip positioning,
  visibility, focus/hover transition, and Agent composer reverse placement.
- The ModelPicker panel, dialog, page-level model library rules, canvas-specific
  tooltip overrides, and z-index contracts remain in their existing stylesheets
  because they intentionally cross feature and overlay boundaries.
- `app/layout.tsx` loads the feature sheet immediately after `globals.css`; the
  extracted rules are byte-identical to the previous block, preserving cascade,
  URL behavior, and interaction semantics.
- No state, API, model registry, duplicate contract, or compatibility layer was
  introduced.
- Validation: focused ModelPicker, canvas tooltip, and Agent editor tests
  passed (68/68); `npm run typecheck` passed; full `npm run check` passed
  (1863 passed, 2 skipped; production build succeeded); and `git diff --check`
  passed.
- Remaining risk: the ModelPicker base panel and model-library page styles remain
  in `globals.css` because they are shared by quick picker, dialog, canvas, and
  page-level model management flows.

### Stage 6 OneTake duration CSS boundary checkpoint (2026-10-07)

- `app/one-take-duration.css` now owns the OneTake duration popover, input,
  validation message, actions, and mobile placement rules.
- `app/globals.css` retains only the shared `.agent-quick-actions` positioning;
  Canvas-specific placement overrides remain in `app/canvas.css`.
- Existing classes, controlled form behavior, keyboard handling, and visual
  tokens are unchanged. No state, API, task runtime, or compatibility layer was
  added.
- Validation: focused OneTake, canvas editor, and theme tests passed (66/66);
  `npm run typecheck` passed; full `npm run check` passed (1863 passed,
  2 skipped; production build succeeded); and `git diff --check` passed.
- Remaining risk: the Agent composer still shares global layout rules with
  several quick actions, so only the isolated duration surface moved here.

### Stage 6 canvas viewport projection checkpoint (2026-10-07)

- `lib/canvas/viewport.ts` now owns the pure client-to-stage, stage-to-world,
  and world-to-stage coordinate projections used by the canvas UI.
- `CanvasWorkspace.tsx` retains the stage DOM measurement, pointer lifecycle,
  camera state, and all document/selection mutations. It now delegates the
  coordinate formulas to the projection module instead of duplicating them in
  callbacks.
- `CanvasCore` remains the sole owner of the camera/document state. The new
  module has no React, API, storage, task, or compatibility dependencies.
- Behavior coverage verifies stage offsets, zoomed world projection, and the
  inverse transform.
- Validation: focused viewport and canvas model tests passed; full typecheck,
  `npm run check`, production build, and `git diff --check` are required before
  this slice is committed.
