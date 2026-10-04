# Provider Runtime Assessment

> Historical implementation record. Current ownership, remaining compatibility
> layers and machine-enforced rules are defined by `ARCHITECTURE.md` and
> `docs/next-architecture/migration-status.md`; where this file and those differ,
> the authoritative documents win.

## Current state

The model registry already stores provider-neutral model kind and capability
metadata. `lib/store.ts` resolves enabled models into runtime candidates, while
`lib/providers.ts` owns the existing OpenAI-compatible, Gemini, Agnes and other
transport adapters. Provider attempt lifecycle and capability-specific media
candidate fallback now live in `packages/model-runtime`; API routes inject only
transport operations and health persistence. The compact plain model adapter
still normalizes the legacy chat response shape at the application boundary.

## Scope

This slice introduces the durable model contract and one Legacy Chat Adapter.
The adapter normalizes a legacy chat response into `ModelResponse`; the route
continues to supply its existing invocation closure, so automatic failover,
timeouts, usage accounting and provider health tracking remain unchanged.

## Real path

The non-streamed compact plain Agent turn now uses
`packages/model-runtime/legacy-chat-adapter.ts`. It receives the same selected
registry model, the same bounded messages and the same tracked `chatCompletion`
callback. Provider attempt lifecycle and bounded telemetry are shared by
`packages/model-runtime/invocation.ts`; `packages/model-runtime/agent-invoker.ts`
adapts application model calls to that coordinator; `apps/api/agent-stream.ts` owns the
provider-neutral SSE response boundary; image and edit routes share the
capability boundary in `packages/model-runtime/media.ts`, which only falls back
on explicit compatibility rejection. The application entry constructs the
shared `ProviderCoordinator` directly and passes health persistence through its
`ProviderHealthPort`; transport callbacks remain injected. A zero-caller
session wrapper was removed rather than kept as another ownership layer.
Streaming, tools, MCP, video and search remain on the existing path.

## Non-goals and remaining legacy responsibility

This slice does not move provider HTTP/SDK code, health persistence, or the
remaining streaming/video operations. `lib/providers.ts` remains the temporary
transport adapter until each capability gets a behavior-tested port. Media
routing and compatibility fallback have moved behind the model-runtime seam;
image transport and persistence remain injected adapters. Provider health
persistence and video provider branches remain legacy adapters until their
ports have behavior coverage.
The former `lib/provider-runtime/chat.ts` and root `packages/model-runtime.ts`
bridges were removed after their callers moved to the package seams.
