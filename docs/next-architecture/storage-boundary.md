# Storage Boundary Assessment

## Scope

Phase 3 introduces protocol-neutral Repository Ports while preserving the
existing IndexedDB, localStorage, JSON and filesystem behavior. This slice
moves conversation, workspace gallery, canvas collections, video/upscale
tasks, clone jobs and Agent progress through explicit repository adapters.

## Contracts

`packages/contracts/storage.ts` defines:

- `ConversationRepository<T>` for list/get/save/remove/replace-all;
- `WorkspaceRepository<TSnapshot>` for bootstrap/collect/restore;
- `AssetRepository<T>` for unified asset listing, gallery and collection writes;
- `TaskRepository<T>` for serialized mutation plus find/list/insert/update/remove and idempotency lookup;
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
- `asset-repository.ts` owns unified asset composition while delegating physical reads and writes to the existing IndexedDB adapter;
- `task-repository.ts` delegates to `createTaskStore`, retaining atomic JSON
  writes and idempotency semantics;
- `provider-config-repository.ts` delegates to the existing public-state
  builder and does not expose provider secrets.
- `server-provider-repository.ts` owns provider state JSON compatibility and
  SQLite access after cutover.
- `server-workspace-repository.ts` owns workspace JSON recovery, metadata and
  SQLite access after cutover.

The HTTP workspace route and provider state store now call these server
repositories; they no longer select JSON or SQLite themselves.

They can be removed when equivalent storage implementations are available
behind the ports and no callers depend on the legacy modules directly.

## Real path and preserved behavior

The client page now uses `conversationRepository` for backup, restore,
refresh, save, rename and delete operations. Gallery, asset-index and Canvas
collection reads and writes use `assetRepository`; the page, workspace
aggregation and asset services no longer call the IndexedDB module directly.
Video, upscale, clone and Agent progress persistence use the Task Repository
adapter, including serialized domain-specific mutations. The IndexedDB and
JSON record shapes, idempotency behavior and task timestamps are unchanged. No
database or new runtime dependency was added.

## Legacy responsibilities remaining

- `client-history.ts` still owns IndexedDB transactions and workspace events;
  repository adapters remain temporary until a replacement implementation
  exists behind the same ports.
- `workspace.ts` still owns localStorage metadata, preference collection and
  HTTP synchronization with `/api/workspace`.
- Canvas UI preferences and several provider/MCP/media/artifact routes still
  access browser storage or filesystem adapters directly.
- `app/api/workspace/route.ts`, artifact storage and media storage still know
  filesystem details.

### Current Gate result

Key session, workspace, provider, MCP, asset and task callers now cross
repository boundaries.
SQLite is now the selected local authoritative adapter after an explicit
`npm run migrate:database` cutover. Before activation, JSON, workspace and MCP
files are copied into a durable rollback tree; after activation new server
writes use SQLite and the old files are read only by migration/rollback or the
legacy backup importer. Browser IndexedDB/localStorage remains a client-owned
compatibility source and enters the cutover through the canonical backup
workspace snapshot.

Direct storage access remains in UI preferences, media/artifact roots and
client-history internals. These are bounded compatibility paths, not a second
server database authority. Gate 1 is **completed for server business data**;
the remaining client and blob adapters have explicit owners and deletion
conditions.

### Database decision and migration boundary

- SQLite (`node:sqlite`) is the local authoritative database; no dependency was added.
- `lib/database/sqlite.ts` owns the adapter and schema; business callers use repositories.
- `npm run migrate:database -- --runtime-guard` performs drain, stage, validate, cutover and rollback-source capture. It leaves a restart fence; the launcher clears that fence only after the new process is ready.
- `npm run migrate:database -- rollback` restores legacy JSON sources and removes the active marker.
- Repository instances never silently switch stores after initialization. The command is idempotent only before activation; an active marker is a deliberate cutover fence. Ordinary rollback is strict-window and refuses after a post-cutover write.
- PostgreSQL remains a future cloud adapter and is not introduced in this local-first slice.

These are intentional follow-up migrations; changing them here would widen
the slice and risk changing existing persistence behavior.

## Phase 4 handoff

The first Task Runtime slice is now defined in `packages/task-runtime/`.
Video and upscale status adapters use its shared active-state policy for
refresh and deletion guards while preserving their legacy wire statuses.
Provider polling and task-specific retry implementations remain in their
existing services until behavior coverage supports moving those transitions.
