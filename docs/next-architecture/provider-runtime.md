# Provider Runtime Assessment

## Current state

The model registry already stores provider-neutral model kind and capability
metadata. `lib/store.ts` resolves enabled models into runtime candidates, while
`lib/providers.ts` owns the existing OpenAI-compatible, Gemini, Agnes and other
transport adapters. The Agent route still constructs the compact plain model
runtime inline and parses the legacy chat response shape there.

## Scope

This slice introduces the durable model contract and one Legacy Chat Adapter.
The adapter normalizes a legacy chat response into `ModelResponse`; the route
continues to supply its existing invocation closure, so automatic failover,
timeouts, usage accounting and provider health tracking remain unchanged.

## Real path

The non-streamed compact plain Agent turn now uses
`createLegacyChatModelRuntime`. It receives the same selected registry model,
the same bounded messages and the same tracked `chatCompletion` callback.
Streaming, tools, MCP, images, video, search and route-level model selection
remain on the existing path.

## Non-goals and remaining legacy responsibility

This slice does not move provider HTTP/SDK code, routing policy, failover,
health persistence, streaming or media operations. `lib/providers.ts` remains
the temporary transport adapter until each capability gets a behavior-tested
port.
