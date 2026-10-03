# Architecture Convergence Audit II

本轮目标是完成 Canvas Document / Selection authority 迁移，并记录全局架构真实状态。状态词只使用：`vertical slice completed`、`migration in progress`、`cutover completed`、`legacy removed`。

## Migration Matrix

| Domain | Legacy responsibilities | Migration adapter | Next Core / Contract | Real production path | Authoritative owner | Remaining dual track | Contract bypass | Status | Next action | Legacy delete condition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Agent | Route auth/context/streaming/provider and compatibility orchestration | `lib/agent/runtime.ts` | `packages/agent-core/runtime.ts`, agent contracts | compact non-streaming text uses AgentRuntime; remaining capabilities use Route | split by capability between Route and AgentRuntime | AgentRun/route lifecycle split by capability | Route still directly coordinates provider, streaming, artifact, browser and filesystem | migration in progress | establish Application Service and migrate observable/streaming behavior | all Agent capabilities use Application/Runtime; Route retains transport only |
| Tool / MCP | Route compatibility entry, `lib/tools`, `lib/mcp` | `packages/tool-runtime/adapter.ts`, `mcp-executor.ts` | `packages/tool-runtime/runtime.ts`, `tool-loop.ts` | core Native/MCP policy, dispatch, loop, errors and approval resume use Tool Runtime | tool execution = `packages/tool-runtime`; HTTP/stream transport = Route | adapter and approval transport compatibility remain | Route still owns surrounding approval/stream orchestration | migration in progress | converge adapter ports; move remaining approval/streaming glue | all callers use stable Runtime ports; adapter no longer carries compatibility rules |
| Provider | `lib/providers.ts`, Route routing/failover/streaming/media | `lib/provider-runtime/chat.ts` | Model Runtime and model contracts | compact non-streaming Agent path uses ModelRuntime | Provider registry and Route branches by capability | ModelRuntime and direct provider callers coexist | Route imports provider implementation and owns routing/failover | migration in progress | capability based routing, then streaming/media | Route no longer owns provider rules or imports provider transport |
| Task | video/upscale/clone/progress status and polling | task repositories and wire status adapters | `packages/task-runtime/runtime.ts`, task contracts | video/upscale CRUD uses repositories; some cancellation/retry decisions use TaskRuntime | Legacy stores/API wire states by task family | unified TaskState coexists with specialized status/polling | clone/progress/polling bypass common Task application port | migration in progress | move clone/progress/polling to common application ports | long tasks share TaskRuntime state and persistence boundary |
| Storage | IndexedDB, localStorage, JSON, filesystem, `.data`, domain stores | `lib/repositories/*`, `lib/backup-restore-transaction.ts` | storage contracts | conversation, workspace gallery, asset index/collections, video/upscale/clone/progress task paths use repositories | legacy adapters remain physical persistence truth | direct UI preference, media/artifact/MCP paths coexist | workspace sync internals and several UI/storage modules still know concrete stores | migration in progress | finish remaining direct callers, then choose DB adapter | no business caller depends on concrete storage and every owner has a stable port |
| Canvas Document | SuperCanvas persistence/gesture/UI compatibility | `useSyncExternalStore` projection; `setDoc`/`replaceDoc` Core adapters | `packages/canvas-core/runtime.ts` | UI, Agent patch, restore/load and background reconciliation call Core `apply/replace` | `CanvasCore.document()` | none for document authority; React is a read projection | persistence still enters through SuperCanvas adapter | cutover completed | remove mutation adapter names and move persistence behind a port | SuperCanvas consumes snapshots; writes arrive as Core commands |
| Canvas History | React `undoStack/redoStack` removed | `setHistoryVersion` render tick | `CanvasCore.past/future` | commit, undo, redo and record use Core | `CanvasCore.history()` | none | no history bypass found in current mutation path | cutover completed | retain nested snapshot regression coverage | no React history state returns; persistence history is a separate future concern |
| Canvas Selection | React selection state machine removed | selection setter functions call Core; `useSyncExternalStore` projection | `CanvasCore.selection()` | node/group/edge selection and invalidation after edits use Core | `CanvasCore.selection()` | none for domain selection; transient hover/marquee/gesture remain UI local | legacy callsites use Core setter adapters, not a second owner | cutover completed | replace setter adapters with explicit command names | all selection writes use Core commands directly |
| UI | `app/page.tsx` composition, feature state and callbacks | WorkspaceShell, MainColumn, presentation components | component boundaries; application layer remains future | shell/sidebar/Agent presentation components are rendered in production | `app/page.tsx` remains state/composition owner | extracted components coexist with page-owned feature state | page directly performs several domain actions | migration in progress | extract callbacks after domain boundaries stabilize | page is composition only |
| Backup / Restore | backup API, local snapshots, filesystem archive implementation | `lib/backup-archive.ts`, `lib/backup-restore-transaction.ts`, `lib/backup-application-service.ts`, snapshot helpers | manifest schema v1; canonical `client/client.json`; streaming tar extraction | `/api/backup/archive` delegates export and restore to the application service; HTTP upload is staged to disk; v1 decryption and tar extraction stream to staging files; restore uses file-level rollback and recovery journal | Legacy filesystem remains physical persistence truth; application service owns backup use-case orchestration | local snapshots still materialize selected entries; compatibility Buffer APIs remain for local snapshot and older callers | `/api/backup/archive` retains protocol/auth/runtime transport concerns only | migration in progress | add staged-tree atomic cutover semantics | staged validation, journal recovery and cutover are service-owned; legacy route only transports |

## Canvas Authority Result

- Document：**cutover completed**。`CanvasCore.document()` 是唯一 authoritative document。SuperCanvas 的 `document` 是 `useSyncExternalStore` projection；不再存在 `docRef` 或 React `setDocument` 写路径。
- History：**cutover completed**。Core 保存独立 snapshot，nested node data、nodes、edges、groups 不会被后续 mutation 污染。
- Selection：**cutover completed**。Core 持有 node/group/edge selection，document mutation、undo、redo、replace 后会清理无效 selection；React 只消费 projection。
- Agent/UI/restore：都通过 Core `apply` 或 `replace`。没有 React direct document write path。

## Feature Regression Baseline

| Feature | Existing automated test | Manual verification if needed | Known coverage gap |
| --- | --- | --- | --- |
| Agent | `tests/agent-execution.test.mjs`, routing/cancel/continuation tests | stream cancellation and provider failover | 部分 Route/source-coupled coverage |
| Tool / MCP | `tests/tools-registry.test.mjs`, `tests/tools-dispatch.test.mjs`, `tests/mcp*.test.mjs` | real remote MCP smoke when credentials exist | adapter seam remains |
| Canvas editing | `tests/canvas-model.test.mjs`、Canvas interaction/editor tests | pointer gesture smoke | SuperCanvas UI structure tests remain |
| Document | `tests/canvas-core.test.mjs`, `tests/canvas-model.test.mjs` | restore a saved workspace | React projection integration is bounded |
| Selection | `tests/canvas-core.test.mjs`, Canvas interaction tests | group/edge selection smoke | selection command API can be made more explicit |
| Undo / Redo | `tests/canvas-core.test.mjs` | long sequential edit smoke | history is in-memory until persistence slice |
| Agent Canvas Patch | `tests/canvas-patch.test.mjs`, `tests/canvas-core.test.mjs` | patch against selected target | full dock-to-Core integration is limited |
| Workspace persistence | workspace/storage tests | restore after restart | persistence owner remains legacy |
| Task lifecycle | `tests/task-runtime.test.mjs`, video/task tests | cancel/retry in UI | clone/progress still specialized |
| Provider execution | provider compatibility/video provider tests | configured provider smoke | routing/failover still legacy |
| Backup / Restore | `tests/backup-archive.test.mjs`, `tests/backup-archive-file-source.test.mjs`, `tests/backup-crypto.test.mjs`, `tests/backup-restore-transaction.test.mjs`, snapshot tests | encrypted archive round trip, disk-backed archive source, streaming decryption, staging and journal recovery | full staged-tree validation and atomic cutover remain |

## Source-Coupled Tests Remaining

本轮只移除了会阻碍 Document、Selection、History correctness 的 `docRef`/React-authority 断言。Agent streaming、artifact、provider、backup、部分 UI presentation 的源码断言仍保留，等待对应行为覆盖后再迁移。

## Audit Boundary

本轮完成 Storage repository 扩展、Backup/Restore 文件级 rollback hardening、canonical workspace schema、restore tar 的流式解析、备份 application service、导出端磁盘文件流，以及 HTTP restore 的临时文件、流式解密和磁盘 staging；未完成 crash journal、staged-tree atomic cutover 或 Database Cutover，也未执行 Provider 大重构、Tool Runtime 第二轮大拆、SuperCanvas presentation 大拆或前后端物理拆分。

`packages/tool-runtime/adapter.ts` 仍是 migration adapter；删除条件是所有 Route/approval resume 调用改用稳定 Tool Runtime ports，且 adapter 不再承载兼容业务规则。

审计日期：2026-10-02
