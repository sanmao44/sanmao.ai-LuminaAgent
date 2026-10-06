# AGENTS.md — SANMAO.AI 项目宪法（Agent / Codex 必读）

> 本文件是仓库级最高执行规则。任何 Coding Agent、Codex、Claude Code、GPT 系列 Agent 在修改本项目之前，都必须先阅读本文件、`ARCHITECTURE.md`、`PLANS.md` 与 `WORKFLOW.md`。

## 0. 总目标

SANMAO.AI 的架构迁移已经完成并封板（Final Architecture Lock）。

当前长期目标是：**在已锁定的分层架构上开发产品功能，而不是继续重构架构。**

当前部署形态是 Modular Next Monolith：Web、HTTP、Application、Runtime/Core、Infrastructure 是代码内的逻辑边界，不是独立部署单元，除非真实部署需求证明必须拆分。

架构、领域 ownership、兼容层与封板状态以 `ARCHITECTURE.md` 与 `docs/next-architecture/migration-status.md` 为准。

Legacy 代码用于确认产品行为，不用于决定新功能应该写在哪一层。

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

## 2. 分层与模块边界

最终分层如下，任何新功能都必须落在其 owning 层：

```text
UI（app/page.tsx、components/**）                        ← 仅 presentation / interaction
        ↓
HTTP Transport（app/api/**/route.ts）                    ← 仅 auth、解析、序列化、错误映射
        ↓
Application（apps/api、apps/worker）                     ← 用例编排、生命周期
        ↓
Runtime / Core / Ports（packages/**）                    ← 领域状态与能力
        ↑
Infrastructure Adapters（lib/**、packages/observability） ← SDK、DB、文件、Provider
        ↓
Persistence / Provider / MCP / Filesystem
```

- 新增功能前先确认 owning domain，再通过 Contract / Port / Runtime / Core / Repository / Adapter 实现。
- 禁止为了方便把业务逻辑重新塞进 `app/page.tsx`、`components/SuperCanvas.tsx`、API Route、HTTP Transport、直接存储调用或 Provider SDK 调用点。
- `packages/contracts/**` 是唯一的跨模块 Contract 来源；前端不得手写与后端重复的类型。
- 领域 authority 清单（Agent / Tool / Provider / Task / Canvas / Storage / Backup）见 `ARCHITECTURE.md` 的 Ownership Matrix。
- 已知兼容层、其使用者与删除条件集中在 `docs/next-architecture/migration-status.md`；不得新增未登记的兼容路径。
- 现有超大文件不再接收新的领域 ownership；拆分属于已登记的 Post-Lock Improvement，不是新的架构迁移阶段。

---

## 3. 职责归属与兼容层

架构已封板，**每个领域只有一个 authoritative owner**（见 `ARCHITECTURE.md`）。

- 新业务职责必须进入对应领域的 Contract / Runtime / Repository / Application 边界，不得在 Legacy 文件中新增领域 ownership。
- Legacy 文件允许继续修改，但只能承载 Bug 修复、兼容读取和已登记的 Migration Adapter。
- 兼容层必须登记在 `docs/next-architecture/migration-status.md`，并写明：为什么存在、谁在使用、删除条件。
- 不允许新增未登记的兼容路径；不允许创建第二个 Source of Truth。

完成任务前必须自检：

- 是否绕过了已有 Contract、Runtime 或 Repository；
- 是否制造了第二个 Source of Truth；
- Core / Domain 是否新增了 React、Next.js、Provider SDK 或其他基础设施依赖；
- 是否把 Legacy 逻辑复制成新实现，而不是把 ownership 迁移进边界。

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

### 4.1 Route / Transport 规则

HTTP Route 只允许承担：

- authentication / authorization boundary
- request parsing
- transport validation
- 调用 Application boundary
- HTTP / SSE response serialization
- HTTP error mapping

禁止重新承担：Agent execution lifecycle、Tool loop、Provider routing、Task lifecycle、Domain state authority。

### 4.2 UI 规则

UI 可以拥有：rendering state、hover、menus、pointer state、transient interaction、animation、presentation composition。

UI 不得重新成为：Canvas document / history / selection authority、Task lifecycle authority、persistence authority、Provider routing authority。

以上规则由 `tests/architecture-enforcement.test.mjs` 机器化校验。

### 4.3 Source of Truth 规则

一个领域概念只能有一个 authoritative owner。禁止重新出现两个可独立写入的 owner：

```text
React + Core
Route + Runtime
Old storage + SQLite
API + Worker
Legacy lifecycle + TaskRuntime
```

Projection / cache / adapter 可以存在，但必须明确它不是 Source of Truth。

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

- 业务逻辑不得新增直接访问 SQLite、JSON 持久化、IndexedDB、localStorage 或文件系统的路径；必须经过已有 Repository / Port。
- 合理的例外仅限：UI preference、纯浏览器本地 UI 状态、媒体/文件 blob 适配器。
- 兼容读取器与 Migration Adapter 必须登记在 `docs/next-architecture/migration-status.md`，写明为什么存在、谁在使用、删除条件。
- SQLite 只有一个 authoritative adapter：`lib/database/sqlite.ts`；由 `tests/architecture-enforcement.test.mjs` 机器化校验。

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

架构规则必须机器化校验：新增或修改分层规则时，同步更新 `tests/architecture-enforcement.test.mjs`，而不是只改文档。

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

---

## 20. 架构约束的机器化执行

架构规则不能只存在于文档里。

- `tests/architecture-enforcement.test.mjs` 是封板后架构规则的唯一执行入口，覆盖六类约束：Dependency、Route、Repository、Legacy、Runtime Infrastructure、Source-Test。
- Repository 约束维护一份“仍直接访问文件系统的 legacy route”允许清单；新增条目意味着新增兼容路径，必须同时在 `docs/next-architecture/migration-status.md` 登记删除条件。
- Source-Test 约束用 `tests/architecture-source-test-baseline.json` 冻结现有历史 source-coupled 测试；新增此类测试会失败，必须改为 transpile → execute → behavior 测试。
- 新增或放宽架构规则时，必须先改测试再改文档；不允许让测试与规则长期不一致。
- 兼容层与 Post-Lock Improvement 清单由 `docs/next-architecture/migration-status.md` 与 `docs/next-architecture/post-lock-improvements.md` 维护。

## Feature-Driven Refactoring Policy

当前阶段禁止主动发起无明确产品收益的大规模架构重构。

默认开发模式为：

**Feature First, Refactor Along the Path.**

### 1. 功能优先

每个任务的第一目标必须是完成用户可验证的功能、Bug 修复或产品质量改进。

不得因为发现附近代码不够理想，就把当前任务扩大为：

* 全模块重写
* 全局状态管理迁移
* 大规模目录调整
* 大规模重命名
* 与当前需求无关的抽象
* “顺便清理”其他领域
* 为了减少文件行数而机械拆文件

### 2. 允许的伴随重构

当当前功能直接触碰旧代码时，可以并鼓励进行局部重构，但必须满足：

1. 重构范围与当前功能直接相关；
2. 能减少当前功能继续增加 legacy ownership；
3. 能把已有业务职责迁入正确 owner；
4. 能降低重复逻辑、隐式状态或跨层依赖；
5. 有现有测试或新增行为测试保护；
6. 不改变无关产品行为。

典型允许行为：

* 从巨型 React 组件中抽出当前功能需要的 hook；
* 把当前功能涉及的业务规则迁到 Core / Runtime / Application；
* 把重复 API 类型迁到 contracts；
* 把当前功能涉及的 persistence 调用迁到 Repository；
* 把当前功能涉及的 Provider / Tool 行为迁到已有 Port；
* 提取当前功能相关的 UI 子组件；
* 删除因本次迁移而失去调用者的旧代码。

### 3. 巨型文件规则

`app/page.tsx`、`components/canvas/CanvasWorkspace.tsx` 以及其他 >1000 行文件视为 Legacy Integration Surface。

允许修改，但原则上：

* 不新增新的领域 ownership；
* 不新增可独立存在的业务状态机；
* 不新增大段 persistence / provider / lifecycle 逻辑；
* 新功能优先进入所属 feature/domain 模块；
* 巨型文件只保留 wiring、composition、rendering 和 interaction glue。

如果实现一个新功能必须向巨型文件加入大量业务逻辑，应先提取与该功能直接相关的 boundary，再实现功能。

### 4. 重构预算

默认情况下，伴随重构应小于或接近功能本身的范围。

出现以下任一情况时，应停止扩大当前重构范围，并将剩余问题记录到 post-lock improvements / regression backlog：

* 开始修改与当前需求无关的领域；
* 为完成局部功能需要重写整个 subsystem；
* 重构产生大量无关文件 diff；
* 需要同时改变多个 authoritative owner；
* 测试无法区分功能变化与架构变化；
* 重构风险已经明显大于当前功能收益。

不得仅为了“代码更漂亮”扩大任务范围。

### 5. 三次触碰规则

如果连续多个产品任务反复被同一个结构问题阻塞，则可以提出一次独立的针对性重构。

判断标准：

* 同一问题已经影响至少 2–3 个实际功能；
* 已经能明确新的稳定 boundary；
* 重构完成后近期功能可以直接受益；
* 有行为测试覆盖迁移前后的产品行为。

这类重构必须针对具体 bottleneck，不得重新开启全项目架构迁移。

### 6. 新代码规则

所有新功能默认遵循：

* 新业务规则进入 owning domain；
* React 负责 presentation / interaction，不成为领域 Source of Truth；
* Route 负责 transport，不拥有业务生命周期；
* Infrastructure 通过 Port 接入；
* 跨模块类型来自 contracts；
* 优先复用现有边界，而不是建立第二套 abstraction。

原则：

> 新功能不继续制造旧债，旧债在被真实需求触及时逐步消除。

### 7. 完成任务前自检

Codex 在宣布任务完成前必须检查：

* 本次产品目标是否完整实现；
* 是否向 legacy 巨型文件新增了不必要的业务 ownership；
* 是否出现第二个 Source of Truth；
* 是否进行了与需求无关的重构；
* 是否可以删除因本次迁移而失效的旧实现；
* 是否增加或更新了对应行为测试；
* architecture enforcement 是否通过；
* targeted tests、typecheck、`npm run check`、build、`git diff --check` 是否通过。

若某项无法运行，必须明确说明原因，不得把“未运行”描述为“通过”。

