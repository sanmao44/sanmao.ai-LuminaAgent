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
