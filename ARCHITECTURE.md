# ARCHITECTURE.md — SANMAO.AI Next Architecture

## 1. Architecture Mission

SANMAO.AI 的长期目标不是成为“带 AI 的网页应用”，而是成为：

**Human + Agent + Model + Tool + Artifact + Workspace 的 AI 创作与执行环境。**

模型能力会快速变化，因此架构不能绑定具体模型品牌或某代模型的行为。

核心设计原则：

> Intelligence is replaceable. Contracts are durable.

---

## 2. Current Strategy

当前不采用一次性全量重写。

采用：

**Strangler Rewrite / 模块级替换**

即：

```text
Legacy SANMAO
    │
    ├── 继续可用
    │
    ├── Legacy UI
    ├── Legacy orchestration
    │
    └── Compatibility Adapters
              │
              ▼
         Next Core
```

每次只替换一个清晰边界。

---

## 3. Target System Shape

```text
┌──────────────────────────────────────┐
│               CLIENT                 │
│ React UI / Canvas / Workspace        │
└──────────────────┬───────────────────┘
                   │ HTTP / SSE / WS
                   ▼
┌──────────────────────────────────────┐
│                 API                  │
│ Auth / Validation / Serialization    │
└──────────────────┬───────────────────┘
                   ▼
┌──────────────────────────────────────┐
│          APPLICATION LAYER           │
│ Use Cases / Commands / Queries       │
└──────────────────┬───────────────────┘
                   ▼
┌──────────────────────────────────────┐
│             DOMAIN / CORE            │
│ Agent / Tool / Canvas / Task / Asset │
└───────────┬───────────────┬──────────┘
            │ Ports         │ Ports
            ▼               ▼
      Infrastructure    External Runtime
      DB / Files        Model / MCP / A2A
```

---

## 4. Long-Term Repository Shape

目标结构：

```text
apps/
  web/
  api/
  worker/
  desktop/
  cli/

packages/
  contracts/
  domain/
  agent-core/
  model-runtime/
  tool-runtime/
  task-runtime/
  canvas-core/
  artifact-core/
  workspace-core/
  storage/
  observability/
  security/
  ui/
  testkit/

integrations/
  openai/
  anthropic/
  google/
  mcp/
  a2a/
  storage/

docs/
specs/
tooling/
```

当前仓库不要求一次移动到这个结构。

原则是：
**先建立真正边界，再移动目录。**

---

## 5. Dependency Rules

允许：

```text
apps → application/core
application → domain
adapters → ports/contracts
```

禁止：

```text
domain → React
domain → Next.js
domain → OpenAI SDK
domain → MCP SDK
domain → database client
canvas-core → React
agent-core → HTTP route
```

---

## 6. Frontend Architecture

### Responsibilities

Frontend 负责：
- UI composition
- User interaction
- Server state presentation
- Local ephemeral UI state
- Stream rendering

Frontend 不负责：
- Provider business rules
- Agent tool execution
- Database policy
- Model routing
- Persistent task orchestration

### State Categories

必须区分：

#### UI State
如 panel、modal、hover、selection visual state。

#### Server State
Conversation、Assets、Tasks、Workspace 等。

#### Streaming State
Agent token、tool event、task progress、artifact delta。

#### Domain State
例如 Canvas Document，应由独立 Core 表达，而不是散落在 React hooks 中。

---

## 7. Backend Architecture

后端长期采用：

**Modular Monolith + Ports and Adapters**

不默认上微服务。

HTTP 层只负责：
- auth
- validation
- serialization
- invoking application use case
- protocol errors

业务规则必须下沉到 Application / Core。

---

## 8. Agent Architecture

### Agent != Model

Agent 表达：
- identity
- instructions
- capabilities
- policy
- context
- tools
- runtime behavior

Model 只是 inference engine。

### AgentRun

一次 Agent 工作必须拥有独立生命周期。

建议状态：

```text
created
planning
running
waiting_tool
waiting_user
waiting_agent
suspended
completed
failed
cancelled
```

不要求第一阶段全部实现。

### Agent Events

建议事件：

```text
AgentRunStarted
ModelInvocationStarted
ModelInvocationCompleted
ToolCallStarted
ToolCallCompleted
ArtifactCreated
AgentDelegated
AgentRunCompleted
AgentRunFailed
```

第一阶段事件用于：
- Debug
- Tests
- Observability

不要求立刻完整 Event Sourcing。

---

## 9. Model Runtime

核心 Port 示例：

```ts
interface ModelProvider {
  listModels(): Promise<ModelDescriptor[]>
  invoke(request: ModelRequest): Promise<ModelResponse>
  stream(request: ModelRequest): AsyncIterable<ModelEvent>
}
```

ModelDescriptor 应表达 capability，而不是只表达品牌。

Capability 可能包括：
- text
- reasoning
- vision
- toolUse
- parallelToolUse
- structuredOutput
- longContext
- imageGeneration
- audio
- computerUse
- agentDelegation

Routing 应基于 capability、cost、latency、availability、user preference 等，而不是品牌 if/else。

---

## 10. Tool Runtime

统一 Tool Contract。

生命周期：

```text
discover
→ resolve
→ validate
→ authorize
→ execute
→ observe
→ return
```

来源可包括：
- Native
- MCP
- Remote
- Plugin
- Sandbox
- Agent capability

MCP 是 Adapter。

Agent Core 不依赖 MCP SDK。

---

## 11. Multi-Agent

从 Contract 层允许：
- delegate
- spawn
- consult
- review
- handoff

内部 Agent 通信优先使用稳定内部 Contract。

A2A 作为外部 Adapter，而不是内部 Domain 类型。

---

## 12. Artifact

Artifact 是一等对象。

例如：

```text
document
code
image
video
audio
dataset
spreadsheet
presentation
canvas
archive
```

Artifact 应拥有：
- id
- type
- content reference
- provenance
- version / revision
- author / actor
- timestamps

长期支持 revision / rollback / branch / merge。

---

## 13. Asset

所有二进制资源统一作为 Asset。

Asset 只保存引用和元数据，业务不应到处传绝对路径或 base64。

Blob 最终通过 Object Store Port 管理。

本地可使用 filesystem adapter。
云端可使用 S3-compatible adapter。

---

## 14. Canvas Core

Canvas 必须成为独立 Domain。

Core 至少应表达：
- CanvasDocument
- Node
- Edge
- Group
- Selection
- Viewport
- Operation
- Transaction
- History

UI 不拥有核心业务真相。

所有 Agent 改动通过结构化 Command / Operation 进入 Canvas Runtime。

这为：
- undo
- redo
- replay
- collaboration
- agent edit
- versioning
提供统一基础。

---

## 15. Storage

长期目标：

```text
Repository Port
    │
    ├── Legacy Adapter
    ├── Local DB Adapter
    └── PostgreSQL Adapter
```

推荐云端最终使用 PostgreSQL。

本地存储选型可以继续评估 PGlite / SQLite 等，但 Domain 不得依赖最终选择。

不要在业务代码中直接访问：
- localStorage
- IndexedDB
- JSON 文件
- SQL
除非该代码本身就是 Infrastructure Adapter。

### Current migration state

Part B has started at real ownership seams. `apps/api/agent-entry.ts` is the
application entry for the migrated compact text Agent turn, and
`packages/model-runtime/legacy-chat-adapter.ts` owns its provider-neutral
legacy chat adapter. Provider attempt/failover lifecycle is shared through
`packages/model-runtime/invocation.ts`; the route supplies timeout, health and
candidate selection policy.
`apps/worker/task-entry.ts` dispatches Clone analysis and confirmed/resumed
execution, plus Video/Upscale submission and reconciliation, without making the HTTP route the worker owner. `apps/api/agent-stream.ts` owns provider-neutral SSE adaptation and final stream serialization. The existing Next app still hosts the
remaining context, capability, media, provider health and family-specific task paths, so this
is `migration in progress`, not a completed physical split. The old
`lib/agent/runtime.ts`, `lib/provider-runtime/chat.ts` and root
`packages/model-runtime.ts` compatibility bridges are removed; imports now
target the package and application seams directly.

`packages/tool-runtime/mcp-executor.ts` now owns the shared MCP and Tabbit
execution result and audit boundary. `packages/tool-runtime/adapter.ts` remains
a temporary coordinator for context-heavy artifact, image and skill flows; its
deletion condition is zero callers for those compatibility bindings after the
corresponding capability ports are behavior-tested.

The repository ports are now used by conversation, workspace gallery,
asset-collection, video/upscale task, clone-job and Agent-progress paths.
MCP user configuration crosses `McpConfigRepository`; provider state and the
server workspace API also use repository adapters. Their JSON files are only
pre-cutover adapters and SQLite is authoritative after the marker.
`lib/repositories/*` remains a temporary adapter layer over IndexedDB, JSON and
filesystem implementations. SQLite is now the selected local authoritative
adapter after an explicit `npm run migrate:database` cutover; legacy files are
kept only as migration and rollback sources. Canvas UI preferences,
media/artifact roots and client history remain bounded compatibility adapters.

Backup archive format uses version 2 and domain schema version 1; `client/client.json` is the canonical
workspace representation. `lib/backup-application-service.ts` owns export and
restore orchestration while the HTTP route only authenticates, parses and
serializes. Restore writes through a file-level rollback transaction and uses
streaming tar extraction. Archive export now reads disk-backed entries through
file streams, writes the gzip archive to a staging file, and encrypts that file
incrementally without a second media buffer. HTTP restore stages
the request body to a bounded temporary file, decrypts the v1 envelope as a
stream, and extracts tar entries directly to staging files. The restore
transaction commits staged files only after validation and records an active or
committed journal phase for crash recovery. Compatibility Buffer APIs remain for local
snapshots and older callers; the production HTTP export path is file/stream based.
The legacy JSON backup endpoint and browser IndexedDB restore path also use the
same staged transaction boundary: browser restore captures the current
repository workspace and restores it if a later store write fails. Database,
Backup, Provider and video Task operations emit the shared RuntimeObserver
lifecycle events without recording prompt, tool arguments, file contents or
secrets. Fixed architecture evals cover the migrated AgentRun, backup
canonical boundary and the API/Worker seams.
PostgreSQL remains a future cloud adapter; it
is not introduced in this local-first cutover.

---

## 16. Task Runtime

所有长任务使用统一 Task Model。

## 26. Physical, logical and deployment boundaries

The current product is a modular Next monolith. Its logical boundaries are
Web/UI, HTTP/API, Application/Runtime, Core/Ports, and Infrastructure adapters.
The physical boundaries are the existing `app/` and `components/` host, `apps/api`
application seams, `apps/worker` task seams, and reusable `packages/*` cores.
There are no standalone Web/API/Worker executables yet: deployment remains one
Next host plus in-process worker dispatch. A separate executable is introduced
only after its domain owner, production path, and persistence contract no longer
depend on the host route.

Part B remains `migration in progress`. Agent request context preparation and
provider attempt coordination have real package owners; `apps/api/agent-application.ts`
now delegates model invocation through `packages/model-runtime/agent-invoker.ts`
and bounded Skill/Artifact/MCP-browser continuation through `apps/api/agent-execution.ts`,
while request context, policy/approval and compatibility assembly remain explicit
application responsibilities. Tool capability modules and Worker task controls are real
production seams; media transport, provider health persistence, and task family
polling/retry persistence remain migration adapters.

适用：
- image
- video
- upscale
- export
- indexing
- crawl
- long-running tool
- long-running agent action

状态建议：

```text
pending
queued
running
waiting
succeeded
failed
cancelled
```

Workflow Engine 是 Adapter。

本地可以轻量执行。
未来需要 durable execution 时再接 Temporal 等。

---

## 17. Events

内部优先使用 Domain Events。

初期不引入分布式消息系统。

需要扩展时再通过 EventPublisher Port 接：
- in-process bus
- NATS
- Kafka
- cloud event system

不要让 Domain 知道具体消息基础设施。

---

## 18. API Contract

跨前后端 Contract 应集中管理。

推荐：
- Zod schema
- generated OpenAPI
- generated client types
- contract tests

Frontend 不复制 DTO。

---

## 19. Streaming

默认使用 SSE 处理单向服务端事件流。

只有真正需要持续双向低延迟交互时才使用 WebSocket。

统一 StreamEvent envelope，避免每个模块发明独立格式。

---

## 20. Observability

新执行链路必须可追踪。

长期采用 OpenTelemetry。

Trace 至少能够表达：

```text
HTTP
└─ AgentRun
   ├─ ContextBuild
   ├─ ModelCall
   ├─ ToolCall
   ├─ ModelCall
   └─ ArtifactCreate
```

Domain 不直接依赖 telemetry SDK。

---

## 21. Errors

统一错误语义。

建议：
- DomainError
- ValidationError
- AuthorizationError
- ProviderError
- ToolError
- WorkflowError
- StorageError
- ExternalServiceError

错误应包含稳定 `code`，UI 不解析错误字符串判断逻辑。

---

## 22. Security

高风险操作统一经过 Policy / Approval。

例如：
- filesystem write
- shell
- browser mutation
- external publish
- sensitive network action

Policy Decision：

```text
allow
deny
ask
```

Approval 是领域对象，不只是 `confirm()`。

---

## 23. Testing Architecture

层级：

```text
Domain Unit
→ Application
→ Contract
→ Integration
→ E2E
```

重点测试行为与稳定 Contract。

源码字符串测试属于 Legacy 技术债，应逐步淘汰。

---

## 24. Architecture Tests

长期应自动验证：
- core 不依赖 app
- domain 不依赖 infrastructure
- canvas-core 不依赖 React
- agent-core 不依赖 MCP SDK
- web 不直接依赖数据库实现

架构规则应该由 CI 执行，而不是只存在文档中。

---

## 25. Agent-Friendly Architecture

未来多个 Coding Agent 并行开发时：

```text
Agent A → agent-core
Agent B → canvas-core
Agent C → storage
Agent D → frontend feature
Agent E → tests/review
```

它们只通过 Contract 相遇。

一个 Agent 不应为了修改单一模块而读取全仓库。

---

## 26. Migration Philosophy

不要“拆文件式重构”。

优先：

```text
识别 Domain
→ 定义 Contract
→ 新实现
→ Legacy Adapter
→ 接一条真实路径
→ 验证
→ 扩大迁移
→ 删除 Legacy
```

兼容层必须有明确删除条件。

---

## 27. Success Criteria

架构成功不是“用了最新技术”。

成功标准：

1. 模型可替换而不改产品核心
2. Provider 可替换而不改 Agent Core
3. MCP 可升级而不改 Tool Domain
4. Storage 可替换而不改业务逻辑
5. React 可演进而不改 Canvas Core
6. 新 Agent 可独立添加
7. 新能力通过 Contract 接入
8. Coding Agent 可在局部上下文安全开发
9. 没有新的万能 Route / 万能 Component
10. Legacy 面积持续缩小

### Operational observability adapter

`packages/contracts/observability.ts` 定义 provider-neutral `RuntimeObserver`；`packages/observability/runtime-sink.ts` 提供本地 operational adapter，按日写入 `.data/runtime-events/*.jsonl`，限制单文件大小并保留 7 天。它只持久化白名单 RuntimeEvent 字段，不写入 prompt、tool arguments、响应正文、文件内容或 secret。Agent、Backup、Worker 入口和关键 Runtime 通过 bounded diagnostics 与该 sink 组合使用，管理员可通过 `GET /api/observability` 查询最近事件。Domain/Core 只依赖 contract，长期 OpenTelemetry exporter 仍是后续演进项。

## Final convergence checkpoint (2026-10-04)

This repository remains a **Modular Next Monolith**. The logical boundaries are Web/UI, HTTP/API transport, Application/Runtime, Core/Ports, and Infrastructure. The physical code boundaries are `app/`, `components/`, `apps/api/`, `apps/worker/`, and `packages/`. The current deployment boundary is one Next host with in-process worker dispatch; separate Web/API/Worker executables are not justified by the current production path.

`app/api/agent/route.ts` is transport-only and delegates authentication, JSON decoding, and response production to `apps/api/agent-transport.ts` and `apps/api/agent-http-contract.ts`, then to `apps/api/agent-application.ts`. The application receives structured input and an abort signal; it does not read an HTTP `Request`. Streaming adaptation remains in `apps/api/agent-stream.ts` and execution follow-ups remain in `apps/api/agent-execution.ts`.

Provider candidate ordering, failover, attempt lifecycle, and deadlines are authoritative in `packages/model-runtime/provider-coordinator.ts`; SDK and media branches remain adapters. Task lifecycle controls are authoritative in `apps/worker/task-control.ts`, `apps/worker/task-entry.ts`, and `apps/worker/task-lifecycle.ts`, with family-specific provider persistence still retained behind adapters. `packages/tool-runtime/adapter.ts` remains a bounded migration dispatcher and is not a second source of truth; its deletion requires artifact/skill compatibility callers to move to stable capability ports.

This is a logical ownership convergence checkpoint, not Final Architecture Lock. Legacy removal and independent deployment remain migration work.
