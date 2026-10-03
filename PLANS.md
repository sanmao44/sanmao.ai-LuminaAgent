# PLANS.md — SANMAO.AI 架构演进执行计划

> **当前状态（2026-10-02）**：Canvas Document、History、Selection 已由 CanvasCore 完成 authority cutover；全域 Legacy removal 仍未完成。各领域真实调用链、双轨状态、绕过点和删除条件见 [`docs/next-architecture/migration-status.md`](docs/next-architecture/migration-status.md)。

> **当前任务（2026-10-02）：Canvas Authority Completion + Architecture Audit II 已完成。** `CanvasCore` 已成为 Document、History、Selection 的唯一 authoritative owner；React 只保留 subscription/projection 与 UI-only transient state。`packages/tool-runtime/adapter.ts` 保持为有删除条件的 migration adapter。

## 当前阶段状态

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| Phase 1 Agent Runtime | migration in progress | Compact non-streaming text path uses AgentRuntime; Tool, Streaming, Artifact, Browser, Filesystem and Route orchestration remain legacy. |
| Phase 2 Test Decoupling | migration in progress | Tool/MCP behavior is covered; remaining Agent/UI/Route source-coupled assertions migrate by domain. |
| Phase 3 Storage Boundary | migration in progress | Session, workspace gallery, asset collections, provider state, MCP configuration, video/upscale, clone and progress use repository adapters; UI preferences, artifact/media and legacy storage internals remain. |
| Phase 4 Task Runtime | migration in progress | State and cancellation/retry decisions reuse Runtime; polling, persistence and wire status remain specialized. |
| Phase 5 Provider Runtime | migration in progress | One text Agent path uses ModelRuntime; routing, failover, streaming and media remain legacy. |
| Phase 6 Tool Runtime | migration in progress | packages/tool-runtime owns policy, resolution, dispatch, execution, loop and MCP executor; Route compatibility boundaries remain. |
| Phase 7 Canvas Core | cutover completed | CanvasCore 已成为 Document、History、Selection 的唯一 authority；SuperCanvas 只保留 projection、gesture、persistence 与 UI adapter。 |
| Phase 8 UI cleanup | migration in progress | Shell, sidebar and Agent presentation are extracted; app/page.tsx remains composition/state owner. |
| Data Architecture Gate 1 | cutover completed | Server business data crosses repository/port boundaries; client IndexedDB/localStorage and blob adapters remain bounded compatibility owners. |
| Backup / Restore Hardening | cutover completed | Restore uses multi-root staged rollback transactions; archive schema v1 and canonical `client/client.json` are enforced; HTTP and legacy JSON restore use the transaction boundary, browser IndexedDB restore captures and rolls back the current repository snapshot, and HTTP export/archive/encryption plus upload/decryption/tar extraction are disk/stream based, while local snapshots retain compatibility Buffer APIs. |
| Database Cutover | cutover completed | SQLite (`node:sqlite`) is the local authoritative adapter. `npm run migrate:database` stages, validates, activates and records rollback sources; legacy JSON is migration/rollback only. |
| Round 7 Architecture Audit | cutover completed | Migration matrix established from real call paths. |
| Round 8 Agent / Tool / MCP test seam | cutover completed | Tool/MCP behavior is covered by real Runtime/MCP executor paths; remaining source assertions migrate by domain. |

后续执行遵循纵向切片原则：先补行为覆盖，再收敛一个边界；不因审计结论跳过 Tool Runtime 或提前删除 Legacy。

## 0. Purpose

本文件定义当前架构演进的施工顺序。

原则：

**不做“大爆炸式重写”，采用可运行的纵向切片逐步替换。**

每一个 Phase 必须独立可验证。

---

# Phase 0 — 建立治理基线

## 目标

让所有后续 Coding Agent 都遵守同一套规则。

## Deliverables

- [x] `AGENTS.md`
- [x] `ARCHITECTURE.md`
- [x] `PLANS.md`
- [x] 确认 `WORKFLOW.md` 仍为发布流程唯一事实来源
- [x] 建立 `docs/next-architecture/`
- [ ] 建立 Architecture Decision Record 目录（可选）

## 完成标准

未来 Agent 开始任务前可以明确知道：
- 当前目标架构
- Legacy 边界
- 哪些规则不可破坏
- 当前正在施工哪一阶段

---

# Phase 1 — Agent Runtime Vertical Slice

## 目标

证明“在旧 SANMAO 内重写新核心”可行。

第一阶段不要求重写整个 Agent。

只建立一个最小、真实、可运行的新 Agent Runtime，并让至少一条现有请求路径经过它。

## 先研究

必须阅读：

- `app/api/agent/route.ts`
- `lib/agent/**`
- `lib/agent-*`
- `lib/tools/**`
- `lib/mcp/**`
- Provider 相关代码
- Agent 相关测试

不要无目的扫描整个仓库。

## Deliverables

### 1. Architecture Assessment

创建：

```text
docs/next-architecture/agent-runtime.md
```

必须描述：

- 当前 Agent 请求生命周期
- `app/api/agent/route.ts` 当前职责
- 已存在且值得保留的模块
- 真正耦合点
- Target Architecture
- Migration Boundary

### 2. Contracts

建立最小必要 Contract：

- AgentRun
- AgentRunId
- AgentRunState
- AgentEvent
- AgentRequest
- AgentResult
- ModelRuntime / ModelProvider
- ModelDescriptor
- ModelCapabilities
- ToolRuntime
- ToolDefinition
- ToolCall
- ToolResult
- ContextBuilder
- PolicyDecision

不要过度设计。

### 3. Minimal Runtime

实现最小 Agent Runtime。

要求：
- 可脱离 HTTP 独立测试
- 不依赖 Next Route
- 不依赖 MCP SDK
- 不依赖具体 Provider SDK
- 不依赖数据库实现

### 4. Existing Path Integration

至少选一条已有 Agent 执行路径通过新 Runtime。

不要求一次迁移所有 Tool / Provider / Canvas 行为。

### 5. Tests

新增行为测试。

禁止新增源码字符串测试。

## 完成标准

- [x] `docs/next-architecture/agent-runtime.md`
- [x] 最小 Contract
- [x] 最小 Runtime
- [x] 一条真实路径接入
- [x] 行为测试
- [x] typecheck 通过
- [x] 相关 tests 通过
- [x] 旧 Agent API 仍工作
- [x] 明确列出尚未迁移职责

> Phase 1 的“完成”指最小纵向切片完成；它不表示 Route、Tool、Streaming 或 Provider 全面迁移。全域迁移状态见 `docs/next-architecture/migration-status.md`。

---

# Phase 2 — Test Decoupling

## 目标

解除源码结构对重构的锁死。

优先处理：
- `SuperCanvas.tsx`
- `app/page.tsx`

相关源码字符串断言。

## 方法

不要直接删旧测试。

采用：

```text
建立行为测试
→ 验证覆盖等价
→ 删除源码字符串断言
```

## 完成标准

- [ ] 关键用户行为已由行为测试覆盖
- [ ] 不再依赖某段源码必须出现在固定文件
- [ ] 拆分组件不会因为移动代码导致大量无意义测试失败

---

# Phase 3 — Storage Boundary

## 目标

把业务逻辑从具体存储方案中拔出来。

## Deliverables

定义真实 Repository Ports，例如：

- ConversationRepository
- WorkspaceRepository
- AssetRepository
- TaskRepository
- ProviderConfigRepository

建立 Legacy Adapter 连接现有：
- IndexedDB
- localStorage
- `.data`
- JSON
- filesystem

此阶段不要求立即换数据库。

## 完成标准

核心业务不直接知道存储实现。

---

# Phase 4 — Task Runtime

## 目标

统一图片、视频、超分、导出等长任务模型。

## Deliverables

- Task Contract
- TaskState
- progress event
- retry policy
- cancellation semantics
- unified task query

尽量复用现有 `lib/task-store.ts` 中已经合理的部分。

不要为了新目录而重写已正确代码。

---

# Phase 5 — Model / Provider Runtime

## 目标

彻底清除新代码中的 provider-specific business branching。

## Deliverables

- ModelProvider Port
- ModelDescriptor
- capability model
- Provider Adapters
- routing policy
- provider health / availability abstraction

## 完成标准

Agent Core 不知道 OpenAI / Anthropic / Gemini 具体 SDK。

---

# Phase 6 — Tool Runtime Consolidation

## 目标

让 Native / MCP / Remote Tool 共享统一执行语义。

## 生命周期

```text
discover
resolve
validate
authorize
execute
observe
return
```

## 重点

优先复用现有：
- registry
- selector
- policy
- executor

只重写真正不合理边界。

---

# Phase 7 — Canvas Core Rewrite

## 目标

这是前端最大结构性技术债的核心治理阶段。

**不要先拆 `SuperCanvas.tsx` UI。**

先创建真正独立的 Canvas Core。

## Deliverables

- CanvasDocument
- Node / Edge
- Selection
- Operation / Command
- Transaction
- History
- Undo / Redo

然后：

```text
Legacy SuperCanvas UI
        ↓
Compatibility Adapter
        ↓
New Canvas Core
```

## 完成标准

Canvas 的核心状态变更与 React 解耦。

---

# Phase 8 — SuperCanvas UI Decomposition

只有 Phase 7 完成到足够程度后再执行。

这时再按职责拆：
- shell
- viewport
- node renderer
- panels
- menus
- agent dock
- asset interaction

目标不是单纯降低文件行数。

目标是让 UI 成为对 Canvas Core 的薄适配层。

---

# Phase 9 — page.tsx Decomposition

最后处理主页面。

因为在 Agent / Storage / Task / Provider / Canvas 被抽离后，`page.tsx` 的很多复杂度会自然消失。

拆分方向：

- WorkspaceShell
- Conversation
- CanvasPanel
- AssetPanel
- Settings
- Provider UI
- History

页面只负责 composition。

---

# Phase 10 — Frontend / Backend Hard Separation

如果前面核心边界已经稳定，再把当前 Next.js 一体化结构逐步演进为：

```text
apps/web
apps/api
apps/worker
```

不要在业务边界尚未稳定时先做物理拆仓。

先逻辑分离，再物理分离。

---

# Phase 11 — Database Modernization

本轮已选择 SQLite 作为本地 authoritative database。`node:sqlite` 通过
`lib/database/sqlite.ts` 暴露给 Repository，迁移命令为
`npm run migrate:database`，回滚命令为 `npm run migrate:database -- rollback`。
迁移 journal 会记录 staging、validation、database installation、activation
和 rollback 阶段；进程中断时只清理未激活的 staging，已激活数据库仍由 marker
和 rollback source 控制。
PostgreSQL 仍保留为未来云端 adapter，不属于本轮。

候选方向：

- Local：评估 PGlite / SQLite
- Server / Cloud：PostgreSQL

选择标准：

- migration quality
- backup / restore
- local packaging
- concurrent access
- FTS / vector
- operational simplicity

不要仅因为“新”选择技术。

---

# Phase 12 — Observability

将关键新链路接入统一 telemetry。

优先：
- AgentRun
- ModelCall
- ToolCall
- Task
- Provider failure

长期可采用 OpenTelemetry。

---

# Phase 13 — Multi-Agent / A2A

只有单 Agent Runtime 边界稳定后再扩展。

新增：
- delegation
- child runs
- handoff
- external agent adapter

A2A 是 Adapter，不侵入 Domain。

---

# Phase 14 — Legacy Removal

只有同时满足以下条件才删除旧实现：

1. 新路径已有行为覆盖
2. 新路径稳定运行
3. 没有剩余调用者
4. Migration Adapter 已无必要
5. 数据兼容 / migration 已明确

不要为了“目录看起来干净”过早删除旧逻辑。

---

# 每个 Phase 的标准执行模板

Coding Agent 每次执行一个 Phase 时：

## 1. Read

读取：
- `AGENTS.md`
- `ARCHITECTURE.md`
- `PLANS.md`
- `WORKFLOW.md`
- 相关领域文件

## 2. Assess

先说明：
- Current State
- Scope
- Non-goals
- Existing code worth preserving

## 3. Implement

只实现当前 Phase 的最小完整纵向切片。

## 4. Verify

先跑最相关测试，再运行：

```bash
npm run check
```

除非用户明确要求仅做分析、不修改。

## 5. Report

输出：

```text
What changed
Architecture introduced
Legacy still remaining
Tests
Unresolved issues
Next recommended slice
```

---

# 当前立即执行任务

当前优先级：

```text
Architecture Audit II（Canvas authority 已 cutover，迁移记录已更新）
```

下一次代码施工优先级：

```text
Storage Consolidation → Backup / Restore Hardening → Database Cutover（本轮完成 server repository 收口、多物理根 restore rollback、流式导入、crash journal、SQLite cutover 与 migration command）；保持 `packages/tool-runtime/adapter.ts` 为有删除条件的 migration adapter
```
