# AGENTS.md — SANMAO.AI 项目宪法（Agent / Codex 必读）

> 本文件是仓库级最高执行规则。任何 Coding Agent、Codex、Claude Code、GPT 系列 Agent 在修改本项目之前，都必须先阅读本文件、`ARCHITECTURE.md`、`PLANS.md` 与 `WORKFLOW.md`。

## 0. 总目标

SANMAO.AI 正在从现有 0.7.x 架构逐步演进为面向 Agent 时代的清晰架构。

当前阶段不是“全量推翻重写”，也不是“继续在旧核心里堆功能”，而是：

**保持现有产品可用，同时逐块重写核心能力，并通过明确 Contract 将旧实现逐步替换。**

旧代码用于确认产品行为，不用于决定新架构应该怎样实现。

---

## 1. 第一原则

所有新核心代码必须优先满足：

1. Contract First
2. Domain First
3. Dependency Inversion
4. Explicit Boundaries
5. Behavior Tests over Source Tests
6. Observable by Default
7. No Hidden Cross-Domain Dependencies
8. No Shared Mutable Global State
9. No Permanent Migration Hacks
10. No Speculative Complexity

不要为了“先进”机械引入微服务、Kafka、Kubernetes、Event Sourcing、CQRS、复杂状态机或额外基础设施。

架构复杂度必须由真实需求证明。

---

## 2. Legacy 与 Next Core

### Legacy 区

现有大文件与旧编排逻辑包括但不限于：

- `app/page.tsx`
- `components/SuperCanvas.tsx`
- `app/api/agent/route.ts`
- 现有散落的浏览器存储、`.data`、JSON、任务文件等

Legacy 允许继续运行、允许修真正阻塞使用的问题，但原则上：

**禁止继续向这些位置加入新的大型业务能力。**

### Next Core 区

新的核心能力应逐步进入明确模块，例如：

```text
packages/
  contracts/
  agent-core/
  model-runtime/
  tool-runtime/
  storage/
  task-runtime/
  canvas-core/
  artifact-core/
  observability/
```

如果当前仓库尚未适合 `packages/`，可以采用过渡目录，但必须：
- 说明原因；
- 保持边界清晰；
- 不得把过渡目录变成新的垃圾桶。

---

## 3. 迁移期新增职责门槛

迁移期间，**Legacy 可以继续修改，但架构职责和 ownership 只能保持或减少**。

- 已经存在并接入真实路径的 Next Core、Contract、Runtime 或 Repository 边界，新业务职责必须进入该边界。
- Legacy 允许承载 Bug 修复、兼容逻辑和明确标注的 Migration Adapter，但不得继续获得新的领域 ownership。
- 如果目标领域还没有合适边界，先建立最小的 Contract、Port 或 Application 边界，再接入真实路径；不要为了赶进度把新职责继续塞进 Legacy。
- “Legacy 只减不增”约束的是架构职责和 ownership，不是禁止修改 Legacy 文件。

迁移期允许双轨，但每条双轨路径都必须明确记录：

1. 当前 Source of Truth；
2. Adapter 的角色和使用方；
3. 删除旧路径的条件。

完成任务前必须自检：

- 是否绕过了已有 Contract、Runtime 或 Repository；
- 是否制造了第二个 Source of Truth；
- Core / Domain 是否新增了 React、Next.js、Provider SDK 或其他基础设施依赖；
- 是否复制了 Legacy 逻辑，而不是迁移 ownership。

---

## 4. 依赖方向

目标依赖方向：

```text
UI / HTTP Adapter
        ↓
Application
        ↓
Domain / Core
        ↓
Ports
        ↑
Infrastructure Adapters
```

Core / Domain 禁止直接依赖：

- React
- Next.js Route API
- MCP SDK
- OpenAI / Anthropic / Google SDK
- 具体数据库客户端
- 具体对象存储 SDK
- UI state

Provider、MCP、Database、Filesystem、HTTP 都应该作为 Adapter 存在。

---

## 5. Agent 开发规则

任何 Agent 任务都应遵循最小上下文原则。

不要无目的扫描整个仓库。

处理某个领域时，优先读取：

1. 根目录 `AGENTS.md`
2. `ARCHITECTURE.md`
3. `PLANS.md`
4. 对应领域 README / spec
5. 对应 Contract
6. 相关实现
7. 相关测试

例如处理 Canvas，不应默认读取整个 Agent Runtime。

目标是让未来多个强模型可以并行开发而不互相阻塞。

---

## 6. 文件与模块约束

### 禁止垃圾桶模块

避免创建：

- `utils.ts`
- `helpers.ts`
- `common.ts`
- `misc.ts`

如果逻辑属于某个领域，应放回该领域。

真正跨领域的共享代码必须足够小，并有明确稳定语义。

### 文件规模

不是硬性行数限制，但以下是审查阈值：

- < 300 行：通常健康
- 300–600 行：关注职责是否开始混杂
- > 600 行：需要明确说明
- > 1000 行：默认需要 Architecture Review

不得再次出现万行级组件或万能 Route。

---

## 7. API 与 Contract

所有新跨模块接口优先定义于稳定 Contract 中。

Contract 应表达：

- Input
- Output
- Schema
- Error
- Event
- Capability

不要让前端、后端、Provider、Tool 各自复制一套类型。

前端不得手写与后端重复的 API 类型。

---

## 8. Agent Runtime 规则

新版 Agent 核心必须把一次 Agent 工作视为 `AgentRun`，而不是一次 HTTP 请求。

目标边界至少包括：

- AgentRun
- Context
- Model Runtime
- Tool Runtime
- Policy
- Events
- Application Service

HTTP Route 最终只负责：

- Authentication
- Validation
- 调用 Application Service
- Stream / Response Serialization
- HTTP Error Mapping

以下内容最终不属于 Route：

- 模型路由业务规则
- Tool Execution
- MCP 实现
- Agent Loop
- Canvas 业务逻辑
- Provider-specific 逻辑
- Storage 实现

---

## 9. Model Runtime 规则

新核心中禁止出现：

```ts
if (provider === "openai") { ... }
if (provider === "anthropic") { ... }
```

业务逻辑围绕 Capability 工作。

Provider 只实现统一 Port / Adapter。

模型名称会变化，能力 Contract 应长期稳定。

---

## 10. Tool Runtime 规则

Tool 调用目标生命周期：

```text
discover
→ resolve
→ validate
→ authorize
→ execute
→ observe
→ persist when needed
→ return
```

Native Tool、MCP Tool、远端 Tool 应尽量共享统一 Runtime Contract。

MCP 是 Adapter，不是 Agent Core 的基础类型。

---

## 11. Canvas 规则

新版 Canvas Core 必须能够脱离 React 独立存在。

Canvas Core 应拥有：

- Document
- Node / Edge
- Selection
- Viewport
- Operation / Command
- Transaction
- History
- Undo / Redo

Agent 不直接改 React state，而应提交结构化 Canvas Command / Operation。

---

## 12. Storage 规则

业务代码不能知道数据最终存在：

- IndexedDB
- localStorage
- JSON
- PGlite
- PostgreSQL
- Filesystem
- S3

业务只依赖 Repository / Store Port。

迁移期间允许 Legacy Adapter，但必须明确标注：

```text
TEMPORARY MIGRATION ADAPTER
```

并记录：
- 为什么存在
- 谁在使用
- 删除条件

---

## 13. Task / Workflow 规则

长任务统一通过 Task Runtime 表达。

典型状态：

```text
pending
queued
running
waiting
succeeded
failed
cancelled
```

不要让每一种图片、视频、超分、导出任务各自发明一套状态模型。

---

## 14. 测试规则

禁止新增依赖源代码文本的测试，例如：

```ts
readFile("SuperCanvas.tsx")
expect(source).toContain(...)
```

新测试优先验证：

- Domain behavior
- Contract
- Application behavior
- Adapter integration
- E2E user behavior

重构源码字符串测试时，先建立行为覆盖，再删除旧断言。

不得使用：
- `any`
- `@ts-ignore`
- 关闭类型检查
来掩盖真实错误。

---

## 15. 可观测性

新 Agent / Tool / Task 路径默认应可追踪。

至少要能够定位：

- Run ID
- Model
- Tool call
- Latency
- Error
- Retry
- Task state
- Artifact result

长期方向为 OpenTelemetry，但不要为了接入 telemetry 污染 Domain。

---

## 16. 修改策略

大型重构必须采用纵向切片。

错误：

```text
先同时重写 Agent + Canvas + DB + UI
```

正确：

```text
一个边界
→ 一个可运行最小实现
→ 接入一条真实路径
→ 测试
→ 再扩展
```

每一阶段结束时必须：
1. 保持仓库可工作；
2. 相关测试通过；
3. typecheck 通过；
4. 记录尚未迁移的 Legacy Responsibility；
5. 不做无关清理。

---

## 17. Git / 同步 / 发布铁律

以下规则继承现有项目，不得擅自改变。

### 平时：只同步，不发布

用户说：
- “同步”
- “备份”
- “推到 GitHub”

只允许：

```text
commit + push
```

不要：
- 升级版本号
- 打 tag
- 创建 Release
- 修改发布信息
- 上传 ZIP / DMG

### 发布

只有用户明确说：
- “发布”
- “出个版本”
- “通知用户更新”

才允许执行正式发布流程。

正式发布必须遵守 `WORKFLOW.md`。

### main 是最终集成分支

允许用 feature / codex 分支开发。

但最终希望团队共享的改动必须：
- 合并回 `main`
- push 到远端 `main`

不要把最终成果永久留在临时分支。

### 同步前验证

同步前运行：

```bash
npm run check
```

如果失败：
- 不同步失败代码；
- 不用跳过类型检查的方法掩盖问题。

### 同步后收尾

必须确认：

```bash
git fetch origin main
git rev-parse HEAD origin/main
git status --short
```

HEAD 与 `origin/main` 应一致，工作区应干净。

任何可能丢失未推送改动的 reset / cleanup 都必须先确认安全。

---

## 18. Codex / Coding Agent 每次任务的标准流程

### Step 1 — Understand
读取规则和相关领域，不要立刻改代码。

### Step 2 — State the boundary
明确本次：
- 改什么
- 不改什么
- 哪些行为保持不变

### Step 3 — Implement smallest coherent slice
只做一个完整可验证纵向切片。

### Step 4 — Test
运行最相关测试，然后执行要求的完整验证。

### Step 5 — Report
最终汇报必须包含：

```text
What changed
Architecture introduced / preserved
Legacy code still remaining
Tests
Risks / unresolved issues
Recommended next phase
```

---

## 19. 最高判断标准

一个新模块是否设计良好，不看它用了多少新技术。

判断标准是：

> 一个第一次进入仓库的人类工程师或 Coding Agent，是否可以在很短时间内知道这个模块负责什么、不负责什么、依赖谁、谁依赖它，以及如何在不理解整个仓库的情况下安全修改它。

如果不能，继续简化边界。
