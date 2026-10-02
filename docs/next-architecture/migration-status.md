# Architecture Convergence Audit

## Round 9 — Canvas Core Phase II — History Authority Cutover

本轮推进 Canvas Core Phase II，只切换 History Authority；不改变 document editing、undo/redo、selection、Agent Canvas Patch、持久化或 UI 行为。Document 与 Selection authority 仍按后续切片迁移。

### 本轮真实切换

- **Document Authority**：migration in progress。`CanvasCore` 已承载 Core mutation/history，但 `SuperCanvas` 仍保留 document projection、restore、持久化和部分 legacy `updateDoc` 入口。
- **History Authority**：**cutover completed**。`CanvasCore.past/future` 是唯一 authoritative history；React `undoStack/redoStack` state machine 已删除，UI 只读取 Core history projection，并通过 Core `undo/redo/record`。
- **Selection Authority**：migration in progress。`CanvasCore.selection` 已存在，但 React `selectedIds`/group/edge 仍是当前交互和渲染 projection owner，尚未完成 domain selection cutover。
- `packages/tool-runtime/adapter.ts` 仍为 migration adapter，保留明确兼容 seam，未宣称 legacy removed。

### History 调用核对

`commit`、Agent Canvas Patch、拖拽/缩放/排列等现有 history boundary 均通过 `CanvasCore.record/apply`；项目切换、恢复和新建通过 `CanvasCore.replace(..., { clearHistory: true })` 清空历史。React 仅保留 render tick，删除对应 state machine 后 Core 仍可独立执行 commit、undo、redo、redo invalidation 和 history boundary。
### 已转换为行为覆盖

- `tests/tools-registry.test.mjs`：工具注册、门控、schema、权限、能力标签到执行类别的行为。
- `tests/tools-dispatch.test.mjs`：MCP 写入策略、取消语义、工具循环续轮、reasoning 字段、非法参数兜底。
- `tests/mcp*.test.mjs`：MCP discovery、配置/管理、filesystem/browser download、runtime admin、协议调用与审计落盘行为。
- 新增 `lib/tools/call-arguments.ts` 作为最小参数归一化 seam；`route.ts` 与测试构建器共用它。

保留了 `tests/agent-execution.test.mjs` 等真实 TS 转译后执行测试，没有删除真实行为覆盖。

### 仍会阻碍下一轮迁移的测试

Agent 的 streaming、artifact、approval、image safety、cancel、canvas/UI 以及部分 route integration 测试仍读取固定文件并断言源码结构。这些测试不属于本轮 Tool/MCP 最小 seam，需在对应行为覆盖建立后逐类迁移。当前 Tool/MCP 目标测试已不再依赖 `app/api/agent/route.ts` 的源码文本，且无 skipped 的 MCP/Tool 测试。

### 边界记录

- Tool execution orchestration 的 Source of Truth 已切换为 `packages/tool-runtime`；`lib/tools/*`、`lib/mcp/*` 和 approval state 仍是能力与持久化边界。
- `call-arguments.ts` 的参数归一化已由 Tool Runtime 统一调用；删除条件是稳定 Contract 覆盖同等行为并移除全部调用者。
- Phase 6 Tool Runtime 已进入迁移：`packages/tool-runtime/runtime.ts`、`tool-loop.ts`、`adapter.ts` 与 `mcp-executor.ts` 已接入真实 Agent Route；下一步是拆分 adapter 依赖并逐步退出 Route 的审批/streaming 兼容职责。

> 审计日期：2026-09-30  
> 范围：核对已建立的 Contract、Adapter 与 Next Core 是否进入真实调用链，并记录仍然存在的双轨状态。  
> 本轮只更新架构记录，不改变产品行为、不新增运行时依赖、不删除 Legacy。

## 结论摘要

前六轮已经建立了可运行的最小边界，并且每个已声明的纵向切片都至少有一条真实调用路径。它们还不是全量迁移：HTTP Route、页面组合根、Canvas React 状态、Provider 路由和 Tool/MCP 编排仍保留在 Legacy。当前可以安全继续推进的顺序是先收敛测试与 Tool Runtime 边界，再分别推进 Canvas 和页面的 Source of Truth 收敛。

## 迁移矩阵

| Domain | Legacy | Adapter | Next Core / Contract | Real path | Source of Truth | Dual track | Contract bypass | Next action | Delete condition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Agent | `app/api/agent/route.ts` 的鉴权、上下文归一化、intent、模型选择、工具循环、流式与序列化 | `lib/agent/runtime.ts` 导出适配；Route 注入上下文、策略和模型调用闭包 | `packages/contracts/agent.ts`、`packages/agent-core/runtime.ts` | 紧凑、非流式、纯文本 Agent 请求通过 `AgentRuntime` | 本路径的请求/响应与进度记录仍由 Route 和 Legacy progress 维护 | 纯文本非流式走 Runtime，其余 Agent 能力走 Route | Route 仍直接编排 Provider、Tool、MCP、Browser、Filesystem、Artifact 和 Streaming | 为下一个能力切片定义 Application Service，并把一类可观察行为移入 Runtime | 所有 Agent 路径都有行为覆盖、无 Route 直接编排调用者，且 Adapter 不再被引用 |
| Storage | `client-history`、`workspace`、`.data` JSON、filesystem 和各领域专用 store | `lib/repositories/*`；Task Repository 包装 `createTaskStore` | `packages/contracts/storage.ts` | 页面会话/工作区读写；`/api/state` provider 公共状态；视频和超分任务 CRUD | IndexedDB、localStorage、JSON 文件仍是实际持久化事实来源 | Repository 与直接 Legacy store 并存；Clone、Agent Progress 仍直连 store | `app/api/workspace/route.ts`、artifact/media storage 和 Clone/Progress 仍知道具体存储 | 为 Clone、Agent Progress 和 workspace API 补领域端口，先覆盖调用者再替换 Adapter | 没有业务调用者直接引用具体存储模块，且数据迁移/兼容策略验证完成 |
| Task | 视频、超分、Clone、Agent Progress 的专用状态与服务 | 视频/超分 store 通过 `createTaskRepository`；Clone stage 和 Progress 状态映射 Adapter | `packages/contracts/task.ts`、`packages/task-runtime/runtime.ts` | 视频/超分 refresh、cancel、retry；Clone resume/cancel/idempotency；Agent Progress active 判断 | 各自 Legacy 记录和 API wire status 仍是持久化/对外事实来源 | 统一 TaskState 与领域状态同时存在（如 `done`、`processing`、Clone stages） | Provider polling、retry 创建、progress persistence、generation logs 仍绕过统一 Task Runtime | 定义统一 query/progress/cancellation application port，逐个迁移 polling 与 retry 行为 | 所有长任务共享 Contract，领域 Adapter 无独立状态规则，且 Legacy store 无调用者 |
| Provider | `lib/providers.ts` 传输实现；Route 中的 routing、failover、health、streaming 和 media 分支 | `lib/provider-runtime/chat.ts` 的 Legacy Chat Adapter | `packages/contracts/model.ts`、`ModelRuntime` | 紧凑非流式纯文本 Agent 通过 `createLegacyChatModelRuntime` | Provider registry、Route 选择结果和现有 health 状态仍是事实来源 | 文本单次调用经 ModelRuntime，其余调用仍直接使用 `chatCompletion*` 或媒体 Provider | Route 仍直接 import `lib/providers`，并持有 provider/model 选择与 failover 业务 | 先定义 capability-based routing port，再迁移一条 streaming 或媒体能力 | Agent/Application 层不再 import 具体 Provider 传输 API，且各能力 Adapter 有行为覆盖 |
| Tool / MCP | `app/api/agent/route.ts` 中原有编排、`lib/tools/*`、`lib/mcp/*` | `packages/tool-runtime/adapter.ts` + `mcp-executor.ts` | `packages/tool-runtime/runtime.ts` + `tool-loop.ts` | Route 构造 Runtime；首次执行与 approval resume 共用 Runtime MCP executor | `packages/tool-runtime` 是 Tool execution orchestration 唯一 authoritative owner | Route 仍保留 approval coordination、streaming/context/provider/artifact/browser/image 等兼容边界 | Route 不再直接 dispatch/execute MCP body；adapter 依赖仍是兼容 seam | 继续拆分 adapter ports，并在行为覆盖后移除 Route approval/policy glue | Route 不再包含 tool dispatch/loop/MCP execution orchestration，Legacy 对应实现删除 |
| Canvas | `components/SuperCanvas.tsx` document、selection、viewport、gesture、persistence 与 legacy adapters | `CanvasCore` + `lib/canvas/patch.ts` | `packages/canvas-core/runtime.ts` | commit、Agent Canvas Patch 与 UI history boundary 进入 Core；Core behavior tests 独立于 React | History Authority = CanvasCore；Document / Selection / viewport 仍 migration in progress | React document projection、selection、viewport 仍保留；React undo/redo state machine 已删除 | 大多数 pointer gesture、节点操作、保存仍经过 legacy adapter | 完成 Document Authority，再迁移 Domain Selection | SuperCanvas 只负责 rendering/projection/adapter，domain mutation/history/selection 由 Core 持有 |
| Page / UI | `app/page.tsx` 页面组合根、feature state、业务回调和 section renderer | `WorkspaceShell`、`MainColumn`、topbar、sidebar 与 Agent presentation 组件 | 组件边界已建立；尚无独立 page application core | 根 shell、侧栏和多组 Agent 展示组件已真实渲染 | `app/page.tsx` 仍是状态、数据加载和回调的事实来源 | 已拆出的展示组件与 page 状态/组合逻辑双轨存在 | 页面仍直接拥有 Agent、History、Provider、Canvas 和 workspace 业务动作 | 在领域边界稳定后继续抽取 section application boundary，不以移动文件作为目标 | page 只保留 composition；section state/action 不再由 page 直接实现 |

## Storage 调用核对

视频和超分任务的 CRUD 已经通过 `lib/repositories/task-repository.ts`，具体入口是 `lib/video-task-store.ts` 与 `lib/upscale-task-store.ts`。因此“任务 CRUD 已经过 Task Repository”对这两类任务成立；它不适用于 Clone jobs、Agent Progress 或所有 workspace/artifact/media 存储，这些仍是 Legacy 直连。

## Canvas 调用核对

`SuperCanvas` 创建并同步 `CanvasCore`。本轮已删除 React `undoStack`/`redoStack` state machine，所有 history boundary 和 UI undo/redo 经过 Core；document、selection、viewport 仍是 migration in progress。

## 源码耦合测试审计

测试目录中约有 4,859 条 `readFile`、`assert.match`、`assert.doesNotMatch` 或 `toContain` 相关匹配行，分布在约 217 个测试文件。它们不能在本轮批量删除，需按以下顺序处理：

1. 保留真正验证编译产物、路由导出或稳定结构契约的检查，并标注其边界。
2. 对 Agent、Canvas、Storage、Task、Provider 和 UI 关键路径先补行为测试。
3. 在行为覆盖等价后，移除依赖固定源码文件或实现细节的断言。

当前最集中的文件族是 Agent（51）、Canvas（34）、Task/媒体（25）、UI（19）、Storage（15）和 Provider/Model（12）；这些数字是按文件名分类的审计索引，不代表待删除测试数量。

## 本轮边界与后续顺序

- 本轮不修改数据库、不做物理拆仓，也不进入 Canvas、Storage 或前后端拆分。
- 已完成的 Agent、Storage、Task、Provider、Canvas 和 Page/UI 垂直切片可以继续维护，但其 Legacy 责任仍按上表保留。
- Tool Runtime 已有真实 Native/MCP 路径和行为覆盖；下一步继续拆分 adapter ports，并在测试迁移后退出 Route 的 approval/streaming 兼容职责。
- Canvas Core 和 page/UI 的后续工作必须先解决 Source of Truth，再扩大组件拆分。

## Tool Runtime Consolidation

- **migration in progress**：Tool execution orchestration 的 ownership 已迁入 `packages/tool-runtime`，其余 Route 兼容边界仍在迁移。
- **cutover completed**：policy resolution、参数归一化、dispatch、execution normalization、Tool Loop，以及 approval resume 使用的 MCP executor 已切换到 Runtime。
- **legacy removed**：Route 中原有的 Tool Loop、MCP execution body 和 `executeToolCallUnchecked`/`executeToolCall` 编排已删除；`lib/agent/tool-loop.ts` 仅保留兼容 re-export。
- **route reduction**：`app/api/agent/route.ts` 从 3,158 行降至 2,653 行，移除了 loop、dispatch、execution 和 MCP orchestration 的核心实现。
- **remaining boundary**：Route 仍负责 HTTP/auth/validation、streaming、context、provider routing、approval record/deferred response transport，以及 artifact/image/browser/filesystem/progress/generation-log 兼容逻辑。
- **remaining migration blockers**：`packages/tool-runtime/adapter.ts` 仍是 Route 注入的兼容 seam，后续可按领域拆分 browser/image/artifact ports；`agent-artifacts.test.mjs`、`agent-progress.test.mjs`、`agent-image-safety.test.mjs`、`canvas-agent-dock.test.mjs`、`skills.test.mjs` 仍有 adapter/UI 源码耦合断言，需后续先补行为覆盖再转换。
- **source of truth**：Tool execution orchestration 的唯一 authoritative owner 是 `packages/tool-runtime`；Route 只负责入口、应用协调和传输兼容边界。
