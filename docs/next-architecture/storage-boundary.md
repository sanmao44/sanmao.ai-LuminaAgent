# Storage Boundary Assessment

## Scope

Phase 3 introduces protocol-neutral Repository Ports while preserving the
existing IndexedDB, localStorage, JSON and filesystem behavior. This slice
moves conversation reads/writes in the client page behind a repository and
keeps the existing provider state route behind its repository.

## Contracts

`packages/contracts/storage.ts` defines:

- `ConversationRepository<T>` for list/get/save/remove/replace-all;
- `WorkspaceRepository<TSnapshot>` for bootstrap/collect/restore;
- `AssetRepository<T>` for unified asset listing;
- `TaskRepository<T>` for find/list/insert/update/remove and idempotency lookup;
- `ProviderConfigRepository<TPublicState>` for public provider state.

The ports do not import React, Next.js, IndexedDB, localStorage, filesystem
APIs, JSON paths or provider implementations. Domain DTOs remain type
parameters during migration instead of becoming dependencies of the contract
package.

## Migration adapters

The adapters in `lib/repositories/` are explicitly temporary:

- `conversation-repository.ts` delegates to the existing IndexedDB-backed
  `client-history` implementation;
- `workspace-repository.ts` delegates to the existing workspace sync and
  restore behavior;
- `asset-repository.ts` delegates to the existing unified asset reader;
- `task-repository.ts` delegates to `createTaskStore`, retaining atomic JSON
  writes and idempotency semantics;
- `provider-config-repository.ts` delegates to the existing public-state
  builder and does not expose provider secrets.

They can be removed when equivalent storage implementations are available
behind the ports and no callers depend on the legacy modules directly.

## Real path and preserved behavior

The client page now uses `conversationRepository` for backup, restore,
refresh, save, rename and delete operations. The IndexedDB schema and record
shape are unchanged. The `/api/state` route continues to use the provider
configuration repository. Video and upscale task CRUD and pagination now use
the Task Repository adapter; their JSON files, idempotency behavior and
upscale timestamp updates are unchanged. No database or new runtime
dependency was added.

## Legacy responsibilities remaining

- `client-history.ts` still owns IndexedDB transactions and workspace events.
- `workspace.ts` still owns localStorage metadata, preference collection and
  HTTP synchronization with `/api/workspace`.
- Clone jobs and Agent Progress still use their specialized stores directly;
  they require domain-specific atomic mutation semantics and remain outside
  this slice.
- `app/api/workspace/route.ts`, artifact storage and media storage still know
  filesystem details.

These are intentional follow-up migrations; changing them here would widen
the slice and risk changing existing persistence behavior.

## Phase 4 handoff

The first Task Runtime slice is now defined in `packages/task-runtime/`.
Video and upscale status adapters use its shared active-state policy for
refresh and deletion guards while preserving their legacy wire statuses.
Provider polling and task-specific retry implementations remain in their
existing services until behavior coverage supports moving those transitions.
