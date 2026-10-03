# Architecture Convergence Audit II

鏈疆鐩爣鏄畬鎴?Canvas Document / Selection authority 杩佺Щ锛屽苟璁板綍鍏ㄥ眬鏋舵瀯鐪熷疄鐘舵€併€傜姸鎬佽瘝鍙娇鐢細`vertical slice completed`銆乣migration in progress`銆乣cutover completed`銆乣legacy removed`銆?

## Migration Matrix

| Domain | Legacy responsibilities | Migration adapter | Next Core / Contract | Real production path | Authoritative owner | Remaining dual track | Contract bypass | Status | Next action | Legacy delete condition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Agent | Route auth/context/streaming/provider and compatibility orchestration | `lib/agent/runtime.ts` | `packages/agent-core/runtime.ts`, agent contracts | compact non-streaming text uses AgentRuntime; remaining capabilities use Route | split by capability between Route and AgentRuntime | AgentRun/route lifecycle split by capability | Route still directly coordinates provider, streaming, artifact, browser and filesystem | migration in progress | establish Application Service and migrate observable/streaming behavior | all Agent capabilities use Application/Runtime; Route retains transport only |
| Tool / MCP | Route compatibility entry, `lib/tools`, `lib/mcp` | `packages/tool-runtime/adapter.ts`, `mcp-executor.ts` | `packages/tool-runtime/runtime.ts`, `tool-loop.ts` | core Native/MCP policy, dispatch, loop, errors and approval resume use Tool Runtime | tool execution = `packages/tool-runtime`; HTTP/stream transport = Route | adapter and approval transport compatibility remain | Route still owns surrounding approval/stream orchestration | migration in progress | converge adapter ports; move remaining approval/streaming glue | all callers use stable Runtime ports; adapter no longer carries compatibility rules |
| Provider | `lib/providers.ts`, Route routing/failover/streaming/media | `lib/provider-runtime/chat.ts` | Model Runtime and model contracts | compact non-streaming Agent path uses ModelRuntime | Provider registry and Route branches by capability | ModelRuntime and direct provider callers coexist | Route imports provider implementation and owns routing/failover | migration in progress | capability based routing, then streaming/media | Route no longer owns provider rules or imports provider transport |
| Task | video/upscale/clone/progress status and polling | task repositories and wire status adapters | `packages/task-runtime/runtime.ts`, task contracts | video/upscale CRUD uses repositories; some cancellation/retry decisions use TaskRuntime | Legacy stores/API wire states by task family | unified TaskState coexists with specialized status/polling | clone/progress/polling bypass common Task application port | migration in progress | move clone/progress/polling to common application ports | long tasks share TaskRuntime state and persistence boundary |
| Storage | IndexedDB, localStorage, JSON, filesystem, `.data`, domain stores | `lib/repositories/*`, `lib/database/sqlite.ts` | storage contracts | server workspace/provider/MCP/task paths use repositories and SQLite after marker activation; client workspace uses the canonical backup snapshot | SQLite is authoritative after cutover; JSON/IndexedDB/filesystem remain migration, compatibility or blob adapters | UI preferences, client history and media/artifact roots coexist with explicit owners | direct client/blob adapters remain bounded and documented | cutover completed | migrate remaining client/blob adapters when behavior coverage exists | all remaining direct paths are adapter internals or compatibility-only |
| Canvas Document | SuperCanvas persistence/gesture/UI compatibility | `useSyncExternalStore` projection; `setDoc`/`replaceDoc` Core adapters | `packages/canvas-core/runtime.ts` | UI, Agent patch, restore/load and background reconciliation call Core `apply/replace` | `CanvasCore.document()` | none for document authority; React is a read projection | persistence still enters through SuperCanvas adapter | cutover completed | remove mutation adapter names and move persistence behind a port | SuperCanvas consumes snapshots; writes arrive as Core commands |
| Canvas History | React `undoStack/redoStack` removed | `setHistoryVersion` render tick | `CanvasCore.past/future` | commit, undo, redo and record use Core | `CanvasCore.history()` | none | no history bypass found in current mutation path | cutover completed | retain nested snapshot regression coverage | no React history state returns; persistence history is a separate future concern |
| Canvas Selection | React selection state machine removed | selection setter functions call Core; `useSyncExternalStore` projection | `CanvasCore.selection()` | node/group/edge selection and invalidation after edits use Core | `CanvasCore.selection()` | none for domain selection; transient hover/marquee/gesture remain UI local | legacy callsites use Core setter adapters, not a second owner | cutover completed | replace setter adapters with explicit command names | all selection writes use Core commands directly |
| UI | `app/page.tsx` composition, feature state and callbacks | WorkspaceShell, MainColumn, presentation components | component boundaries; application layer remains future | shell/sidebar/Agent presentation components are rendered in production | `app/page.tsx` remains state/composition owner | extracted components coexist with page-owned feature state | page directly performs several domain actions | migration in progress | extract callbacks after domain boundaries stabilize | page is composition only |
| Backup / Restore | backup API, local snapshots, filesystem archive implementation | `lib/backup-archive.ts`, `lib/backup-restore-transaction.ts`, `lib/backup-application-service.ts`, snapshot helpers | manifest schema v1; canonical `client/client.json`; streaming tar extraction | `/api/backup/archive` delegates export and restore to the application service; HTTP upload is staged to disk; production export archives and encrypts through staging files, while v1 decryption and tar extraction stream to staging files; multi-root restore has durable journal rollback; legacy JSON restore also uses the same staged transaction; browser restore captures a repository snapshot and rolls back on later failure | application service owns backup use-case orchestration; SQLite marker and legacy rollback tree define cutover | local snapshots still materialize selected entries; compatibility Buffer APIs remain for local snapshot and older callers | `/api/backup/archive` retains protocol/auth/runtime transport concerns only | cutover completed | remove compatibility Buffer APIs and browser IndexedDB adapter after behavior coverage and zero callers | staged validation, journal recovery, multi-root failure injection, and client restore rollback are service-owned |

## Canvas Authority Result

- Document锛?*cutover completed**銆俙CanvasCore.document()` 鏄敮涓€ authoritative document銆係uperCanvas 鐨?`document` 鏄?`useSyncExternalStore` projection锛涗笉鍐嶅瓨鍦?`docRef` 鎴?React `setDocument` 鍐欒矾寰勩€?
- History锛?*cutover completed**銆侰ore 淇濆瓨鐙珛 snapshot锛宯ested node data銆乶odes銆乪dges銆乬roups 涓嶄細琚悗缁?mutation 姹℃煋銆?
- Selection锛?*cutover completed**銆侰ore 鎸佹湁 node/group/edge selection锛宒ocument mutation銆乽ndo銆乺edo銆乺eplace 鍚庝細娓呯悊鏃犳晥 selection锛汻eact 鍙秷璐?projection銆?
- Agent/UI/restore锛氶兘閫氳繃 Core `apply` 鎴?`replace`銆傛病鏈?React direct document write path銆?

## Feature Regression Baseline

| Feature | Existing automated test | Manual verification if needed | Known coverage gap |
| --- | --- | --- | --- |
| Agent | `tests/agent-execution.test.mjs`, routing/cancel/continuation tests | stream cancellation and provider failover | 閮ㄥ垎 Route/source-coupled coverage |
| Tool / MCP | `tests/tools-registry.test.mjs`, `tests/tools-dispatch.test.mjs`, `tests/mcp*.test.mjs` | real remote MCP smoke when credentials exist | adapter seam remains |
| Canvas editing | `tests/canvas-model.test.mjs`銆丆anvas interaction/editor tests | pointer gesture smoke | SuperCanvas UI structure tests remain |
| Document | `tests/canvas-core.test.mjs`, `tests/canvas-model.test.mjs` | restore a saved workspace | React projection integration is bounded |
| Selection | `tests/canvas-core.test.mjs`, Canvas interaction tests | group/edge selection smoke | selection command API can be made more explicit |
| Undo / Redo | `tests/canvas-core.test.mjs` | long sequential edit smoke | history is in-memory until persistence slice |
| Agent Canvas Patch | `tests/canvas-patch.test.mjs`, `tests/canvas-core.test.mjs` | patch against selected target | full dock-to-Core integration is limited |
| Workspace persistence | workspace/storage tests | restore after restart | persistence owner remains legacy |
| Task lifecycle | `tests/task-runtime.test.mjs`, video/task tests | cancel/retry in UI | clone/progress still specialized |
| Provider execution | provider compatibility/video provider tests | configured provider smoke | routing/failover still legacy |
| Backup / Restore | backup API, local snapshots, filesystem archive implementation | `lib/backup-archive.ts`, `lib/backup-restore-transaction.ts`, `lib/backup-application-service.ts`, snapshot helpers | manifest schema v1; canonical `client/client.json`; streaming tar extraction | `/api/backup/archive` delegates export and restore to the application service; HTTP upload is staged to disk; production export archives and encrypts through staging files, while v1 decryption and tar extraction stream to staging files; multi-root restore has durable journal rollback; legacy JSON restore also uses the same staged transaction; browser restore captures a repository snapshot and rolls back on later failure | application service owns backup use-case orchestration; SQLite marker and legacy rollback tree define cutover | local snapshots still materialize selected entries; compatibility Buffer APIs remain for local snapshot and older callers | `/api/backup/archive` retains protocol/auth/runtime transport concerns only | cutover completed | remove compatibility Buffer APIs and browser IndexedDB adapter after behavior coverage and zero callers | staged validation, journal recovery, multi-root failure injection, and client restore rollback are service-owned |

## Source-Coupled Tests Remaining

鏈疆鍙Щ闄や簡浼氶樆纰?Document銆丼election銆丠istory correctness 鐨?`docRef`/React-authority 鏂█銆侫gent streaming銆乤rtifact銆乸rovider銆乥ackup銆侀儴鍒?UI presentation 鐨勬簮鐮佹柇瑷€浠嶄繚鐣欙紝绛夊緟瀵瑰簲琛屼负瑕嗙洊鍚庡啀杩佺Щ銆?

## Data Architecture Audit Result

- Storage: **cutover completed for server business data**. Workspace, provider
  state, MCP configuration and task records resolve through repositories; JSON
  files remain migration, rollback or legacy importer inputs. Browser storage
  and media/artifact roots remain compatibility adapters.
- Backup / Restore: **cutover completed**. Full restore validates manifest and
  checksums, stages archive entries on disk, uses a durable multi-root rollback
  journal, and swaps a staged SQLite image when the database marker is active.
  Legacy JSON restore and browser IndexedDB restore now use the same recovery
  boundary. Automatic snapshots record schema v1 and skipped media counts.
- Database: **cutover completed**. SQLite `node:sqlite` is the local authority;
  migration has a durable journal, idempotent marker fence, rollback source
  capture and an explicit rollback command. PostgreSQL is future cloud work.

## Audit Boundary

本轮已完成 Storage repository 收口、Backup/Restore 文件级 rollback hardening、canonical workspace schema、restore tar 流式解析、backup application service、导出端磁盘文件流、HTTP restore 临时文件流式解密与磁盘 staging、staged commit journal、Database Cutover 以及多物理根故障注入验证。Provider 重构、Tool Runtime 第二轮大拆、SuperCanvas presentation 大拆和前后端物理拆分不属于本轮。

`packages/tool-runtime/adapter.ts` 浠嶆槸 migration adapter锛涘垹闄ゆ潯浠舵槸鎵€鏈?Route/approval resume 璋冪敤鏀圭敤绋冲畾 Tool Runtime ports锛屼笖 adapter 涓嶅啀鎵胯浇鍏煎涓氬姟瑙勫垯銆?

瀹¤鏃ユ湡锛?026-10-02
