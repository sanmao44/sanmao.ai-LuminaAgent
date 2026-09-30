# Architecture Convergence Audit

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
| Tool / MCP | `lib/tools/registry.ts`、`lib/tools/policy.ts`、`lib/mcp/*` 与 Agent Route 的工具循环 | 当前只有既有 registry/policy/MCP 实现，没有独立统一 Adapter | 尚未形成 `packages/tool-runtime`；仅有 Phase 1 中预留的 Tool Contract 类型 | 仍由 Agent Route 发现、审批、执行和拼接工具结果 | Route 的 tool loop、MCP catalog 和 approval state 仍是事实来源 | Native、MCP、Browser、Filesystem、Artifact 各有执行分支 | Route 直接依赖工具和 MCP 实现，未经过统一 Tool Runtime 生命周期 | 先定义 `discover → resolve → validate → authorize → execute → observe → return` 的统一边界，再接入一类 Native/MCP 工具 | 统一 Runtime 覆盖所有 Tool 来源、Route 无直接执行分支、旧 registry/policy 仅作为 Adapter |
| Canvas | `components/SuperCanvas.tsx` 的 document、selection、viewport、gesture、undo/redo 和持久化 | `CanvasCore` 与 `lib/canvas/patch.ts` 作为局部兼容层 | `packages/canvas-core/runtime.ts` | `commit` 和 Agent Canvas Patch 会经过 `CanvasCore` operation；核心单元测试脱离 React | React document state、selection state、viewport/camera 和 undo/redo 数组仍是事实来源 | CanvasCore history 与 React `undoStack`/`redoStack` 双轨；selection/viewport 也未统一 | 大多数 pointer gesture、节点操作、保存和 UI undo/redo 仍直接调用 React state | 让一次完整 document mutation 以 Core transaction 为唯一写入入口，再迁移 selection/viewport/history | SuperCanvas 只负责渲染和适配，所有 domain mutation/selection/history 都由 Core 持有 |
| Page / UI | `app/page.tsx` 页面组合根、feature state、业务回调和 section renderer | `WorkspaceShell`、`MainColumn`、topbar、sidebar 与 Agent presentation 组件 | 组件边界已建立；尚无独立 page application core | 根 shell、侧栏和多组 Agent 展示组件已真实渲染 | `app/page.tsx` 仍是状态、数据加载和回调的事实来源 | 已拆出的展示组件与 page 状态/组合逻辑双轨存在 | 页面仍直接拥有 Agent、History、Provider、Canvas 和 workspace 业务动作 | 在领域边界稳定后继续抽取 section application boundary，不以移动文件作为目标 | page 只保留 composition；section state/action 不再由 page 直接实现 |

## Storage 调用核对

视频和超分任务的 CRUD 已经通过 `lib/repositories/task-repository.ts`，具体入口是 `lib/video-task-store.ts` 与 `lib/upscale-task-store.ts`。因此“任务 CRUD 已经过 Task Repository”对这两类任务成立；它不适用于 Clone jobs、Agent Progress 或所有 workspace/artifact/media 存储，这些仍是 Legacy 直连。

## Canvas 调用核对

`SuperCanvas` 创建并同步 `CanvasCore`，其 `commit` 和 Agent Canvas Patch 会调用 Core 的 operation boundary。但 React 的 `document`、`selectedIds`/group/edge selection、camera/viewport，以及独立的 `undoStack`/`redoStack` 仍被大量交互直接读写。因此 Canvas Core 是已接入的兼容边界，不是当前唯一 Source of Truth；本轮不应宣称 Canvas migration 已完成。

## 源码耦合测试审计

测试目录中约有 4,859 条 `readFile`、`assert.match`、`assert.doesNotMatch` 或 `toContain` 相关匹配行，分布在约 217 个测试文件。它们不能在本轮批量删除，需按以下顺序处理：

1. 保留真正验证编译产物、路由导出或稳定结构契约的检查，并标注其边界。
2. 对 Agent、Canvas、Storage、Task、Provider 和 UI 关键路径先补行为测试。
3. 在行为覆盖等价后，移除依赖固定源码文件或实现细节的断言。

当前最集中的文件族是 Agent（51）、Canvas（34）、Task/媒体（25）、UI（19）、Storage（15）和 Provider/Model（12）；这些数字是按文件名分类的审计索引，不代表待删除测试数量。

## 本轮边界与后续顺序

- 本轮不修改运行时代码，不改变产品行为，不换数据库，不做物理拆仓。
- 已完成的 Agent、Storage、Task、Provider、Canvas 和 Page/UI 垂直切片可以继续维护，但其 Legacy 责任仍按上表保留。
- 下一步优先定义独立 Tool Runtime Contract，并为一条真实 Native/MCP 路径建立行为覆盖。
- Canvas Core 和 page/UI 的后续工作必须先解决 Source of Truth，再扩大组件拆分。
