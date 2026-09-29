# Agent Runtime Architecture Assessment

## Scope

Phase 1 establishes one executable `AgentRun` path while preserving the existing
Agent API and all existing tool, approval, provider and streaming behavior. The
first slice covers ordinary, non-streamed text turns that already qualify for
the route's compact plain path. Tool calls, MCP, artifacts, images, browser
automation, filesystem operations and streaming remain on the legacy path.

## Current state

`app/api/agent/route.ts` currently owns most of the request lifecycle:

1. authenticates the request and opens the runtime-operation guard;
2. normalizes messages, workspace and canvas context;
3. classifies intent and selects a model/provider;
4. builds prompts and bounded context;
5. calls the provider directly, including failover and timeout policy;
6. discovers and executes native, MCP, browser, filesystem and artifact tools;
7. serializes JSON/SSE responses and records generation/progress state.

The route already has useful domain-adjacent modules: `lib/agent-routing.ts`
for request classification, `lib/agent/tool-loop.ts` for bounded tool loops,
`lib/tools/registry.ts` and `lib/tools/policy.ts` for tool metadata and policy,
`lib/agent/progress.ts` for run progress, and `lib/providers.ts` for the
provider adapter boundary. These modules are retained.

## Current request lifecycle

```text
HTTP request
  -> auth / runtime guard
  -> message + workspace normalization
  -> intent and route classification
  -> model selection / failover setup
  -> prompt + context construction
  -> direct provider call or tool/MCP loops
  -> JSON/SSE serialization
  -> progress and generation log cleanup
```

The main coupling point is that the route decides the Agent lifecycle and the
provider call in the same function. The route also knows provider-specific
runtime objects and tool implementation details. This is the first boundary to
shrink; moving UI or storage code now would widen the migration unnecessarily.

## Open-source comparison

The following projects were checked on GitHub on 2026-09-29:

| Project | Maintenance signal | Reusable idea | Cost / fit for Phase 1 |
| --- | --- | --- | --- |
| [LangGraph.js](https://github.com/langchain-ai/langgraphjs) | Public TypeScript repository, about 3.3k stars and 3,155 commits at review time | Explicit stateful runs, durable execution and human-in-the-loop | Strong orchestration model, but adding it would introduce a graph runtime and LangChain ecosystem before SANMAO's own contracts are stable |
| [Mastra](https://github.com/mastra-ai/mastra) | Public TypeScript repository, about 28.4k stars and 20,229 commits at review time | Provider abstraction, agents, workflows, storage-backed suspension and observability | Broad framework with a large dependency and deployment surface; too much migration for one vertical slice |
| [OpenAI Agents JS](https://github.com/openai/openai-agents-js) | Public TypeScript repository, about 3.9k stars and 1,400 commits at review time | Small Agent/Run model, tools, guardrails, handoffs and tracing | Useful concepts, but its runtime and provider assumptions would compete with existing SANMAO adapters |

### Decision

**Based on the existing project.** The candidates confirm the value of an
explicit run lifecycle and provider/tool ports, but none is adopted as a
runtime dependency. SANMAO already has working provider selection, MCP policy,
approval and tool execution. A local contract keeps those behaviors stable and
lets later phases replace adapters independently.

## Target Phase 1 boundary

```text
HTTP Route (adapter)
  -> AgentRuntime (application/core)
       -> ContextBuilder port
       -> AgentPolicy port
       -> ModelRuntime port
            -> existing providers.ts adapter
```

`AgentRuntime` owns only the run state transition and lifecycle events. It does
not import Next.js, React, MCP, a provider SDK or a database. The first model
adapter invokes the existing `chatCompletion` function through a closure owned
by the route, so failover and timeout behavior remain unchanged.

## Contracts introduced

`packages/contracts/agent.ts` defines the smallest stable vocabulary:

- `AgentRunId`, `AgentRunState`, `AgentEvent`;
- `AgentRequest`, `AgentResult`;
- `ModelDescriptor`, `ModelCapabilities`, `ModelRuntime`, `ModelProvider`;
- `ContextBuilder`, `AgentPolicy`;
- tool definitions and results reserved for the next executable slice.

`packages/agent-core/runtime.ts` implements one model invocation. A rejected
policy produces a failed run event; provider errors produce failed or cancelled
runs; a successful invocation emits start, model completion and run completion
events.

## Migration boundary and preserved behavior

The new runtime is used only for the existing compact plain, non-streamed text
path. It receives the same bounded `llmMessages`, uses the same selected model,
and returns the same JSON response fields. The streamed plain path and every
tool/artifact/image/MCP/browser/filesystem path still use the existing route
logic. Existing run progress records and generation logs remain in place.

## Legacy responsibilities still remaining

- Route-level model selection, timeout and automatic failover.
- Prompt construction and intent classification.
- Tool discovery, approval, execution and follow-up loops.
- MCP, browser, filesystem, artifact and canvas behavior.
- Agent progress persistence and generation logs.
- JSON/SSE serialization and HTTP error mapping.

These are deliberate Phase 1 non-goals. They should move behind ports one
vertical slice at a time after behavior coverage exists.
