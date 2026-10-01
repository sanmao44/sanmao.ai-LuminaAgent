# PLANS.md — SANMAO.AI 架构演进执行计划

> **当前状态（2026-09-30）**：第七轮 Architecture Convergence Audit 已完成记录。前六轮均已建立最小 Contract、Adapter 和至少一条真实调用路径，但尚未完成全域 Legacy removal；详细的真实调用链、双轨状态、绕过点和删除条件见 [`docs/next-architecture/migration-status.md`](docs/next-architecture/migration-status.md)。

## 当前阶段状态

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| Phase 1 Agent Runtime | 垂直切片完成，迁移进行中 | 紧凑非流式纯文本路径已接入；Tool、Streaming、Artifact、Browser、Filesystem 和 Route 编排仍为 Legacy。 |
| Phase 2 Test Decoupling | 本轮完成 Agent / Tool / MCP 最小切片，整体仍在进行 | Tool registry、policy、loop、参数归一化与 MCP client/audit 行为已覆盖；其余 Agent/UI/Route 结构断言仍按领域迁移。 |
| Phase 3 Storage Boundary | 垂直切片完成，迁移进行中 | 会话、workspace、provider state、视频/超分 Task 已经使用 Repository；Clone、Progress、artifact/media 等仍直连。 |
| Phase 4 Task Runtime | 垂直切片完成，迁移进行中 | 状态/取消/重试判断已复用 Runtime；polling、持久化和专用 wire status 仍保留。 |
| Phase 5 Provider Runtime | 垂直切片完成，迁移进行中 | 一条文本 Agent 路径使用 ModelRuntime；routing、failover、streaming、image/video/search 仍为 Legacy。 |
| Phase 6 Tool Runtime | 尚未开始 | 需要先建立统一 Tool Runtime boundary，再接入真实 Native/MCP 路径。 |
| Phase 7 Canvas Core | 局部接入，未完成 | CanvasCore 已被 SuperCanvas 使用，但 React document/selection/viewport/history 仍是主要 Source of Truth。 |
| Phase 8–9 UI cleanup | 垂直切片完成，迁移进行中 | shell、sidebar、Agent presentation 已拆出；`app/page.tsx` 仍是 composition root 和状态 owner。 |
| Round 7 Architecture Audit | 已完成 | 已形成迁移矩阵；本轮不修改产品代码。 |
| Round 8 Agent / Tool / MCP test seam | 本轮完成 | 将 Tool/MCP 关键断言移到真实模块行为；仅保留最小参数 seam，未开始 Tool Runtime / Agent Runtime 大迁移。 |

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

Storage Port 稳定后，再正式选定新主数据库。

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
Round 7 — Architecture Convergence Audit（文档已完成）
```

下一次代码施工优先级：

```text
Phase 6 — Tool Runtime Consolidation：先定义统一 Contract，再接入一条真实 Native/MCP 路径
```
